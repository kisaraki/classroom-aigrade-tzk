import { AuthorizationService } from "../auth/authorization.ts";
import { AuthError, type AuthSession } from "../auth/types.ts";
import { addCalendarMonths, taipeiBusinessDate } from "../../domain/dates.ts";
import { SUBJECTS } from "../../domain/scores.ts";
import { referenceSearchQuery } from "../../domain/rag-text.ts";
import { fingerprint } from "../references/parse.ts";
import {
  AIProviderError,
  type AIProvider,
  type AIOutput,
  type ProviderConfiguration,
} from "./provider.ts";
import { readAISettings } from "./settings.ts";
import {
  AdviceError,
  adviceFail,
  validateAdvice,
  ADVICE_PROMPT_VERSION,
  type AdviceAudience,
  assertAIPrivacy,
} from "./advice.ts";
import {
  assembleAdviceContext,
  adviceInput,
  type AdviceSnapshot,
} from "./context.ts";

type Row = Record<string, string | number | null>;
export const JOB_POLICY = Object.freeze({
  leaseMs: 300_000,
  attempts: 3,
  retryMs: [60_000, 300_000],
});
const temporary = new Set([
  "AI_TIMEOUT",
  "AI_NETWORK",
  "AI_RATE_LIMITED",
  "AI_UPSTREAM_UNAVAILABLE",
]);
type Reference = {
  id: number;
  material_id: string;
  material_version: number;
  content_hash: string;
  title: string;
  content: string;
};
export class AIJobService {
  private readonly db: D1Database;
  private readonly now: () => number;
  private readonly authz: AuthorizationService;
  private readonly provider: (
    configuration: ProviderConfiguration,
  ) => AIProvider;
  constructor(deps: {
    db: D1Database;
    provider: (configuration: ProviderConfiguration) => AIProvider;
    now?: () => number;
  }) {
    this.db = deps.db;
    this.now = deps.now ?? Date.now;
    this.authz = new AuthorizationService(deps);
    this.provider = deps.provider;
  }
  private sql(query: string, ...values: (string | number | null)[]) {
    return this.db.prepare(query).bind(...values);
  }
  private async source(examId: string, studentId: string) {
    const part = await this.sql(
      `SELECT p.*,e.sequence,e.starts_on,e.academic_term_id,t.academic_year_id,a.revision
      FROM exam_participations p JOIN exams e ON e.id=p.exam_id JOIN academic_terms t ON t.id=e.academic_term_id CROSS JOIN academic_state a
      WHERE p.exam_id=? AND p.student_id=? AND p.origin='LOCAL' AND a.id=1`,
      examId,
      studentId,
    ).first<Row>();
    if (!part) return adviceFail("AI_TARGET_NOT_FOUND", 404);
    const latest = await this.sql(
      "SELECT v.*,s.snapshot_json FROM exam_result_versions v JOIN publication_snapshots s ON s.result_version_id=v.id WHERE v.exam_id=? AND v.published_at IS NOT NULL ORDER BY v.version DESC LIMIT 1",
      examId,
    ).first<Row>();
    if (!latest) return adviceFail("AI_PUBLICATION_REQUIRED");
    const previous = await this.sql(
      `SELECT v.*,s.snapshot_json FROM exams e JOIN exam_result_versions v ON v.exam_id=e.id JOIN publication_snapshots s ON s.result_version_id=v.id
      WHERE e.academic_term_id=? AND e.sequence=? AND v.published_at IS NOT NULL ORDER BY v.version DESC LIMIT 1`,
      part.academic_term_id,
      Number(part.sequence) - 1,
    ).first<Row>();
    return { part, latest, previous };
  }
  private resource(part: Row) {
    return {
      academicTermId: String(part.academic_term_id),
      classId: String(part.class_id_snapshot),
      onDate: String(part.starts_on),
    };
  }
  private async principal(job: Row, part: Row) {
    await this.authz.assertAIBackgroundPrincipal(
      String(job.requested_by),
      Number(job.request_auth_version),
      this.resource(part),
    );
  }
  /** The audit insert deliberately fails the whole D1 batch when any guard is false. */
  private guard(
    job: Row,
    source: Awaited<ReturnType<AIJobService["source"]>>,
    action: string,
    extra = "1",
    extraValues: (string | number | null)[] = [],
  ) {
    const now = this.now();
    return this.sql(
      `INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until)
      SELECT ?,?,CASE WHEN (SELECT revision FROM academic_state WHERE id=1)=?
      AND NOT EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE')
      AND EXISTS(SELECT 1 FROM students WHERE id=? AND status='active' AND deleted_at IS NULL AND archived_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM purged_exams WHERE exam_id IN (?,?))
      AND ?=(SELECT id FROM exam_result_versions WHERE exam_id=? AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1)
      AND ? IS (SELECT v.id FROM exams e JOIN exam_result_versions v ON v.exam_id=e.id WHERE e.academic_term_id=? AND e.sequence=? AND v.published_at IS NOT NULL ORDER BY v.version DESC LIMIT 1)
      AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('ai_provider','ai_model') AND version=?)=2
      AND EXISTS(SELECT 1 FROM admin_users a WHERE a.id=? AND a.status='active' AND a.google_subject_id IS NOT NULL AND a.auth_version=?
        AND (a.role='super_admin' OR (a.role='ai_admin' AND EXISTS(SELECT 1 FROM admin_assignments x WHERE x.admin_user_id=a.id AND x.academic_term_id=? AND x.starts_on<=? AND (x.ends_on IS NULL OR x.ends_on>?)
          AND (x.scope_type='school' OR (x.scope_type='grade' AND x.grade=?) OR (x.scope_type IN ('class','homeroom') AND x.class_id=?))))))
      AND (${extra}) THEN ? ELSE NULL END,'ai_job',?,?,'success','{}',?,?`,
      crypto.randomUUID(),
      job.requested_by,
      source.part.revision,
      job.student_id,
      job.exam_id,
      source.previous?.exam_id ?? null,
      job.result_version_id,
      job.exam_id,
      job.previous_result_id,
      source.part.academic_term_id,
      Number(source.part.sequence) - 1,
      job.configuration_version,
      job.requested_by,
      job.request_auth_version,
      source.part.academic_term_id,
      source.part.starts_on,
      source.part.starts_on,
      source.part.grade_snapshot,
      source.part.class_id_snapshot,
      ...extraValues,
      action,
      job.id,
      crypto.randomUUID(),
      now,
      addCalendarMonths(taipeiBusinessDate(now), 2),
    );
  }
  async request(
    session: AuthSession,
    input: {
      examId: string;
      studentId: string;
      confirmed: boolean;
      retry?: boolean;
    },
  ) {
    if (
      !input ||
      Object.keys(input).some(
        (k) => !["examId", "studentId", "confirmed", "retry"].includes(k),
      ) ||
      input.confirmed !== true ||
      typeof input.examId !== "string" ||
      typeof input.studentId !== "string" ||
      (input.retry !== undefined && typeof input.retry !== "boolean")
    )
      return adviceFail("AI_REQUEST_INVALID", 400);
    const source = await this.source(input.examId, input.studentId);
    await this.authz.assertPermission(
      session,
      "ai.manage",
      this.resource(source.part),
    );
    const settings = await readAISettings(this.db);
    if (!settings.configuration) return adviceFail("AI_CONFIGURATION_REQUIRED");
    const actor = await this.sql(
      "SELECT auth_version FROM admin_users WHERE id=?",
      session.adminId,
    ).first<Row>();
    const pair = JSON.stringify([
      source.latest.id,
      source.previous?.id ?? null,
      input.studentId,
      settings.version,
      ADVICE_PROMPT_VERSION,
    ]);
    const job: Row = {
      id: crypto.randomUUID(),
      pair_key: pair,
      student_id: input.studentId,
      exam_id: input.examId,
      result_version_id: source.latest.id,
      source_version: source.latest.source_version,
      previous_result_id: source.previous?.id ?? null,
      requested_by: session.adminId,
      request_auth_version: actor!.auth_version,
      configuration_version: settings.version,
    };
    const existing = (
      await this.sql(
        "SELECT status FROM ai_jobs WHERE pair_key=?",
        pair,
      ).all<Row>()
    ).results;
    if (
      existing.length &&
      (!input.retry || existing.some((r) => r.status !== "failed"))
    )
      return { pairKey: pair, replayed: true };
    const writes = [
      this.guard(
        job,
        source,
        "AI_REQUEST",
        "EXISTS(SELECT 1 FROM admin_sessions WHERE id=? AND admin_user_id=? AND auth_version=? AND revoked_at IS NULL AND expires_at>? AND last_seen_at>? AND last_seen_at<=?)",
        [
          session.sessionId,
          session.adminId,
          actor!.auth_version,
          this.now(),
          this.now() - 1800000,
          this.now(),
        ],
      ),
    ];
    if (existing.length)
      writes.push(
        this.sql(
          `UPDATE ai_jobs SET status='pending',attempt_count=0,next_attempt_at=NULL,error_code=NULL,completed_at=NULL,lease_token_hash=NULL,lease_expires_at=NULL,requested_by=?,request_auth_version=?,updated_at=? WHERE pair_key=? AND status='failed'`,
          session.adminId,
          actor!.auth_version,
          this.now(),
          pair,
        ),
      );
    else
      for (const audience of ["parent", "student"])
        writes.push(
          this.sql(
            `INSERT INTO ai_jobs (id,student_id,exam_id,result_version_id,audience,dedupe_key,source_version,pair_key,requested_by,request_auth_version,previous_result_id,configuration_version,provider,model,prompt_version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            audience === "parent" ? job.id : crypto.randomUUID(),
            job.student_id,
            job.exam_id,
            job.result_version_id,
            audience,
            `${pair}:${audience}`,
            job.source_version,
            pair,
            job.requested_by,
            job.request_auth_version,
            job.previous_result_id,
            settings.version,
            settings.configuration.provider,
            settings.configuration.model,
            ADVICE_PROMPT_VERSION,
            this.now(),
            this.now(),
          ),
        );
    try {
      await this.db.batch(writes);
    } catch {
      return adviceFail("AI_JOB_CONFLICT");
    }
    return { pairKey: pair, replayed: false };
  }
  private async identifiers() {
    const rows = (
      await this.db
        .prepare("SELECT id,name,student_number,birth_date FROM students")
        .all<Row>()
    ).results;
    const admins = (
      await this.db
        .prepare("SELECT id,display_name,authorized_email FROM admin_users")
        .all<Row>()
    ).results;
    return [...rows, ...admins].flatMap((row) =>
      Object.values(row).filter(
        (v): v is string => typeof v === "string" && !!v,
      ),
    );
  }
  private async references(grade: number, identifiers: string[]) {
    const labels = ["國文", "英文", "數學", "自然", "地理", "歷史", "公民"];
    const date = taipeiBusinessDate(this.now()),
      selected = new Map<number, Reference>();
    for (const [index, subject] of SUBJECTS.entries()) {
      const rows = (
        await this.sql(
          `SELECT c.id,c.material_id,c.material_version,c.content_hash,c.content,m.title FROM reference_search
        JOIN ai_reference_chunks c ON c.id=reference_search.rowid JOIN ai_reference_materials m ON m.id=c.material_id
        WHERE reference_search MATCH ? AND m.status='active' AND c.material_version=m.version AND (m.subject IS NULL OR m.subject=?) AND (m.grade IS NULL OR m.grade=?)
        AND (m.valid_from IS NULL OR m.valid_from<=?) AND (m.valid_to IS NULL OR m.valid_to>?) ORDER BY bm25(reference_search),c.id LIMIT 8`,
          referenceSearchQuery(labels[index]),
          subject,
          grade,
          date,
          date,
        ).all<Reference>()
      ).results;
      for (const row of rows) {
        assertAIPrivacy(row.content, identifiers);
        assertAIPrivacy(row.title, identifiers);
        if ((await fingerprint(row.content)) !== row.content_hash)
          return adviceFail("AI_REFERENCE_CHANGED");
        selected.set(row.id, row);
        if (selected.size === 8) break;
      }
      if (selected.size === 8) break;
    }
    return [...selected.values()];
  }
  private async failPair(
    pair: string,
    lease: string | null,
    code: string,
    attempt: number,
  ) {
    const retry = temporary.has(code) && attempt < JOB_POLICY.attempts;
    const result = await this.sql(
      `UPDATE ai_jobs SET status=?,error_code=?,next_attempt_at=?,lease_token_hash=NULL,lease_expires_at=NULL,updated_at=? WHERE pair_key=? AND status IN ('pending','processing') AND lease_token_hash IS ?`,
      retry ? "pending" : "failed",
      code,
      retry ? this.now() + JOB_POLICY.retryMs[attempt - 1] : null,
      this.now(),
      pair,
      lease,
    ).run();
    return result.meta.changes ? (retry ? "pending" : "failed") : "superseded";
  }
  /** Internal one-pair consumer. An external durable scheduler must invoke this, never an HTTP waitUntil loop. */
  async consumeOne(signal?: AbortSignal) {
    const job = await this.sql(
      `SELECT * FROM ai_jobs WHERE audience='parent' AND pair_key IS NOT NULL AND requested_by IS NOT NULL
      AND ((status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)) OR (status='processing' AND lease_expires_at<=?)) ORDER BY created_at,id LIMIT 1`,
      this.now(),
      this.now(),
    ).first<Row>();
    if (!job) return { status: "idle" };
    const pair = String(job.pair_key);
    let lease: string | null = job.lease_token_hash as string | null;
    let attempt = Number(job.attempt_count);
    try {
      const source = await this.source(
        String(job.exam_id),
        String(job.student_id),
      );
      await this.principal(job, source.part);
      if (
        job.result_version_id !== source.latest.id ||
        job.previous_result_id !== (source.previous?.id ?? null) ||
        (await readAISettings(this.db)).version !== job.configuration_version
      )
        return adviceFail("AI_SOURCE_CHANGED");
      if (attempt >= JOB_POLICY.attempts)
        return adviceFail("AI_ATTEMPTS_EXHAUSTED");
      const candidate = await fingerprint(crypto.randomUUID());
      await this.db.batch([
        this.guard(
          job,
          source,
          "AI_CLAIM",
          `(SELECT COUNT(*) FROM ai_jobs WHERE pair_key=? AND attempt_count=? AND ((status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)) OR (status='processing' AND lease_expires_at<=?)))=2`,
          [pair, attempt, this.now(), this.now()],
        ),
        this.sql(
          "UPDATE ai_jobs SET status='processing',attempt_count=attempt_count+1,lease_token_hash=?,lease_expires_at=?,updated_at=? WHERE pair_key=?",
          candidate,
          this.now() + JOB_POLICY.leaseMs,
          this.now(),
          pair,
        ),
      ]);
      lease = candidate;
      attempt++;
      const ids = await this.identifiers();
      const current = {
        ...JSON.parse(String(source.latest.snapshot_json)),
        sequence: Number(source.part.sequence),
      } as AdviceSnapshot;
      const previous = source.previous
        ? ({
            ...JSON.parse(String(source.previous.snapshot_json)),
            sequence: Number(source.part.sequence) - 1,
          } as AdviceSnapshot)
        : null;
      const context = assembleAdviceContext(
        current,
        String(job.student_id),
        previous,
      );
      const references = await this.references(
        Number(source.part.grade_snapshot),
        ids,
      );
      const outputs: {
        audience: AdviceAudience;
        output: AIOutput;
        content: string;
        duration: number;
      }[] = [];
      const provider = this.provider({
        provider: job.provider as ProviderConfiguration["provider"],
        model: String(job.model),
      });
      for (const audience of ["parent", "student"] as const) {
        await this.principal(job, source.part);
        const live = await this.source(
          String(job.exam_id),
          String(job.student_id),
        );
        const active = await this.sql(
          "SELECT id FROM students WHERE id=? AND status='active' AND deleted_at IS NULL AND archived_at IS NULL",
          job.student_id,
        ).first();
        if (
          !active ||
          live.latest.id !== job.result_version_id ||
          (live.previous?.id ?? null) !== job.previous_result_id ||
          (await readAISettings(this.db)).version !== job.configuration_version
        )
          return adviceFail("AI_SOURCE_CHANGED");
        if (
          !(await this.sql(
            "SELECT id FROM ai_jobs WHERE id=? AND lease_token_hash=? AND lease_expires_at>? AND status='processing'",
            job.id,
            lease,
            this.now(),
          ).first())
        )
          return adviceFail("AI_LEASE_EXPIRED");
        if (signal?.aborted) return adviceFail("AI_CANCELLED");
        const start = this.now();
        const output = await provider.generate(
          adviceInput(
            context,
            audience,
            references.map((r) => ({ text: r.content })),
            await this.identifiers(),
          ),
          signal,
        );
        if (output.provider !== job.provider || output.model !== job.model)
          return adviceFail("AI_CONFIGURATION_CHANGED");
        const content = JSON.stringify(
          validateAdvice(output.text, audience, await this.identifiers()),
        );
        outputs.push({
          audience,
          output,
          content,
          duration: Math.max(0, this.now() - start),
        });
      }
      const fresh = await this.source(
        String(job.exam_id),
        String(job.student_id),
      );
      await this.principal(job, fresh.part);
      const finalIdentifiers = await this.identifiers();
      for (const output of outputs)
        validateAdvice(output.content, output.audience, finalIdentifiers);
      // The same lease guards all inserts, references and completion; partial advice is never published.
      const writes = [
        this.guard(
          job,
          fresh,
          "AI_COMPLETE",
          "(SELECT COUNT(*) FROM ai_jobs WHERE pair_key=? AND status='processing' AND lease_token_hash=? AND lease_expires_at>?)=2",
          [pair, lease, this.now()],
        ),
      ];
      for (const reference of references)
        writes.push(
          this.guard(
            job,
            fresh,
            "AI_REFERENCE_CHECK",
            "EXISTS(SELECT 1 FROM ai_reference_materials WHERE id=? AND status='active' AND version=? AND (valid_from IS NULL OR valid_from<=?) AND (valid_to IS NULL OR valid_to>?))",
            [
              reference.material_id,
              reference.material_version,
              taipeiBusinessDate(this.now()),
              taipeiBusinessDate(this.now()),
            ],
          ),
        );
      const jobs = (
        await this.sql(
          "SELECT * FROM ai_jobs WHERE pair_key=?",
          pair,
        ).all<Row>()
      ).results;
      writes.push(
        this.sql(
          "UPDATE ai_advices SET stale_at=COALESCE(stale_at,?) WHERE exam_id=? AND student_id=?",
          this.now(),
          job.exam_id,
          job.student_id,
        ),
      );
      const version = Number(
        (await this.sql(
          "SELECT COALESCE(MAX(version),0)+1 AS v FROM ai_advices WHERE student_id=? AND exam_id=?",
          job.student_id,
          job.exam_id,
        ).first<Row>())!.v,
      );
      for (const result of outputs) {
        const member = jobs.find((j) => j.audience === result.audience)!;
        const adviceId = crypto.randomUUID();
        writes.push(
          this.sql(
            `INSERT INTO ai_advices (id,job_id,student_id,exam_id,audience,version,source_version,provider,model,prompt_version,content,input_tokens,output_tokens,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            adviceId,
            member.id,
            job.student_id,
            job.exam_id,
            result.audience,
            version,
            job.source_version,
            job.provider,
            job.model,
            ADVICE_PROMPT_VERSION,
            result.content,
            result.output.usage?.inputTokens ?? null,
            result.output.usage?.outputTokens ?? null,
            this.now(),
          ),
        );
        for (const reference of references)
          writes.push(
            this.sql(
              "INSERT INTO ai_advice_references (id,advice_id,chunk_id,material_version,title_snapshot,content_hash_snapshot) VALUES (?,?,?,?,?,?)",
              crypto.randomUUID(),
              adviceId,
              reference.id,
              reference.material_version,
              reference.title,
              reference.content_hash,
            ),
          );
        writes.push(
          this.sql(
            "UPDATE ai_jobs SET status='completed',error_code=NULL,completed_at=?,updated_at=?,duration_ms=?,input_tokens=?,output_tokens=?,total_tokens=?,api_attempts=?,lease_token_hash=NULL,lease_expires_at=NULL WHERE id=?",
            this.now(),
            this.now(),
            result.duration,
            result.output.usage?.inputTokens ?? null,
            result.output.usage?.outputTokens ?? null,
            result.output.usage?.totalTokens ?? null,
            result.output.attempts,
            member.id,
          ),
        );
      }
      await this.db.batch(writes);
      return { status: "completed", pairKey: pair, version };
    } catch (error) {
      const code =
        error instanceof AIProviderError || error instanceof AdviceError
          ? error.code
          : error instanceof AuthError
            ? "AI_AUTHORIZATION_CHANGED"
            : "AI_JOB_CONFLICT";
      try {
        const status = await this.failPair(pair, lease, code, attempt);
        return { status, pairKey: pair, error: code };
      } catch {
        return {
          status: "blocked",
          pairKey: pair,
          error: "AI_PERSISTENCE_UNAVAILABLE",
        };
      }
    }
  }
  async history(session: AuthSession, examId: string, studentId: string) {
    const source = await this.source(examId, studentId);
    await this.authz.assertPermission(
      session,
      "ai.read",
      this.resource(source.part),
    );
    const rows = (
      await this.sql(
        "SELECT id,audience,version,content,stale_at,provider,model,created_at FROM ai_advices WHERE exam_id=? AND student_id=? ORDER BY version DESC,audience",
        examId,
        studentId,
      ).all<Row>()
    ).results;
    await this.authz.assertPermission(
      session,
      "ai.read",
      this.resource(source.part),
    );
    const jobs = (
      await this.sql(
        "SELECT id,audience,status,attempt_count,next_attempt_at,error_code,duration_ms,input_tokens,output_tokens,total_tokens,api_attempts,created_at FROM ai_jobs WHERE exam_id=? AND student_id=? AND pair_key IS NOT NULL ORDER BY created_at DESC,id",
        examId,
        studentId,
      ).all<Row>()
    ).results;
    await this.authz.assertPermission(
      session,
      "ai.read",
      this.resource(source.part),
    );
    return { versions: rows, jobs };
  }
}
