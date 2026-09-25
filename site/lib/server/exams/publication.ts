import {
  calculateExam,
  type ExamCalculationInput,
  type CalculationScore,
} from "../../domain/ranking.ts";
import { ExamError, parseScore, type ExamType } from "../../domain/scores.ts";
import { addCalendarMonths, taipeiBusinessDate } from "../../domain/dates.ts";
import { AuthorizationService } from "../auth/authorization.ts";
import {
  RECENT_AUTH_WINDOW_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from "../auth/policy.ts";
import type { AuthSession, ScopeResource } from "../auth/types.ts";

type Row = Record<string, string | number | null>;
type Edit = {
  participationId: string;
  settingId: string;
  expectedVersion: number;
  value: string | number | null;
};
type Request =
  | { kind: "PUBLISH"; component: ExamType; expectedVersion: number }
  | { kind: "EDIT"; reason: string; scores: Edit[]; expectedVersion: number };
type Change = {
  id: string;
  part: Row;
  setting: Row;
  old: Row | null;
  value: ReturnType<typeof parseScore>;
};
type Snapshot = {
  components: ExamType[];
  input: ExamCalculationInput;
  result: ReturnType<typeof calculateExam>;
};
type Payload = { request: Request; snapshot: Snapshot; changes: Change[] };
const fail = (code: string, status = 409): never => {
  throw new ExamError(code, status);
};

/** Publication is a single D1 transaction; no externally writable unlocked interval exists. */
export class PublicationService {
  private authorization: AuthorizationService;
  private now: () => number;
  private deps: { db: D1Database; now?: () => number };
  constructor(deps: { db: D1Database; now?: () => number }) {
    this.deps = deps;
    this.authorization = new AuthorizationService(deps);
    this.now = deps.now ?? Date.now;
  }
  private sql(query: string, ...values: (string | number | null)[]) {
    return this.deps.db.prepare(query).bind(...values);
  }
  private calculate(input: ExamCalculationInput) {
    return calculateExam(input);
  }
  private async exam(id: string) {
    const e = await this.sql(
      "SELECT e.*,t.academic_year_id,a.revision,a.current_year_id FROM exams e JOIN academic_terms t ON t.id=e.academic_term_id CROSS JOIN academic_state a WHERE e.id=? AND a.id=1",
      id,
    ).first<Row>();
    if (!e) return fail("EXAM_NOT_FOUND", 404);
    return e;
  }
  private resource(e: Row, reason?: string): ScopeResource {
    return {
      academicTermId: String(e.academic_term_id),
      onDate: String(e.starts_on),
      historyReason: reason,
    };
  }
  private async access(session: AuthSession, e: Row, request: Request) {
    if (request.kind === "PUBLISH") {
      await this.authorization.assertPermission(
        session,
        "score.write",
        this.resource(e),
        true,
      );
    } else {
      for (const item of request.scores) {
        const target = await this.sql(
          "SELECT p.*,s.subject FROM exam_participations p JOIN exam_subject_settings s ON s.exam_id=p.exam_id WHERE p.id=? AND s.id=? AND p.exam_id=?",
          item.participationId,
          item.settingId,
          e.id,
        ).first<Row>();
        if (!target) return fail("SCORE_TARGET_NOT_FOUND", 404);
        let scope: ScopeResource;
        if (target.origin === "LOCAL")
          scope = {
            ...this.resource(e, request.reason),
            participationId: String(target.id),
            subject: String(target.subject),
          };
        else
          scope = {
            ...this.resource(e, request.reason),
            studentId: String(target.student_id),
            subject: String(target.subject),
          };
        await this.authorization.assertPermission(
          session,
          "score.write",
          scope,
          true,
        );
      }
    }
  }
  private async latest(examId: string) {
    return this.sql(
      "SELECT v.*,s.snapshot_json FROM exam_result_versions v JOIN publication_snapshots s ON s.result_version_id=v.id WHERE v.exam_id=? AND v.published_at IS NOT NULL ORDER BY v.version DESC LIMIT 1",
      examId,
    ).first<Row>();
  }
  private validate(request: Request) {
    if (
      !request ||
      !Number.isSafeInteger(request.expectedVersion) ||
      request.expectedVersion < 1
    )
      fail("INVALID_PUBLICATION_INPUT", 400);
    const allowed =
      request.kind === "PUBLISH"
        ? ["kind", "component", "expectedVersion"]
        : ["kind", "reason", "scores", "expectedVersion"];
    if (Object.keys(request).some((k) => !allowed.includes(k)))
      fail("INVALID_PUBLICATION_INPUT", 400);
    if (request.kind === "PUBLISH") {
      if (!["QUIZ", "MIDTERM"].includes(request.component))
        fail("INVALID_COMPONENT", 400);
    } else if (request.kind === "EDIT") {
      if (
        typeof request.reason !== "string" ||
        !request.reason.trim() ||
        request.reason.length > 320 ||
        !Array.isArray(request.scores) ||
        !request.scores.length ||
        request.scores.length > 5000
      )
        fail("MODIFICATION_REASON_REQUIRED", 400);
      const seen = new Set<string>();
      for (const s of request.scores) {
        if (
          !s ||
          Object.keys(s).some(
            (k) =>
              ![
                "participationId",
                "settingId",
                "expectedVersion",
                "value",
              ].includes(k),
          ) ||
          typeof s.participationId !== "string" ||
          typeof s.settingId !== "string" ||
          !Number.isSafeInteger(s.expectedVersion) ||
          s.expectedVersion < 0
        )
          fail("INVALID_SCORE_INPUT", 400);
        const key = JSON.stringify([s.participationId, s.settingId]);
        if (seen.has(key)) fail("DUPLICATE_SCORE_TARGET", 400);
        seen.add(key);
      }
    } else fail("INVALID_PUBLICATION_INPUT", 400);
  }
  async preview(session: AuthSession, examId: string, request: Request) {
    this.validate(request);
    const e = await this.exam(examId);
    await this.access(session, e, request);
    if (e.archived_at !== null) fail("EXAM_ARCHIVED");
    if (e.version !== request.expectedVersion) fail("EXAM_VERSION_CONFLICT");
    const previous = await this.latest(examId);
    const prior: Snapshot | null = previous
      ? JSON.parse(String(previous.snapshot_json))
      : null;
    if (!prior && request.kind === "EDIT") fail("PUBLICATION_REQUIRED");
    if (!prior && e.published_at !== null) fail("PUBLICATION_SNAPSHOT_MISSING");
    if (request.kind === "PUBLISH" && e.academic_year_id !== e.current_year_id)
      fail("HISTORICAL_SCOPE_DENIED", 403);
    const components = [...(prior?.components ?? [])];
    if (request.kind === "PUBLISH") {
      if (components.includes(request.component))
        fail("COMPONENT_ALREADY_PUBLISHED");
      components.push(request.component);
    }
    const [parts, settings, scores, enrollments] =
      await this.deps.db.batch<Row>([
        this.sql(
          "SELECT * FROM exam_participations WHERE exam_id=? ORDER BY id",
          examId,
        ),
        this.sql(
          "SELECT * FROM exam_subject_settings WHERE exam_id=? ORDER BY id",
          examId,
        ),
        this.sql(
          "SELECT * FROM score_items WHERE exam_id=? ORDER BY id",
          examId,
        ),
        this.sql(
          "SELECT n.student_id,n.class_id,c.grade FROM student_enrollments n JOIN classes c ON c.id=n.class_id WHERE n.academic_term_id=? AND n.status='valid' AND n.effective_from<=? AND (n.effective_to IS NULL OR n.effective_to>?)",
          e.academic_term_id,
          e.starts_on,
          e.starts_on,
        ),
      ]);
    const changes: Change[] = [];
    if (request.kind === "EDIT")
      for (const item of request.scores) {
        const part = parts.results.find((p) => p.id === item.participationId),
          setting = settings.results.find((s) => s.id === item.settingId);
        if (!part || !setting) return fail("SCORE_TARGET_NOT_FOUND", 404);
        const student = await this.sql(
          "SELECT deleted_at FROM students WHERE id=?",
          part.student_id,
        ).first<Row>();
        if (!student || student.deleted_at !== null)
          fail("STUDENT_UNAVAILABLE");
        const old =
          scores.results.find(
            (s) =>
              s.participation_id === part.id && s.setting_id === setting.id,
          ) ?? null;
        if (Number(old?.version ?? 0) !== item.expectedVersion)
          fail("SCORE_VERSION_CONFLICT");
        const value = parseScore(item.value);
        if (
          part.origin === "LOCAL" &&
          (setting.held === 0) !== (value.scoreStatus === "NOT_HELD")
        )
          fail("SCORE_HELD_MISMATCH", 400);
        changes.push({
          id: String(old?.id ?? crypto.randomUUID()),
          part,
          setting,
          old,
          value,
        });
      }
    const input: ExamCalculationInput = {
      examId,
      academicTermId: String(e.academic_term_id),
      academicYearId: String(e.academic_year_id),
      sourceVersion: Number(e.version) + 1,
      mode: components.length === 2 ? "FINAL" : "PROVISIONAL",
      components,
      settings: settings.results.map((s) => ({
        examType: s.exam_type as ExamType,
        subject: s.subject as CalculationScore["subject"],
        held: s.held === 1,
      })),
      enrollmentSnapshot:
        prior?.input.enrollmentSnapshot ??
        enrollments.results.map((n) => ({
          studentId: String(n.student_id),
          classId: String(n.class_id),
          grade: Number(n.grade),
        })),
      participants: parts.results.map((p) => ({
        id: String(p.id),
        studentId: String(p.student_id),
        origin: p.origin as "LOCAL" | "EXTERNAL_TRANSFER",
        classIdSnapshot: p.class_id_snapshot as string | null,
        gradeSnapshot: p.grade_snapshot as number | null,
        rankingEligible: p.ranking_eligible === 1,
        scores: settings.results
          .filter((s) => components.includes(s.exam_type as ExamType))
          .map((s) => {
            const change = changes.find(
              (c) => c.part.id === p.id && c.setting.id === s.id,
            );
            const old = scores.results.find(
              (v) => v.participation_id === p.id && v.setting_id === s.id,
            );
            const value =
              change?.value ??
              (old
                ? {
                    scoreValue: old.score_value as number | null,
                    scoreStatus:
                      old.score_status as CalculationScore["scoreStatus"],
                    includeInAverage: old.include_in_average as 0 | 1,
                  }
                : parseScore(
                    p.origin === "LOCAL" && s.held === 0 ? "N" : null,
                  ));
            return {
              examType: s.exam_type as ExamType,
              subject: s.subject as CalculationScore["subject"],
              ...value,
            };
          }),
      })),
    };
    const snapshot: Snapshot = {
      components,
      input,
      result: this.calculate(input),
    };
    const current = await this.exam(examId);
    await this.access(session, current, request);
    if (current.version !== e.version || current.revision !== e.revision)
      fail("PUBLICATION_SOURCE_CHANGED");
    const id = crypto.randomUUID();
    await this.sql(
      "INSERT INTO publication_previews (id,actor_id,exam_id,source_version,academic_revision,payload_json,created_at) VALUES (?,?,?,?,?,?,?)",
      id,
      session.adminId,
      examId,
      e.version,
      e.revision,
      JSON.stringify({ request, snapshot, changes } satisfies Payload),
      this.now(),
    ).run();
    // Teachers may edit only their own rows; the stored school-wide calculation never escapes that scope.
    return {
      previewId: id,
      examId,
      sourceVersion: e.version,
      components,
      mode: input.mode,
      count: changes.length,
      changes: changes.map((c) => ({
        participationId: c.part.id,
        settingId: c.setting.id,
        before: c.old
          ? { scoreValue: c.old.score_value, scoreStatus: c.old.score_status }
          : null,
        after: c.value,
      })),
      ...(request.kind === "PUBLISH"
        ? { classes: snapshot.result.classes, grades: snapshot.result.grades }
        : {}),
    };
  }
  async confirm(
    session: AuthSession,
    previewId: string,
    confirmed: boolean,
    examId?: string,
  ) {
    if (confirmed !== true) fail("CONFIRMATION_REQUIRED", 400);
    const preview = await this.sql(
      "SELECT * FROM publication_previews WHERE id=? AND actor_id=?",
      previewId,
      session.adminId,
    ).first<Row>();
    if (!preview) return fail("PUBLICATION_PREVIEW_NOT_FOUND", 404);
    if (examId !== undefined && examId !== preview.exam_id)
      fail("PUBLICATION_PREVIEW_NOT_FOUND", 404);
    const payload: Payload = JSON.parse(String(preview.payload_json));
    const { request, snapshot, changes } = payload;
    const e = await this.exam(String(preview.exam_id));
    await this.access(session, e, request);
    if (preview.result_version_id)
      return { resultVersionId: preview.result_version_id, replayed: true };
    if (
      e.version !== preview.source_version ||
      e.revision !== preview.academic_revision ||
      e.archived_at !== null
    )
      fail("PUBLICATION_SOURCE_CHANGED");
    // Recalculate before preparing writes. An exception cannot change the currently published pointer.
    snapshot.result = this.calculate(snapshot.input);
    const now = this.now(),
      id = crypto.randomUUID();
    const last = await this.sql(
      "SELECT max(version) AS version FROM exam_result_versions WHERE exam_id=?",
      e.id,
    ).first<Row>();
    const resultNumber = Number(last?.version ?? 0) + 1;
    const writes: D1PreparedStatement[] = [
      this.sql(
        "INSERT INTO exam_result_versions (id,exam_id,version,source_version,calculation_version,provisional,published_at,created_by,created_at) VALUES (CASE WHEN EXISTS (SELECT 1 FROM exams WHERE id=? AND version=? AND archived_at IS NULL) AND EXISTS (SELECT 1 FROM academic_state WHERE id=1 AND revision=?) AND EXISTS (SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id WHERE a.id=? AND s.id=? AND a.status='active' AND a.google_subject_id IS NOT NULL AND a.role IN ('super_admin','score_admin') AND a.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=? AND s.recent_auth_at>? AND s.recent_auth_at<=?) THEN ? ELSE NULL END,?,?,?,?,?,?,?,?)",
        e.id,
        e.version,
        e.revision,
        session.adminId,
        session.sessionId,
        now,
        now - SESSION_IDLE_TIMEOUT_MS,
        now,
        now - RECENT_AUTH_WINDOW_MS,
        now,
        id,
        e.id,
        resultNumber,
        Number(e.version) + 1,
        snapshot.result.calculationVersion,
        snapshot.components.length === 2 ? 0 : 1,
        now,
        session.adminId,
        now,
      ),
      this.sql("UPDATE exams SET locked_at=NULL WHERE id=?", e.id),
    ];
    for (const c of changes) {
      const v = Number(c.old?.version ?? 0),
        ranking =
          c.part.origin === "LOCAL" ? Number(c.part.ranking_eligible) : 0;
      if (c.old)
        writes.push(
          this.sql(
            "UPDATE score_items SET score_value=?,score_status=?,include_in_average=?,include_in_ranking=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END,updated_at=? WHERE id=?",
            c.value.scoreValue,
            c.value.scoreStatus,
            c.value.includeInAverage,
            ranking,
            v,
            now,
            c.id,
          ),
        );
      else
        writes.push(
          this.sql(
            "INSERT INTO score_items (id,participation_id,setting_id,exam_id,student_id,exam_type,subject,origin,class_id_snapshot,score_value,score_status,include_in_average,include_in_ranking,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            c.id,
            c.part.id,
            c.setting.id,
            e.id,
            c.part.student_id,
            c.setting.exam_type,
            c.setting.subject,
            c.part.origin,
            c.part.class_id_snapshot,
            c.value.scoreValue,
            c.value.scoreStatus,
            c.value.includeInAverage,
            ranking,
            now,
            now,
          ),
        );
      writes.push(
        this.sql(
          "INSERT INTO score_change_history (id,score_item_id,student_id,actor_id,operation_id,reason,before_json,after_json,from_version,to_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          crypto.randomUUID(),
          c.id,
          c.part.student_id,
          session.adminId,
          previewId,
          request.kind === "EDIT" ? request.reason.trim() : "Publication",
          JSON.stringify(
            c.old
              ? {
                  scoreValue: c.old.score_value,
                  scoreStatus: c.old.score_status,
                  includeInAverage: c.old.include_in_average,
                  includeInRanking: c.old.include_in_ranking,
                }
              : null,
          ),
          JSON.stringify({ ...c.value, includeInRanking: ranking }),
          v,
          v + 1,
          now,
        ),
      );
    }
    writes.push(
      this.sql(
        "INSERT INTO publication_snapshots (result_version_id,snapshot_json) VALUES (?,?)",
        id,
        JSON.stringify(snapshot),
      ),
    );
    for (const p of [...snapshot.result.local, ...snapshot.result.external])
      writes.push(
        this.sql(
          "INSERT INTO exam_results (id,result_version_id,exam_id,participation_id,average_hundredths,total_hundredths,class_rank,grade_rank,computed_json) VALUES (?,?,?,?,?,?,?,?,?)",
          crypto.randomUUID(),
          id,
          e.id,
          p.participationId,
          p.exam.averageHundredths,
          p.exam.totalHundredths,
          p.classRank,
          p.gradeRank,
          JSON.stringify(p),
        ),
      );
    // All exam participants depend on the rank/cohort snapshot, even if their own mark did not change.
    writes.push(
      this.sql(
        "UPDATE ai_advices SET stale_at=COALESCE(stale_at,?) WHERE exam_id=?",
        now,
        e.id,
      ),
    );
    const students = new Set(
      snapshot.input.participants.map((p) => p.studentId),
    );
    for (const student of students)
      for (const audience of ["parent", "student"])
        writes.push(
          this.sql(
            "INSERT INTO ai_jobs (id,student_id,exam_id,result_version_id,audience,dedupe_key,source_version,status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'pending',?,? WHERE EXISTS (SELECT 1 FROM students WHERE id=? AND status='active' AND deleted_at IS NULL)",
            crypto.randomUUID(),
            student,
            e.id,
            id,
            audience,
            `${id}:${student}:${audience}`,
            Number(e.version) + 1,
            now,
            now,
            student,
          ),
        );
    writes.push(
      this.sql(
        "UPDATE publication_previews SET result_version_id=? WHERE id=? AND result_version_id IS NULL",
        id,
        previewId,
      ),
      this.sql(
        "UPDATE exams SET version=version+1,published_at=?,locked_at=?,updated_at=? WHERE id=?",
        now,
        now,
        now,
        e.id,
      ),
      this.sql(
        "INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until) VALUES (?,?,?,'exam',?,?,'success',?,?,?)",
        crypto.randomUUID(),
        session.adminId,
        request.kind === "EDIT"
          ? "EXAM_UNLOCK_EDIT_RELOCK"
          : "EXAM_PUBLISH_LOCK",
        e.id,
        previewId,
        JSON.stringify({
          resultVersionId: id,
          components: snapshot.components,
          count: changes.length,
        }),
        now,
        addCalendarMonths(taipeiBusinessDate(now), 2),
      ),
    );
    try {
      await this.deps.db.batch(writes);
    } catch {
      await this.access(session, await this.exam(String(e.id)), request);
      const replay = await this.sql(
        "SELECT result_version_id FROM publication_previews WHERE id=?",
        previewId,
      ).first<Row>();
      if (replay?.result_version_id)
        return { resultVersionId: replay.result_version_id, replayed: true };
      return fail("PUBLICATION_CONFLICT");
    }
    return { resultVersionId: id, replayed: false };
  }
  /** Internal consumer contract only. Phase 12 must repeat this check atomically before storing advice. */
  async regenerationRequest(jobId: string) {
    const job = await this.sql(
      "SELECT j.* FROM ai_jobs j JOIN students s ON s.id=j.student_id WHERE j.id=? AND s.status='active' AND s.deleted_at IS NULL AND j.status IN ('pending','processing','failed') AND j.result_version_id=(SELECT id FROM exam_result_versions WHERE exam_id=j.exam_id AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1)",
      jobId,
    ).first<Row>();
    return job
      ? {
          jobId: job.id,
          resultVersionId: job.result_version_id,
          sourceVersion: job.source_version,
          audience: job.audience,
        }
      : null;
  }
  async publishedClass(session: AuthSession, examId: string, classId: string) {
    if (typeof classId !== "string" || !classId.trim())
      fail("CLASS_REQUIRED", 400);
    const e = await this.exam(examId),
      resource = { ...this.resource(e), classId };
    await this.authorization.assertPermission(session, "score.read", resource);
    const latest = await this.latest(examId);
    if (!latest) return { published: false as const };
    const snapshot: Snapshot = JSON.parse(String(latest.snapshot_json));
    await this.authorization.assertPermission(session, "score.read", resource);
    return {
      published: true as const,
      resultVersionId: latest.id,
      sourceVersion: latest.source_version,
      mode: snapshot.result.mode,
      components: snapshot.components,
      statistics:
        snapshot.result.classes.find((c) => c.classId === classId) ?? null,
      students: snapshot.result.local
        .filter((p) => p.classIdSnapshot === classId)
        .map((p) => {
          const { gradeRank, ...visible } = p;
          void gradeRank;
          return visible;
        }),
    };
  }
}
