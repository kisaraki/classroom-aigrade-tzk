import {
  addCalendarMonths,
  assertBusinessDate,
  taipeiBusinessDate,
} from "../../domain/dates.ts";
import { resolveRankingEligibility } from "../../domain/ranking-eligibility.ts";
import {
  ExamError,
  parseScore,
  scoreDisplay,
  SUBJECTS,
  SUBJECT_SETTINGS,
} from "../../domain/scores.ts";
import { AuthorizationService } from "../auth/authorization.ts";
import { sha256Hex } from "../auth/google-oidc.ts";
import { SESSION_IDLE_TIMEOUT_MS } from "../auth/policy.ts";
import type { AuthSession, ScopeResource } from "../auth/types.ts";

type Row = Record<string, string | number | null>;
type State = { revision: number; current_year_id: string | null };
type Exam = Row & {
  id: string;
  academic_term_id: string;
  academic_year_id: string;
  starts_on: string;
  ends_on: string;
  version: number;
};
type Command = {
  operationId: string;
  expectedVersion: number;
  confirmed?: boolean;
};
export type Receipt = {
  operationId: string;
  examId: string;
  version: number;
  count: number;
  participationId?: string;
  replayed: boolean;
};
type RosterRow = {
  studentId: string;
  enrollmentId: string;
  classId: string;
  classCode: string;
  grade: number;
  seatNumber: number;
  studentDefault: boolean;
  termOverride: boolean | null;
  examOverride: boolean | null;
  rankingEligible: boolean;
};
type ScoreInput = {
  participationId: string;
  settingId: string;
  expectedVersion: number;
  value: string | number | null;
};
const fail = (code: string, status = 400): never => {
  throw new ExamError(code, status);
};
const text = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 320)
    return fail("INVALID_INPUT");
  return value.trim().normalize("NFC");
};
const version = (value: unknown, minimum = 1): number => {
  if (!Number.isSafeInteger(value) || Number(value) < minimum)
    return fail("VERSION_REQUIRED");
  return Number(value);
};
const confirmed = (input: { confirmed?: unknown }) => {
  if (input.confirmed !== true) fail("CONFIRMATION_REQUIRED");
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

/** Server-only draft boundary. All scopes are resolved from stored resources. */
export class ExamService {
  private readonly authorization: AuthorizationService;
  private readonly now: () => number;
  private readonly dependencies: { db: D1Database; now?: () => number };
  constructor(dependencies: { db: D1Database; now?: () => number }) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? Date.now;
    this.authorization = new AuthorizationService({
      db: dependencies.db,
      now: this.now,
    });
  }
  private get db() {
    return this.dependencies.db;
  }
  private sql(query: string, ...values: (string | number | null)[]) {
    return this.db.prepare(query).bind(...values);
  }
  private async state(): Promise<State> {
    const row = await this.sql(
      "SELECT revision, current_year_id FROM academic_state WHERE id=1",
    ).first<State>();
    if (!row) return fail("ACADEMIC_STATE_UNAVAILABLE", 503);
    return row;
  }
  private async exam(id: string): Promise<Exam> {
    const row = await this.sql(
      "SELECT e.*, t.academic_year_id FROM exams e JOIN academic_terms t ON t.id=e.academic_term_id WHERE e.id=?",
      text(id),
    ).first<Exam>();
    if (!row) return fail("EXAM_NOT_FOUND", 404);
    return row;
  }
  private scope(exam: Exam, extra: ScopeResource = {}): ScopeResource {
    return {
      academicTermId: exam.academic_term_id,
      onDate: exam.starts_on,
      ...extra,
    };
  }
  private async access(
    session: AuthSession,
    write: boolean,
    resource: ScopeResource,
  ) {
    return this.authorization.assertPermission(
      session,
      write ? "score.write" : "score.read",
      resource,
    );
  }
  private draft(exam: Exam, state: State) {
    if (exam.academic_year_id !== state.current_year_id)
      fail("HISTORICAL_EXAM_READ_ONLY", 409);
    if (
      exam.published_at !== null ||
      exam.locked_at !== null ||
      exam.archived_at !== null
    )
      fail("EXAM_NOT_DRAFT", 409);
  }
  private async storedReceipt(
    session: AuthSession,
    operationId: string,
    hash: string,
  ): Promise<Receipt | null> {
    const old = await this.sql(
      "SELECT actor_id, request_hash, result_json FROM exam_operations WHERE id=?",
      operationId,
    ).first<Row>();
    if (!old) return null;
    if (old.actor_id !== session.adminId || old.request_hash !== hash)
      return fail("OPERATION_CONFLICT", 409);
    return { ...JSON.parse(String(old.result_json)), replayed: true };
  }
  private async command(
    session: AuthSession,
    kind: string,
    input: { operationId: string; expectedVersion?: number },
    state: State,
    exam: Exam | null,
    resources: ScopeResource[],
    prepare: () => Promise<{
      writes: D1PreparedStatement[];
      result: Omit<Receipt, "operationId" | "replayed">;
    }>,
    previewId: string | null = null,
  ): Promise<Receipt> {
    const operationId = text(input.operationId);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/u.test(operationId))
      fail("INVALID_OPERATION_ID");
    const hash = await sha256Hex(
      canonical({ kind, examId: exam?.id ?? null, input }),
    );
    // Replays still require current permission and Scope; never expose another actor's receipt.
    const reauthorize = async () => {
      for (const resource of resources)
        await this.access(session, true, resource);
    };
    await reauthorize();
    const replay = await this.storedReceipt(session, operationId, hash);
    if (replay) return replay;
    if (exam) {
      if (version(input.expectedVersion) !== exam.version)
        fail("EXAM_VERSION_CONFLICT", 409);
      this.draft(exam, state);
    }
    const { writes, result } = await prepare();
    const now = this.now();
    const receipt = { operationId, ...result, replayed: false };
    const predicates = [
      "EXISTS (SELECT 1 FROM academic_state WHERE id=1 AND revision=? AND current_year_id IS ?)",
      "EXISTS (SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id WHERE a.id=? AND s.id=? AND a.status='active' AND a.google_subject_id IS NOT NULL AND a.role IN ('super_admin','score_admin') AND a.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=?)",
    ];
    const values: (string | number | null)[] = [
      state.revision,
      state.current_year_id,
      session.adminId,
      session.sessionId,
      now,
      now - SESSION_IDLE_TIMEOUT_MS,
      now,
    ];
    if (exam) {
      predicates.push(
        "EXISTS (SELECT 1 FROM exams e JOIN academic_terms t ON t.id=e.academic_term_id JOIN academic_state a ON a.id=1 WHERE e.id=? AND e.version=? AND t.academic_year_id=a.current_year_id AND e.published_at IS NULL AND e.locked_at IS NULL AND e.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM exam_result_versions v WHERE v.exam_id=e.id AND v.published_at IS NOT NULL))",
      );
      values.push(exam.id, exam.version);
    }
    const statements = [
      this.sql(
        `INSERT INTO exam_operations (id,actor_id,auth_session_id,kind,request_hash,result_json,preview_id,created_at) VALUES (CASE WHEN ${predicates.join(" AND ")} THEN ? ELSE NULL END,?,?,?,?,?,?,?)`,
        ...values,
        operationId,
        session.adminId,
        session.sessionId,
        kind,
        hash,
        JSON.stringify(receipt),
        previewId,
        now,
      ),
      ...writes,
      ...(exam
        ? [
            this.sql(
              "UPDATE exams SET version=version+1, updated_at=? WHERE id=?",
              now,
              exam.id,
            ),
          ]
        : []),
      this.sql(
        "INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until) VALUES (?,?,?,'exam',?,?,'success',?,?,?)",
        crypto.randomUUID(),
        session.adminId,
        `EXAM_${kind}`,
        result.examId,
        operationId,
        JSON.stringify({ count: result.count, version: result.version }),
        now,
        addCalendarMonths(taipeiBusinessDate(now), 2),
      ),
    ];
    try {
      await this.db.batch(statements);
    } catch {
      await reauthorize();
      const repeated = await this.storedReceipt(session, operationId, hash);
      if (repeated) return repeated;
      return fail("EXAM_CONFLICT", 409);
    }
    return receipt;
  }
  private dates(start: string, end: string) {
    try {
      assertBusinessDate(start);
      assertBusinessDate(end);
    } catch {
      fail("INVALID_EXAM_DATE");
    }
    if (start >= end) fail("INVALID_EXAM_DATE");
  }
  async createExam(
    session: AuthSession,
    input: {
      operationId: string;
      academicTermId: string;
      sequence: number;
      startsOn: string;
      endsOn: string;
      confirmed: boolean;
    },
  ) {
    confirmed(input);
    const state = await this.state();
    const term = await this.sql(
      "SELECT * FROM academic_terms WHERE id=?",
      text(input.academicTermId),
    ).first<Row>();
    if (!term) return fail("TERM_NOT_FOUND", 404);
    this.dates(input.startsOn, input.endsOn);
    if (
      !Number.isInteger(input.sequence) ||
      ![1, 2, 3].includes(input.sequence)
    )
      fail("INVALID_EXAM_SEQUENCE");
    if (
      input.startsOn < String(term.starts_on) ||
      input.endsOn > String(term.ends_on)
    )
      fail("EXAM_OUTSIDE_TERM");
    const resource = {
      academicTermId: String(term.id),
      onDate: input.startsOn,
    };
    return this.command(
      session,
      "CREATE_EXAM",
      input,
      state,
      null,
      [resource],
      async () => {
        if (term.academic_year_id !== state.current_year_id)
          fail("HISTORICAL_EXAM_READ_ONLY", 409);
        const id = crypto.randomUUID();
        return {
          result: { examId: id, version: 1, count: 10 },
          writes: [
            this.sql(
              "INSERT INTO exams (id,academic_term_id,sequence,starts_on,ends_on,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
              id,
              String(term.id),
              input.sequence,
              input.startsOn,
              input.endsOn,
              this.now(),
              this.now(),
            ),
            ...SUBJECT_SETTINGS.map((s) =>
              this.sql(
                "INSERT INTO exam_subject_settings (id,exam_id,exam_type,subject) VALUES (?,?,?,?)",
                crypto.randomUUID(),
                id,
                s.examType,
                s.subject,
              ),
            ),
          ],
        };
      },
    );
  }
  async updateSchedule(
    session: AuthSession,
    examId: string,
    input: Command & { startsOn: string; endsOn: string },
  ) {
    confirmed(input);
    this.dates(input.startsOn, input.endsOn);
    const state = await this.state(),
      exam = await this.exam(examId);
    return this.command(
      session,
      "SCHEDULE",
      input,
      state,
      exam,
      [this.scope(exam), this.scope(exam, { onDate: input.startsOn })],
      async () => {
        if (
          await this.sql(
            "SELECT id FROM exam_participations WHERE exam_id=? LIMIT 1",
            exam.id,
          ).first()
        )
          fail("EXAM_HAS_FROZEN_ROSTER", 409);
        return {
          result: { examId, version: exam.version + 1, count: 1 },
          writes: [
            this.sql(
              "UPDATE exams SET starts_on=?,ends_on=? WHERE id=?",
              input.startsOn,
              input.endsOn,
              exam.id,
            ),
          ],
        };
      },
    );
  }
  async setSubjectHeld(
    session: AuthSession,
    examId: string,
    input: Command & {
      settingId: string;
      settingVersion: number;
      held: boolean;
    },
  ) {
    confirmed(input);
    if (typeof input.held !== "boolean") fail("INVALID_HELD");
    const state = await this.state(),
      exam = await this.exam(examId);
    return this.command(
      session,
      "SUBJECT",
      input,
      state,
      exam,
      [this.scope(exam)],
      async () => {
        const setting = await this.sql(
          "SELECT * FROM exam_subject_settings WHERE id=? AND exam_id=?",
          text(input.settingId),
          exam.id,
        ).first<Row>();
        if (!setting) return fail("SETTING_NOT_FOUND", 404);
        if (version(input.settingVersion) !== setting.version)
          fail("SETTING_VERSION_CONFLICT", 409);
        if (
          setting.held !== Number(input.held) &&
          (await this.sql(
            "SELECT id FROM score_items WHERE setting_id=? AND origin='LOCAL' LIMIT 1",
            input.settingId,
          ).first())
        )
          fail("SETTING_HAS_SCORES", 409);
        return {
          result: { examId, version: exam.version + 1, count: 1 },
          writes: [
            this.sql(
              "UPDATE exam_subject_settings SET held=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?",
              Number(input.held),
              input.settingVersion,
              input.settingId,
            ),
          ],
        };
      },
    );
  }
  async previewRoster(
    session: AuthSession,
    examId: string,
    input: {
      classId: string;
      overrides?: { studentId: string; eligible: boolean | null }[];
    },
  ) {
    const state = await this.state(),
      exam = await this.exam(examId),
      classId = text(input.classId);
    await this.access(session, true, this.scope(exam, { classId }));
    this.draft(exam, state);
    const overrides = input.overrides ?? [];
    if (!Array.isArray(overrides)) fail("INVALID_OVERRIDES");
    const map = new Map<string, boolean | null>();
    for (const item of overrides) {
      if (
        !item ||
        typeof item !== "object" ||
        Object.keys(item).some(
          (key) => !["studentId", "eligible"].includes(key),
        ) ||
        (item.eligible !== null && typeof item.eligible !== "boolean") ||
        map.has(text(item.studentId))
      )
        fail("INVALID_OVERRIDES");
      map.set(text(item.studentId), item.eligible);
    }
    const rows = (
      await this.sql(
        "SELECT e.id AS enrollment_id,e.student_id,e.class_id,e.seat_number,c.code,c.grade,s.ranking_eligible_default,p.ranking_eligible AS term_override FROM student_enrollments e JOIN students s ON s.id=e.student_id JOIN classes c ON c.id=e.class_id LEFT JOIN student_term_ranking_policies p ON p.student_id=e.student_id AND p.academic_term_id=e.academic_term_id WHERE e.academic_term_id=? AND e.class_id=? AND e.status='valid' AND e.effective_from<=? AND (e.effective_to IS NULL OR e.effective_to>?) AND s.status='active' AND s.deleted_at IS NULL AND c.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM exam_participations x WHERE x.exam_id=? AND x.student_id=e.student_id AND x.origin='LOCAL') ORDER BY e.seat_number,e.student_id",
        exam.academic_term_id,
        classId,
        exam.starts_on,
        exam.starts_on,
        exam.id,
      ).all<Row>()
    ).results;
    if ([...map.keys()].some((id) => !rows.some((r) => r.student_id === id)))
      fail("OVERRIDE_OUTSIDE_ROSTER");
    const roster: RosterRow[] = rows.map((row) => {
      const values = {
        studentDefault: row.ranking_eligible_default === 1,
        termOverride:
          row.term_override === null ? null : row.term_override === 1,
        examOverride: map.get(String(row.student_id)) ?? null,
      };
      return {
        studentId: String(row.student_id),
        enrollmentId: String(row.enrollment_id),
        classId,
        classCode: String(row.code),
        grade: Number(row.grade),
        seatNumber: Number(row.seat_number),
        ...values,
        rankingEligible: resolveRankingEligibility({
          ...values,
          origin: "LOCAL",
        }),
      };
    });
    const previewId = crypto.randomUUID();
    await this.sql(
      "INSERT INTO exam_roster_previews (id,actor_id,exam_id,class_id,exam_version,academic_revision,roster_json,created_at) VALUES (?,?,?,?,?,?,?,?)",
      previewId,
      session.adminId,
      exam.id,
      classId,
      exam.version,
      state.revision,
      JSON.stringify(roster),
      this.now(),
    ).run();
    return {
      previewId,
      examId,
      expectedVersion: exam.version,
      academicRevision: state.revision,
      rows: roster,
      requiresConfirmation: true,
    };
  }
  async confirmRoster(
    session: AuthSession,
    examId: string,
    input: Command & { previewId: string },
  ) {
    confirmed(input);
    const state = await this.state(),
      exam = await this.exam(examId);
    const preview = await this.sql(
      "SELECT * FROM exam_roster_previews WHERE id=? AND actor_id=? AND exam_id=?",
      text(input.previewId),
      session.adminId,
      exam.id,
    ).first<Row>();
    if (!preview) return fail("PREVIEW_NOT_FOUND", 404);
    const resource = this.scope(exam, { classId: String(preview.class_id) });
    return this.command(
      session,
      "ROSTER",
      input,
      state,
      exam,
      [resource],
      async () => {
        if (
          preview.exam_version !== exam.version ||
          preview.academic_revision !== state.revision
        )
          fail("STALE_ROSTER_PREVIEW", 409);
        const rows = JSON.parse(String(preview.roster_json)) as RosterRow[];
        if (!rows.length) fail("EMPTY_ROSTER");
        return {
          result: { examId, version: exam.version + 1, count: rows.length },
          writes: rows.map((r) =>
            this.sql(
              "INSERT INTO exam_participations (id,exam_id,academic_term_id,student_id,enrollment_id,class_id_snapshot,class_code_snapshot,grade_snapshot,seat_number_snapshot,origin,student_eligibility_snapshot,term_eligibility_snapshot,exam_eligibility_override,ranking_eligible,confirmed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,'LOCAL',?,?,?,?,?,?)",
              crypto.randomUUID(),
              exam.id,
              exam.academic_term_id,
              r.studentId,
              r.enrollmentId,
              r.classId,
              r.classCode,
              r.grade,
              r.seatNumber,
              Number(r.studentDefault),
              r.termOverride === null ? null : Number(r.termOverride),
              r.examOverride === null ? null : Number(r.examOverride),
              Number(r.rankingEligible),
              this.now(),
              this.now(),
            ),
          ),
        };
      },
      String(preview.id),
    );
  }
  private async externalScope(
    studentId: string,
    subject?: string,
  ): Promise<ScopeResource> {
    const today = taipeiBusinessDate(this.now());
    const rows = (
      await this.sql(
        "SELECT e.class_id,e.academic_term_id FROM student_enrollments e JOIN students s ON s.id=e.student_id JOIN classes c ON c.id=e.class_id WHERE e.student_id=? AND e.status='valid' AND e.effective_from<=? AND (e.effective_to IS NULL OR e.effective_to>?) AND s.status='active' AND s.deleted_at IS NULL AND c.archived_at IS NULL",
        studentId,
        today,
        today,
      ).all<Row>()
    ).results;
    if (rows.length !== 1) return fail("STUDENT_SCOPE_UNAVAILABLE", 403);
    return {
      academicTermId: String(rows[0].academic_term_id),
      classId: String(rows[0].class_id),
      studentId,
      onDate: today,
      subject,
    };
  }
  async addExternalParticipation(
    session: AuthSession,
    examId: string,
    input: Command & { studentId: string; schoolLabel: string },
  ) {
    confirmed(input);
    const state = await this.state(),
      exam = await this.exam(examId);
    const studentId = text(input.studentId),
      label = text(input.schoolLabel);
    const resource = await this.externalScope(studentId);
    return this.command(
      session,
      "EXTERNAL",
      input,
      state,
      exam,
      [resource],
      async () => {
        const row = await this.sql(
          "SELECT s.ranking_eligible_default,p.ranking_eligible AS term_override FROM students s LEFT JOIN student_term_ranking_policies p ON p.student_id=s.id AND p.academic_term_id=? WHERE s.id=?",
          exam.academic_term_id,
          studentId,
        ).first<Row>();
        if (!row) return fail("STUDENT_NOT_FOUND", 404);
        const id = crypto.randomUUID();
        return {
          result: {
            examId,
            version: exam.version + 1,
            count: 1,
            participationId: id,
          },
          writes: [
            this.sql(
              "INSERT INTO exam_participations (id,exam_id,academic_term_id,student_id,origin,external_school_label,student_eligibility_snapshot,term_eligibility_snapshot,ranking_eligible,confirmed_at,created_at) VALUES (?,?,?,?,'EXTERNAL_TRANSFER',?,?,?,0,?,?)",
              id,
              exam.id,
              exam.academic_term_id,
              studentId,
              label,
              row.ranking_eligible_default,
              row.term_override,
              this.now(),
              this.now(),
            ),
          ],
        };
      },
    );
  }
  private async participationResource(exam: Exam, part: Row, subject?: string) {
    return part.origin === "LOCAL"
      ? this.scope(exam, { participationId: String(part.id), subject })
      : this.externalScope(String(part.student_id), subject);
  }
  async writeDraftScores(
    session: AuthSession,
    examId: string,
    input: Command & { scores: ScoreInput[]; reason?: string },
  ) {
    if (!Array.isArray(input.scores) || !input.scores.length)
      fail("INVALID_SCORE_BATCH");
    const state = await this.state(),
      exam = await this.exam(examId);
    const resources: ScopeResource[] = [],
      entries: {
        input: ScoreInput;
        part: Row;
        setting: Row;
        parsed: ReturnType<typeof parseScore>;
        old: Row | null;
      }[] = [];
    const seen = new Set<string>();
    for (const item of input.scores) {
      if (
        !item ||
        typeof item !== "object" ||
        Object.keys(item).some(
          (k) =>
            ![
              "participationId",
              "settingId",
              "expectedVersion",
              "value",
            ].includes(k),
        )
      )
        fail("INVALID_SCORE_INPUT");
      version(item.expectedVersion, 0);
      const part = await this.sql(
        "SELECT * FROM exam_participations WHERE id=? AND exam_id=?",
        text(item.participationId),
        exam.id,
      ).first<Row>();
      const setting = await this.sql(
        "SELECT * FROM exam_subject_settings WHERE id=? AND exam_id=?",
        text(item.settingId),
        exam.id,
      ).first<Row>();
      if (!part || !setting) return fail("SCORE_TARGET_NOT_FOUND", 404);
      const resource = await this.participationResource(
        exam,
        part,
        String(setting.subject),
      );
      await this.access(session, true, resource);
      resources.push(resource);
      const key = `${item.participationId}:${item.settingId}`;
      if (seen.has(key)) fail("DUPLICATE_SCORE_TARGET");
      seen.add(key);
      const parsed = parseScore(item.value);
      if (
        part.origin === "LOCAL" &&
        (setting.held === 0) !== (parsed.scoreStatus === "NOT_HELD")
      )
        fail("SCORE_HELD_MISMATCH");
      const old = await this.sql(
        "SELECT * FROM score_items WHERE participation_id=? AND setting_id=?",
        item.participationId,
        item.settingId,
      ).first<Row>();
      entries.push({ input: item, part, setting, parsed, old });
    }
    const reason =
      input.reason === undefined ? "Draft score entry" : text(input.reason);
    return this.command(
      session,
      "SCORES",
      input,
      state,
      exam,
      resources,
      async () => {
        const writes: D1PreparedStatement[] = [];
        for (const entry of entries) {
          const { part, setting, parsed, old } = entry,
            fromVersion = Number(old?.version ?? 0);
          if (entry.input.expectedVersion !== fromVersion)
            fail("SCORE_VERSION_CONFLICT", 409);
          // Transfers/soft deletion stop all new draft writes, including edits of existing items.
          if (
            !(await this.sql(
              "SELECT id FROM students WHERE id=? AND status='active' AND deleted_at IS NULL",
              part.student_id,
            ).first())
          )
            fail("STUDENT_NOT_ACTIVE", 409);
          if (
            part.class_id_snapshot &&
            !(await this.sql(
              "SELECT id FROM classes WHERE id=? AND archived_at IS NULL",
              part.class_id_snapshot,
            ).first())
          )
            fail("CLASS_ARCHIVED", 409);
          const id = String(old?.id ?? crypto.randomUUID()),
            now = this.now();
          const ranking =
            part.origin === "LOCAL" ? Number(part.ranking_eligible) : 0;
          if (old)
            writes.push(
              this.sql(
                "UPDATE score_items SET score_value=?,score_status=?,include_in_average=?,include_in_ranking=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END,updated_at=? WHERE id=?",
                parsed.scoreValue,
                parsed.scoreStatus,
                parsed.includeInAverage,
                ranking,
                fromVersion,
                now,
                id,
              ),
            );
          else
            writes.push(
              this.sql(
                "INSERT INTO score_items (id,participation_id,setting_id,exam_id,student_id,exam_type,subject,origin,class_id_snapshot,score_value,score_status,include_in_average,include_in_ranking,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                id,
                part.id,
                setting.id,
                exam.id,
                part.student_id,
                setting.exam_type,
                setting.subject,
                part.origin,
                part.class_id_snapshot,
                parsed.scoreValue,
                parsed.scoreStatus,
                parsed.includeInAverage,
                ranking,
                now,
                now,
              ),
            );
          const before = old
            ? {
                scoreValue: old.score_value,
                scoreStatus: old.score_status,
                includeInAverage: old.include_in_average,
                includeInRanking: old.include_in_ranking,
              }
            : null;
          writes.push(
            this.sql(
              "INSERT INTO score_change_history (id,score_item_id,student_id,actor_id,operation_id,reason,before_json,after_json,from_version,to_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
              crypto.randomUUID(),
              id,
              part.student_id,
              session.adminId,
              input.operationId,
              reason,
              JSON.stringify(before),
              JSON.stringify({ ...parsed, includeInRanking: ranking }),
              fromVersion,
              fromVersion + 1,
              now,
            ),
          );
        }
        return {
          result: { examId, version: exam.version + 1, count: entries.length },
          writes,
        };
      },
    );
  }
  async readExam(
    session: AuthSession,
    examId: string,
    input: { classId: string; subject?: string },
  ) {
    const exam = await this.exam(examId),
      classId = text(input.classId);
    if (
      input.subject !== undefined &&
      !SUBJECTS.includes(input.subject as never)
    )
      fail("INVALID_SUBJECT");
    await this.access(
      session,
      false,
      this.scope(exam, { classId, subject: input.subject }),
    );
    const settings = (
      await this.sql(
        "SELECT id,exam_type,subject,held,version FROM exam_subject_settings WHERE exam_id=? AND (? IS NULL OR subject=?) ORDER BY exam_type,subject",
        exam.id,
        input.subject ?? null,
        input.subject ?? null,
      ).all<Row>()
    ).results;
    const parts = (
      await this.sql(
        "SELECT id,student_id,class_id_snapshot,class_code_snapshot,grade_snapshot,seat_number_snapshot,ranking_eligible FROM exam_participations WHERE exam_id=? AND class_id_snapshot=? AND origin='LOCAL' ORDER BY seat_number_snapshot",
        exam.id,
        classId,
      ).all<Row>()
    ).results;
    const scores = (
      await this.sql(
        "SELECT s.* FROM score_items s WHERE s.exam_id=? AND s.class_id_snapshot=? AND s.origin='LOCAL' AND (? IS NULL OR s.subject=?)",
        exam.id,
        classId,
        input.subject ?? null,
        input.subject ?? null,
      ).all<Row>()
    ).results;
    return {
      exam,
      settings,
      participants: parts.map((p) => ({
        ...p,
        scores: settings.map((s) =>
          this.displayScore(
            s,
            scores.find(
              (x) => x.participation_id === p.id && x.setting_id === s.id,
            ) ?? null,
            "LOCAL",
          ),
        ),
      })),
    };
  }
  private displayScore(setting: Row, score: Row | null, origin: string) {
    return {
      settingId: setting.id,
      examType: setting.exam_type,
      subject: setting.subject,
      scoreStatus:
        score?.score_status ??
        (origin === "LOCAL" && setting.held === 0 ? "NOT_HELD" : "UNENTERED"),
      scoreValue: score?.score_value ?? null,
      displayValue: scoreDisplay(
        score?.score_value == null ? null : Number(score.score_value),
      ),
      version: score?.version ?? 0,
    };
  }
  async readParticipation(
    session: AuthSession,
    participationId: string,
    subject?: string,
  ) {
    if (subject !== undefined && !SUBJECTS.includes(subject as never))
      fail("INVALID_SUBJECT");
    const part = await this.sql(
      "SELECT * FROM exam_participations WHERE id=?",
      text(participationId),
    ).first<Row>();
    if (!part) return fail("PARTICIPATION_NOT_FOUND", 404);
    const exam = await this.exam(String(part.exam_id));
    await this.access(
      session,
      false,
      await this.participationResource(exam, part, subject),
    );
    const settings = (
      await this.sql(
        "SELECT * FROM exam_subject_settings WHERE exam_id=? AND (? IS NULL OR subject=?) ORDER BY exam_type,subject",
        exam.id,
        subject ?? null,
        subject ?? null,
      ).all<Row>()
    ).results;
    const scores = (
      await this.sql(
        "SELECT * FROM score_items WHERE participation_id=? AND (? IS NULL OR subject=?)",
        part.id,
        subject ?? null,
        subject ?? null,
      ).all<Row>()
    ).results;
    return {
      participation: part,
      examVersion: exam.version,
      scores: settings.map((s) =>
        this.displayScore(
          s,
          scores.find((x) => x.setting_id === s.id) ?? null,
          String(part.origin),
        ),
      ),
    };
  }
}
