import { AuthorizationService } from "../auth/authorization.ts";
import type { AuthSession, ScopeResource } from "../auth/types.ts";
import {
  RECENT_AUTH_WINDOW_MS,
  SESSION_IDLE_TIMEOUT_MS,
} from "../auth/policy.ts";
import { ExamError } from "../../domain/scores.ts";
import {
  addCalendarMonths,
  addCalendarYears,
  taipeiBusinessDate,
} from "../../domain/dates.ts";
import { purgeBlockers, RESTORE_WINDOW_MS } from "../../domain/purge.ts";

type Row = Record<string, string | number | null>;
export type LifecycleRequest = {
  action: "DELETE" | "RESTORE" | "PURGE";
  studentIds: string[];
  reason: string;
};
export const COPY_CATEGORIES = [
  "objects",
  "imports",
  "reports",
  "exports",
  "ai",
  "cache",
  "backups",
] as const;
/** Server-owned adapter: clients cannot attest coverage, select a provider or supply keys. */
export interface PurgeCopies {
  inventory(
    studentIds: readonly string[],
    importKeys: readonly string[],
  ): Promise<{
    complete: boolean;
    categories: readonly string[];
    objects: { key: string; category: string }[];
    /** Includes every other person's restore promise affected by shared-copy deletion. */
    restorationDeadlines: readonly number[];
    evidence: string;
  }>;
  remove(key: string): Promise<void>;
  absent(key: string): Promise<boolean>;
}
type CopyPlan = Awaited<ReturnType<PurgeCopies["inventory"]>>;
type Plan = {
  request: LifecycleRequest;
  resources: ScopeResource[];
  students: Row[];
  entries: Row[];
  deletes: Record<string, string[]>;
  snapshots: { id: string; value: string }[];
  archiveUpdates: { id: string; value: string }[];
  auditIds: string[];
  frozenExams: string[];
  copyPlan: CopyPlan | null;
};
const fail = (code: string, status = 409): never => {
  throw new ExamError(code, status);
};
const text = (v: unknown) =>
  typeof v === "string" && v.trim().length > 0 && v.length <= 320
    ? v.trim()
    : fail("INVALID_LIFECYCLE_INPUT", 400);
const DOMAIN_TABLES = [
  "students",
  "student_identity_lookup_hashes",
  "student_term_ranking_policies",
  "student_enrollments",
  "exam_participations",
  "score_items",
  "score_change_history",
  "exam_results",
  "ai_jobs",
  "ai_advices",
  "ai_advice_references",
  "import_jobs",
  "import_job_items",
  "archive_batches",
  "archive_items",
  "retention_events",
  "recycle_entries",
  "academic_operations",
  "academic_operation_students",
  "academic_previews",
  "exam_operations",
  "exam_roster_previews",
  "publication_previews",
  "publication_snapshots",
  "archive_previews",
  "lifecycle_previews",
  "audit_logs",
] as const;
const ORDER = [
  "ai_advice_references",
  "ai_advices",
  "ai_jobs",
  "score_change_history",
  "exam_results",
  "score_items",
  "exam_participations",
  "student_term_ranking_policies",
  "student_identity_lookup_hashes",
  "retention_events",
  "recycle_entries",
  "student_enrollments",
  "import_job_items",
  "import_jobs",
  "archive_items",
  "archive_batches",
  "academic_operation_students",
  "academic_operations",
  "academic_previews",
  "exam_operations",
  "exam_roster_previews",
  "publication_previews",
  "archive_previews",
  "lifecycle_previews",
  "students",
];
export class LifecycleService {
  private readonly db: D1Database;
  private readonly now: () => number;
  private readonly authorization: AuthorizationService;
  private readonly copies?: PurgeCopies;
  constructor(deps: {
    db: D1Database;
    now?: () => number;
    copies?: PurgeCopies;
  }) {
    this.db = deps.db;
    this.now = deps.now ?? Date.now;
    this.copies = deps.copies;
    this.authorization = new AuthorizationService({
      ...deps,
      allowPurgeMaintenance: true,
    });
  }
  private sql(q: string, ...v: (string | number | null)[]) {
    return this.db.prepare(q).bind(...v);
  }
  private async rows(q: string, ...v: (string | number | null)[]) {
    return (await this.sql(q, ...v).all<Row>()).results;
  }
  private async revisions() {
    return (await this.sql(
      "SELECT a.revision AS a,r.revision AS r FROM academic_state a CROSS JOIN archive_state r WHERE a.id=1 AND r.id=1",
    ).first<Row>())!;
  }
  private async available() {
    if (
      await this.sql(
        "SELECT id FROM purge_jobs WHERE status<>'DONE' LIMIT 1",
      ).first()
    )
      fail("PURGE_IN_PROGRESS");
  }
  private validate(input: LifecycleRequest) {
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some(
        (k) => !["action", "studentIds", "reason"].includes(k),
      ) ||
      !["DELETE", "RESTORE", "PURGE"].includes(input.action) ||
      !Array.isArray(input.studentIds) ||
      !input.studentIds.length
    )
      fail("INVALID_LIFECYCLE_INPUT", 400);
    const ids = input.studentIds.map(text);
    if (new Set(ids).size !== ids.length) fail("DUPLICATE_STUDENT", 400);
    return {
      action: input.action,
      studentIds: ids,
      reason: text(input.reason),
    };
  }
  private async access(session: AuthSession, plan: Plan, read = false) {
    if (plan.request.action === "PURGE") {
      const g = await this.authorization.assertPermission(
        session,
        "archive.manage",
        undefined,
        true,
      );
      if (g.role !== "super_admin") fail("PERMISSION_DENIED", 403);
    } else
      for (const r of plan.resources)
        await this.authorization.assertPermission(
          session,
          read ? "archive.read" : "archive.manage",
          r,
          !read,
        );
  }
  private async base(request: LifecycleRequest): Promise<Plan> {
    const p: Plan = {
      request,
      resources: [],
      students: [],
      entries: [],
      deletes: {},
      snapshots: [],
      archiveUpdates: [],
      auditIds: [],
      frozenExams: [],
      copyPlan: null,
    };
    for (const id of request.studentIds) {
      const s = await this.sql(
        "SELECT id,status,version,deleted_at,retention_until,public_query_until FROM students WHERE id=?",
        id,
      ).first<Row>();
      if (!s) fail("STUDENT_NOT_FOUND", 404);
      p.students.push(s!);
      const enrollments = await this.rows(
        "SELECT academic_term_id,class_id,effective_from FROM student_enrollments WHERE student_id=? ORDER BY effective_from DESC",
        id,
      );
      if (!enrollments.length)
        p.resources.push({ studentId: id, historyReason: request.reason });
      else
        for (const e of enrollments)
          p.resources.push({
            academicTermId: String(e.academic_term_id),
            classId: String(e.class_id),
            onDate: String(e.effective_from),
            historyReason: request.reason,
          });
      const entries = await this.rows(
        "SELECT * FROM recycle_entries WHERE student_id=? AND restored_at IS NULL ORDER BY deleted_at DESC",
        id,
      );
      p.entries.push(...entries);
    }
    return p;
  }
  private async recyclePlan(p: Plan) {
    for (const s of p.students) {
      if (p.request.action === "DELETE") {
        if (s.deleted_at !== null) fail("ALREADY_DELETED");
      } else {
        const entry =
          p.entries.find((e) => e.student_id === s.id) ??
          fail("RECYCLE_RESTORE_CONFLICT");
        if (
          !entry ||
          s.deleted_at === null ||
          s.deleted_at !== entry.deleted_at ||
          s.version !== entry.source_version
        )
          fail("RECYCLE_RESTORE_CONFLICT");
        if (this.now() >= Number(entry.restore_until))
          fail("RECYCLE_RESTORE_EXPIRED");
        if (entry.enrollment_json) {
          const e = JSON.parse(String(entry.enrollment_json));
          const current = await this.sql(
            "SELECT * FROM student_enrollments WHERE id=?",
            e.id,
          ).first<Row>();
          if (
            !current ||
            current.status !== "voided" ||
            current.version !== e.version + 1
          )
            fail("RECYCLE_RESTORE_CONFLICT");
        }
      }
    }
  }
  private async purgePlan(p: Plan, excludePreviewId?: string) {
    if (!this.copies) fail("PURGE_COPY_CAPABILITY_UNVERIFIED", 503);
    // Read the related tables in one snapshot. JSON payloads are data, never executable SQL.
    const data: Record<string, Row[]> = {};
    const batches = await this.db.batch<Row>(
      DOMAIN_TABLES.map((t) => this.sql(`SELECT * FROM ${t}`)),
    );
    DOMAIN_TABLES.forEach((t, i) => {
      data[t] = batches[i].results;
    });
    const ids = new Set(p.request.studentIds);
    const selected = (table: string, column: string, values: Set<string>) =>
      data[table].filter((r) => values.has(String(r[column])));
    const add = (table: string, rows: Row[], column = "id") => {
      p.deletes[table] = [
        ...new Set([
          ...(p.deletes[table] ?? []),
          ...rows.map((r) => String(r[column])),
        ]),
      ];
      return new Set(p.deletes[table]);
    };
    const jobs = add(
      "import_jobs",
      data.import_jobs.filter((j) =>
        data.import_job_items.some(
          (i) => i.job_id === j.id && ids.has(String(i.student_id)),
        ),
      ),
    );
    // Unmapped/unfinished raw files cannot be proven disjoint from the selected students.
    if (
      data.import_jobs.some(
        (j) => !["COMMITTED", "ROLLED_BACK"].includes(String(j.status)),
      )
    )
      fail("PURGE_UNRESOLVED_IMPORT_COPY");
    for (const job of data.import_jobs.filter((j) => jobs.has(String(j.id))))
      if (
        job.status !== "ROLLED_BACK" &&
        (job.rollback_until === null || Number(job.rollback_until) > this.now())
      )
        fail("PURGE_IMPORT_PROMISE");
    const sharedStudents = new Set(
      data.import_job_items
        .filter((i) => jobs.has(String(i.job_id)))
        .map((i) => String(i.student_id)),
    );
    if (
      data.recycle_entries.some(
        (e) =>
          sharedStudents.has(String(e.student_id)) &&
          e.restored_at === null &&
          Number(e.restore_until) > this.now(),
      ) ||
      data.archive_batches.some(
        (b) =>
          b.status === "archived" &&
          Number(b.undo_until) > this.now() &&
          data.archive_items.some(
            (i) =>
              i.batch_id === b.id && sharedStudents.has(String(i.student_id)),
          ),
      )
    )
      fail("PURGE_SHARED_RESTORE_PROMISE");
    const archives = new Set(
      data.archive_batches
        .filter((b) =>
          data.archive_items.some(
            (i) => i.batch_id === b.id && ids.has(String(i.student_id)),
          ),
        )
        .map((b) => String(b.id)),
    );
    for (const b of data.archive_batches.filter((b) =>
      archives.has(String(b.id)),
    ))
      if (b.status === "archived" && Number(b.undo_until) > this.now())
        fail("PURGE_ARCHIVE_PROMISE");
    for (const s of p.students) {
      const events = selected(
        "retention_events",
        "student_id",
        new Set([String(s.id)]),
      ).filter((e) => e.revoked_at === null);
      const deadlines = [
        s.retention_until,
        ...events.map((e) => e.retention_until),
      ].filter((v): v is string => typeof v === "string");
      const publicDates = [
        s.public_query_until,
        ...events.map((e) => e.public_until),
      ].filter((v): v is string => typeof v === "string");
      const blockers = purgeBlockers(
        {
          status: String(s.status),
          deletedAt: s.deleted_at as number | null,
          retentionUntil: deadlines.sort().at(-1) ?? null,
          publicUntil: publicDates.sort().at(-1) ?? null,
          promises: p.entries
            .filter((e) => e.student_id === s.id)
            .map((e) => Number(e.restore_until)),
        },
        this.now(),
        taipeiBusinessDate(this.now()),
      );
      if (blockers.length) fail(`PURGE_BLOCKED_${blockers[0]}`);
    }
    for (const table of [
      "students",
      "student_term_ranking_policies",
      "student_enrollments",
      "exam_participations",
      "score_items",
      "score_change_history",
      "ai_jobs",
      "ai_advices",
      "retention_events",
      "recycle_entries",
    ])
      add(
        table,
        selected(table, table === "students" ? "id" : "student_id", ids),
      );
    // Tables with composite keys are deleted by student_id in the final transaction.
    p.deletes.student_identity_lookup_hashes = [...ids];
    const parts = new Set(p.deletes.exam_participations),
      advices = new Set(p.deletes.ai_advices);
    add("exam_results", selected("exam_results", "participation_id", parts));
    add(
      "ai_advice_references",
      selected("ai_advice_references", "advice_id", advices),
    );
    add("import_job_items", selected("import_job_items", "job_id", jobs));
    for (const batch of data.archive_batches.filter((b) =>
      archives.has(String(b.id)),
    )) {
      const items = data.archive_items.filter((i) => i.batch_id === batch.id);
      const remaining = items.filter(
        (i) => i.student_id !== null && !ids.has(String(i.student_id)),
      );
      if (!remaining.length) {
        add("archive_batches", [batch]);
        add("archive_items", items);
      } else {
        add(
          "archive_items",
          items.filter((i) => ids.has(String(i.student_id))),
        );
        const manifest = JSON.parse(String(batch.manifest_json));
        manifest.studentIds = (manifest.studentIds ?? []).filter(
          (id: string) => !ids.has(id),
        );
        manifest.resources = (manifest.resources ?? [])
          .filter((r: ScopeResource) => !r.studentId || !ids.has(r.studentId))
          .map((r: ScopeResource) => ({
            ...r,
            historyReason: "Retained archive after authorized purge",
          }));
        delete manifest.warnings;
        p.archiveUpdates.push({
          id: String(batch.id),
          value: JSON.stringify(manifest),
        });
      }
    }
    p.frozenExams = [
      ...new Set(
        selected("exam_participations", "student_id", ids).map((r) =>
          String(r.exam_id),
        ),
      ),
    ];
    const needles = new Set([...ids, ...Object.values(p.deletes).flat()]);
    // Free-text reasons may contain identifiers; remove the whole affected operational payload.
    for (const s of selected("students", "id", ids))
      for (const k of ["name", "student_number", "identity_number_encrypted"])
        if (typeof s[k] === "string") needles.add(String(s[k]));
    const matches = (r: Row) =>
      Object.values(r).some(
        (v) => typeof v === "string" && [...needles].some((n) => v.includes(n)),
      );
    // Iterate references to closure so undo records cannot retain a removed operation's snapshot.
    const operational = [
      "academic_operations",
      "academic_previews",
      "exam_operations",
      "exam_roster_previews",
      "publication_previews",
      "archive_previews",
      "lifecycle_previews",
    ];
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of operational)
        for (const r of data[t])
          if (
            !(t === "lifecycle_previews" && r.id === excludePreviewId) &&
            matches(r) &&
            !(p.deletes[t] ?? []).includes(String(r.id))
          ) {
            add(t, [r]);
            needles.add(String(r.id));
            changed = true;
          }
    }
    // Delete both sides of operation linkage; unrelated members of a shared operation are invalidated.
    add(
      "academic_operation_students",
      data.academic_operation_students.filter(
        (r) =>
          ids.has(String(r.student_id)) || needles.has(String(r.operation_id)),
      ),
      "operation_id",
    );
    for (const r of data.academic_operations)
      if (p.deletes.academic_operation_students?.includes(String(r.id))) {
        add("academic_operations", [r]);
        add(
          "academic_previews",
          data.academic_previews.filter((x) => x.id === r.preview_id),
        );
      }
    for (const row of data.publication_snapshots) {
      const snap = JSON.parse(String(row.snapshot_json));
      if (
        !snap.input?.participants?.some((r: { studentId: string }) =>
          ids.has(r.studentId),
        ) &&
        !snap.result?.local?.some((r: { studentId: string }) =>
          ids.has(r.studentId),
        ) &&
        !snap.result?.external?.some((r: { studentId: string }) =>
          ids.has(r.studentId),
        )
      )
        continue;
      // Keep only surviving individual results and fixed ranks. Discard all cohort inputs/statistics.
      snap.input = {};
      snap.result.local = snap.result.local.filter(
        (r: { studentId: string }) => !ids.has(r.studentId),
      );
      snap.result.external = snap.result.external.filter(
        (r: { studentId: string }) => !ids.has(r.studentId),
      );
      snap.result.classes = [];
      snap.result.grades = [];
      snap.purged = true;
      p.snapshots.push({
        id: String(row.result_version_id),
        value: JSON.stringify(snap),
      });
    }
    p.auditIds = data.audit_logs.filter(matches).map((r) => String(r.id));
    const keys = data.import_jobs
      .filter((j) => jobs.has(String(j.id)))
      .map((j) => String(j.object_key));
    const copies = await this.copies!.inventory([...ids], keys);
    if (
      !copies.complete ||
      !copies.evidence ||
      COPY_CATEGORIES.some((c) => !copies.categories.includes(c)) ||
      keys.some((key) => !copies.objects.some((o) => o.key === key)) ||
      copies.objects.some(
        (o) =>
          !o.key ||
          !COPY_CATEGORIES.includes(
            o.category as (typeof COPY_CATEGORIES)[number],
          ),
      )
    )
      fail("PURGE_COPY_INVENTORY_INCOMPLETE", 503);
    if (
      new Set(copies.objects.map((o) => o.key)).size !== copies.objects.length
    )
      fail("PURGE_COPY_INVENTORY_INCOMPLETE", 503);
    if (
      !Array.isArray(copies.restorationDeadlines) ||
      copies.restorationDeadlines.some(
        (until) => !Number.isSafeInteger(until) || until < 0,
      )
    )
      fail("PURGE_COPY_INVENTORY_INCOMPLETE", 503);
    if (copies.restorationDeadlines.some((until) => until > this.now()))
      fail("PURGE_COPY_RESTORE_PROMISE");
    p.copyPlan = copies;
  }
  async preview(session: AuthSession, input: LifecycleRequest) {
    await this.available();
    const request = this.validate(input),
      before = await this.revisions(),
      p = await this.base(request);
    await this.access(session, p);
    if (request.action === "PURGE") await this.purgePlan(p);
    else await this.recyclePlan(p);
    const after = await this.revisions();
    if (before.a !== after.a || before.r !== after.r)
      fail("LIFECYCLE_SOURCE_CHANGED");
    const id = crypto.randomUUID();
    await this.sql(
      "INSERT INTO lifecycle_previews (id,actor_id,kind,academic_revision,archive_revision,payload_json,created_at) VALUES (?,?,?,?,?,?,?)",
      id,
      session.adminId,
      request.action,
      before.a,
      before.r,
      JSON.stringify(p),
      this.now(),
    ).run();
    return {
      previewId: id,
      action: request.action,
      studentIds: request.studentIds,
      irreversible: request.action === "PURGE",
      impact: Object.fromEntries(
        Object.entries(p.deletes).map(([t, ids]) => [t, ids.length]),
      ),
      frozenExams: p.frozenExams,
      copies: p.copyPlan?.objects ?? [],
      copyCategories: p.copyPlan?.categories ?? [],
      confirmation: request.action === "PURGE" ? `PURGE ${id}` : null,
    };
  }
  private guard(session: AuthSession, preview: Row, action: string) {
    const now = this.now();
    return this.sql(
      "INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until) VALUES (CASE WHEN EXISTS(SELECT 1 FROM academic_state a CROSS JOIN archive_state r WHERE a.id=1 AND r.id=1 AND a.revision=? AND r.revision=?) AND EXISTS(SELECT 1 FROM lifecycle_previews WHERE id=? AND result_json IS NULL) AND NOT EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE') AND EXISTS(SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id WHERE a.id=? AND s.id=? AND a.status='active' AND a.google_subject_id IS NOT NULL AND a.role IN ('super_admin','archive_admin') AND (?<>'PURGE' OR a.role='super_admin') AND a.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=? AND s.recent_auth_at>? AND s.recent_auth_at<=?) THEN ? ELSE NULL END,?,?, 'lifecycle',NULL,?,'success','{}',?,?)",
      preview.academic_revision,
      preview.archive_revision,
      preview.id,
      session.adminId,
      session.sessionId,
      action,
      now,
      now - SESSION_IDLE_TIMEOUT_MS,
      now,
      now - RECENT_AUTH_WINDOW_MS,
      now,
      crypto.randomUUID(),
      session.adminId,
      `LIFECYCLE_${action}`,
      preview.id,
      now,
      addCalendarMonths(taipeiBusinessDate(now), 2),
    );
  }
  async confirm(
    session: AuthSession,
    id: string,
    confirmed: boolean,
    confirmation?: string,
  ) {
    if (confirmed !== true) fail("CONFIRMATION_REQUIRED", 400);
    const preview = await this.sql(
      "SELECT * FROM lifecycle_previews WHERE id=? AND actor_id=?",
      text(id),
      session.adminId,
    ).first<Row>();
    if (!preview) fail("LIFECYCLE_PREVIEW_NOT_FOUND", 404);
    const p: Plan = JSON.parse(String(preview!.payload_json));
    // Completed purge previews are removed; no identifiers survive in replay data.
    await this.access(session, p);
    if (preview!.result_json)
      return { ...JSON.parse(String(preview!.result_json)), replayed: true };
    if (p.request.action === "PURGE" && confirmation !== `PURGE ${id}`)
      fail("PURGE_SECOND_CONFIRMATION_REQUIRED", 400);
    await this.available();
    if (p.request.action === "PURGE") {
      const fresh = await this.base(p.request);
      await this.purgePlan(fresh, id);
      if (JSON.stringify(fresh) !== JSON.stringify(p))
        fail("LIFECYCLE_SOURCE_CHANGED");
    } else await this.recyclePlan(p);
    const now = this.now(),
      jobId = crypto.randomUUID(),
      result = {
        previewId: id,
        action: p.request.action,
        jobId: p.request.action === "PURGE" ? jobId : null,
        replayed: false,
      };
    const writes = [this.guard(session, preview!, p.request.action)];
    if (p.request.action === "PURGE") {
      writes.push(
        this.sql(
          "INSERT INTO purge_jobs (id,actor_id,status,manifest_json,student_count,created_at,retention_until) VALUES (?,?,'RUNNING',?,?,?,?)",
          jobId,
          session.adminId,
          JSON.stringify(p),
          p.students.length,
          now,
          addCalendarYears(taipeiBusinessDate(now), 2),
        ),
      );
      writes.push(
        this.sql("UPDATE purge_control SET executing_job=? WHERE id=1", jobId),
      );
    } else
      for (const s of p.students) {
        if (p.request.action === "DELETE")
          writes.push(
            this.sql(
              "INSERT INTO recycle_entries (id,student_id,actor_id,reason,deleted_at,restore_until,source_version) VALUES (?,?,?,?,?,?,?)",
              crypto.randomUUID(),
              s.id,
              session.adminId,
              p.request.reason,
              now,
              now + RESTORE_WINDOW_MS,
              Number(s.version) + 1,
            ),
            this.sql(
              "UPDATE students SET deleted_at=?,version=version+1,updated_at=? WHERE id=?",
              now,
              now,
              s.id,
            ),
          );
        else {
          const entry = p.entries.find((e) => e.student_id === s.id)!;
          writes.push(
            this.sql(
              "UPDATE students SET deleted_at=NULL,version=version+1,updated_at=? WHERE id=?",
              now,
              s.id,
            ),
            this.sql(
              "UPDATE recycle_entries SET restored_at=? WHERE id=? AND restore_until>?",
              now,
              entry.id,
              now,
            ),
          );
          if (entry.enrollment_json) {
            const e = JSON.parse(String(entry.enrollment_json));
            writes.push(
              this.sql(
                "UPDATE student_enrollments SET status='valid',version=version+1 WHERE id=?",
                e.id,
              ),
            );
          }
        }
      }
    writes.push(
      this.sql(
        "UPDATE lifecycle_previews SET result_json=? WHERE id=?",
        JSON.stringify(result),
        id,
      ),
    );
    if (p.request.action === "PURGE")
      writes.push(
        this.sql("UPDATE purge_control SET executing_job=NULL WHERE id=1"),
      );
    try {
      await this.db.batch(writes);
    } catch {
      await this.access(session, p);
      const replay = await this.sql(
        "SELECT result_json FROM lifecycle_previews WHERE id=? AND actor_id=?",
        id,
        session.adminId,
      ).first<Row>();
      if (replay?.result_json)
        return { ...JSON.parse(String(replay.result_json)), replayed: true };
      fail("LIFECYCLE_CONFLICT");
    }
    if (p.request.action === "PURGE") return this.retry(session, jobId);
    return result;
  }
  async retry(session: AuthSession, id: string) {
    await this.authorization.assertPermission(
      session,
      "archive.manage",
      undefined,
      true,
    );
    const job = await this.sql(
      "SELECT * FROM purge_jobs WHERE id=?",
      text(id),
    ).first<Row>();
    if (!job) fail("PURGE_JOB_NOT_FOUND", 404);
    if (job!.status === "DONE")
      return { jobId: id, status: "DONE", replayed: true };
    const copies = this.copies ?? fail("PURGE_COPY_CAPABILITY_UNVERIFIED", 503);
    const p: Plan = JSON.parse(String(job!.manifest_json));
    await this.access(session, p);
    try {
      for (const object of p.copyPlan!.objects) {
        await this.access(session, p);
        await copies.remove(object.key);
        if (!(await copies.absent(object.key)))
          throw new Error("COPY_NOT_CLEARED");
      }
      const writes: D1PreparedStatement[] = [];
      const now = this.now();
      // A concurrent retry that already completed must abort before any snapshot replacement.
      writes.push(
        this.sql(
          "INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until) VALUES (CASE WHEN EXISTS(SELECT 1 FROM purge_jobs WHERE id=? AND status IN ('RUNNING','PARTIAL')) THEN ? ELSE NULL END,?,'PURGE_COMPLETE','purge',NULL,?,'success',?,?,?)",
          id,
          crypto.randomUUID(),
          session.adminId,
          id,
          JSON.stringify({ count: p.students.length }),
          now,
          addCalendarMonths(taipeiBusinessDate(now), 2),
        ),
      );
      // Auth is checked inside the final atomic transaction too. A revoked caller can never finalize.
      writes.push(
        this.sql(
          "UPDATE purge_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id WHERE a.id=? AND s.id=? AND a.role='super_admin' AND a.status='active' AND a.google_subject_id IS NOT NULL AND a.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=? AND s.recent_auth_at>? AND s.recent_auth_at<=?) THEN status ELSE NULL END WHERE id=? AND status<>'DONE'",
          session.adminId,
          session.sessionId,
          now,
          now - SESSION_IDLE_TIMEOUT_MS,
          now,
          now - RECENT_AUTH_WINDOW_MS,
          now,
          id,
        ),
      );
      writes.push(
        this.sql("UPDATE purge_control SET executing_job=? WHERE id=1", id),
      );
      for (const exam of p.frozenExams)
        writes.push(
          this.sql(
            "INSERT OR IGNORE INTO purged_exams (exam_id,frozen_at) VALUES (?,?)",
            exam,
            now,
          ),
        );
      for (const snap of p.snapshots)
        writes.push(
          this.sql(
            "DELETE FROM publication_snapshots WHERE result_version_id=?",
            snap.id,
          ),
          this.sql(
            "INSERT INTO publication_snapshots (result_version_id,snapshot_json) VALUES (?,?)",
            snap.id,
            snap.value,
          ),
        );
      for (const batch of p.archiveUpdates)
        writes.push(
          this.sql(
            "UPDATE archive_batches SET manifest_json=?,reason='Retained archive after authorized purge' WHERE id=?",
            batch.value,
            batch.id,
          ),
        );
      // Remove snapshots in FK order. Self-linked undo operations use deferred FK checks within this batch.
      writes.push(this.sql("PRAGMA defer_foreign_keys=ON"));
      for (const table of ORDER)
        for (const target of p.deletes[table] ?? []) {
          const column =
            table === "student_identity_lookup_hashes"
              ? "student_id"
              : table === "academic_operation_students"
                ? "operation_id"
                : "id";
          writes.push(
            this.sql(`DELETE FROM ${table} WHERE ${column}=?`, target),
          );
        }
      for (const auditId of p.auditIds)
        writes.push(
          this.sql(
            "UPDATE audit_logs SET entity_id=NULL,operation_id=?,metadata_json='{}' WHERE id=?",
            id,
            auditId,
          ),
        );
      // Remove every preview containing a selected student, including this purge's own preview.
      for (const studentId of p.request.studentIds)
        writes.push(
          this.sql(
            "DELETE FROM lifecycle_previews WHERE EXISTS (SELECT 1 FROM json_tree(payload_json) WHERE atom=?)",
            studentId,
          ),
        );
      const verification = p.request.studentIds.map(() => "?").join(",");
      writes.push(
        this.sql(
          `UPDATE purge_jobs SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM students WHERE id IN (${verification})) THEN 'DONE' ELSE NULL END,manifest_json=NULL,completed_at=?,retention_until=? WHERE id=?`,
          ...p.request.studentIds,
          now,
          addCalendarYears(taipeiBusinessDate(now), 2),
          id,
        ),
        this.sql("UPDATE purge_control SET executing_job=NULL WHERE id=1"),
      );
      await this.db.batch(writes);
      for (const studentId of p.request.studentIds)
        if (
          await this.sql(
            "SELECT id FROM students WHERE id=?",
            studentId,
          ).first()
        )
          fail("PURGE_VERIFICATION_FAILED");
      return { jobId: id, status: "DONE", replayed: false };
    } catch {
      const completed = await this.sql(
        "SELECT status FROM purge_jobs WHERE id=?",
        id,
      ).first<Row>();
      if (completed?.status === "DONE")
        return { jobId: id, status: "DONE", replayed: true };
      await this.sql(
        "UPDATE purge_jobs SET status='PARTIAL' WHERE id=? AND status<>'DONE'",
        id,
      ).run();
      return { jobId: id, status: "PARTIAL", retryable: true };
    }
  }
  async readJob(session: AuthSession, id: string) {
    await this.authorization.assertPermission(
      session,
      "archive.manage",
      undefined,
      true,
    );
    const row = await this.sql(
      "SELECT id,actor_id,status,student_count,created_at,completed_at,retention_until FROM purge_jobs WHERE id=?",
      text(id),
    ).first<Row>();
    if (!row) fail("PURGE_JOB_NOT_FOUND", 404);
    return row;
  }
  async list(session: AuthSession) {
    await this.available();
    const rows = await this.rows(
      "SELECT e.*,s.version FROM recycle_entries e JOIN students s ON s.id=e.student_id WHERE e.restored_at IS NULL AND s.deleted_at=e.deleted_at ORDER BY e.deleted_at DESC",
    );
    const visible: Row[] = [];
    for (const row of rows) {
      const p = await this.base({
        action: "RESTORE",
        studentIds: [String(row.student_id)],
        reason: "Recycle Bin read",
      });
      try {
        await this.access(session, p, true);
      } catch {
        continue;
      }
      visible.push({
        id: row.id,
        student_id: row.student_id,
        deleted_at: row.deleted_at,
        restore_until: row.restore_until,
        restorable: this.now() < Number(row.restore_until) ? 1 : 0,
      });
    }
    return { items: visible };
  }
}
