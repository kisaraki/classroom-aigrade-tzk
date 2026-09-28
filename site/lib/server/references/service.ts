import {
  chunkReferenceText,
  ReferenceError,
  referenceSearchQuery,
  referenceSearchTokens,
} from "../../domain/rag-text.ts";
import {
  addCalendarMonths,
  assertBusinessDate,
  taipeiBusinessDate,
} from "../../domain/dates.ts";
import { SUBJECTS } from "../../domain/scores.ts";
import { AuthorizationService } from "../auth/authorization.ts";
import { SESSION_IDLE_TIMEOUT_MS } from "../auth/policy.ts";
import type { AuthSession } from "../auth/types.ts";
import {
  assertReferencePrivacy,
  fail,
  fingerprint,
  parseReference,
  REFERENCE_LIMITS,
} from "./parse.ts";

type Row = Record<string, string | number | null>;
export type ReferenceMetadata = {
  title: string;
  description?: string;
  subject?: string | null;
  grade?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
};
export type ReferenceSearch = {
  query: string;
  subject: string;
  grade: number;
  classId?: string;
};
const scalar = (v: unknown, max: number): string =>
  typeof v === "string" && v.trim() && Array.from(v).length <= max
    ? v.trim().normalize("NFKC")
    : fail("REFERENCE_INPUT_INVALID");
function metadata(input: ReferenceMetadata) {
  if (
    !input ||
    Object.keys(input).some(
      (k) =>
        ![
          "title",
          "description",
          "subject",
          "grade",
          "validFrom",
          "validTo",
        ].includes(k),
    )
  )
    fail("REFERENCE_INPUT_INVALID");
  const title = scalar(input.title, 200);
  const description =
    input.description === undefined || input.description === ""
      ? null
      : scalar(input.description, 2000);
  const subject = input.subject ?? null,
    grade = input.grade ?? null;
  if (
    (subject !== null &&
      !SUBJECTS.includes(subject as (typeof SUBJECTS)[number])) ||
    (grade !== null && ![7, 8, 9].includes(grade))
  )
    fail("REFERENCE_INPUT_INVALID");
  const from = input.validFrom ?? null,
    to = input.validTo ?? null;
  try {
    for (const v of [from, to]) if (v !== null) assertBusinessDate(v);
  } catch {
    fail("REFERENCE_DATE_INVALID");
  }
  if (from && to && from >= to) fail("REFERENCE_DATE_INVALID");
  return { title, description, subject, grade, from, to };
}
export class ReferenceService {
  private readonly db: D1Database;
  private readonly files: R2Bucket;
  private readonly now: () => number;
  private readonly authz: AuthorizationService;
  constructor(deps: { db: D1Database; files: R2Bucket; now?: () => number }) {
    this.db = deps.db;
    this.files = deps.files;
    this.now = deps.now ?? Date.now;
    this.authz = new AuthorizationService({ db: this.db, now: this.now });
  }
  private sql(query: string, ...values: (string | number | null)[]) {
    return this.db.prepare(query).bind(...values);
  }
  private async access(
    session: AuthSession,
    write: boolean,
    search?: ReferenceSearch,
  ) {
    const date = taipeiBusinessDate(this.now());
    const term = await this.sql(
      "SELECT t.id FROM academic_terms t JOIN academic_state s ON s.current_year_id=t.academic_year_id WHERE s.id=1 AND t.starts_on<=? AND t.ends_on>?",
      date,
      date,
    ).all<Row>();
    if (term.results.length !== 1) fail("REFERENCE_CURRENT_TERM_REQUIRED", 409);
    await this.authz.assertPermission(
      session,
      write ? "ai.manage" : "ai.read",
      {
        academicTermId: String(term.results[0].id),
        onDate: date,
        ...(search
          ? {
              grade: search.grade,
              subject: search.subject,
              classId: search.classId,
            }
          : {}),
      },
    );
    return Number(
      (await this.db
        .prepare("SELECT revision FROM academic_state WHERE id=1")
        .first<Row>())!.revision,
    );
  }
  private async privacy(...texts: string[]) {
    // Scan locally; none of these identifiers leave the database boundary.
    const rows = await this.db
      .prepare("SELECT id, name, student_number, birth_date FROM students")
      .all<Row>();
    const admins = await this.db
      .prepare("SELECT id,display_name,authorized_email FROM admin_users")
      .all<Row>();
    const identifiers = [...rows.results, ...admins.results].flatMap((row) =>
      Object.values(row).filter(
        (v): v is string => typeof v === "string" && !!v,
      ),
    );
    for (const text of texts) assertReferencePrivacy(text, identifiers);
  }
  private guard(
    session: AuthSession,
    revision: number,
    id: string,
    action: string,
    version?: number,
  ) {
    const now = this.now();
    return this.sql(
      `INSERT INTO audit_logs (id,actor_id,action,entity_type,entity_id,operation_id,outcome,metadata_json,created_at,retention_until)
      SELECT ?,?,CASE WHEN (SELECT revision FROM academic_state WHERE id=1)=? AND NOT EXISTS(SELECT 1 FROM purge_jobs WHERE status<>'DONE')
      AND EXISTS(SELECT 1 FROM admin_users a JOIN admin_sessions s ON s.admin_user_id=a.id WHERE a.id=? AND s.id=? AND a.status='active' AND a.role IN ('super_admin','ai_admin') AND a.google_subject_id IS NOT NULL AND a.auth_version=s.auth_version AND s.revoked_at IS NULL AND s.expires_at>? AND s.last_seen_at>? AND s.last_seen_at<=?)
      AND (? IS NULL OR EXISTS(SELECT 1 FROM ai_reference_materials WHERE id=? AND version=?)) THEN ? ELSE NULL END,'reference',?,?,'success','{}',?,?`,
      crypto.randomUUID(),
      session.adminId,
      revision,
      session.adminId,
      session.sessionId,
      now,
      now - SESSION_IDLE_TIMEOUT_MS,
      now,
      version ?? null,
      id,
      version ?? null,
      action,
      id,
      crypto.randomUUID(),
      now,
      addCalendarMonths(taipeiBusinessDate(now), 2),
    );
  }
  private async material(id: string) {
    return (
      (await this.sql(
        "SELECT * FROM ai_reference_materials WHERE id=?",
        scalar(id, 100),
      ).first<Row>()) ?? fail("REFERENCE_NOT_FOUND", 404)
    );
  }
  private chunkStatements(
    id: string,
    version: number,
    chunks: { content: string; ordinal: number; hash: string }[],
  ) {
    const statements: D1PreparedStatement[] = [];
    for (let offset = 0; offset < chunks.length; offset += 10) {
      const group = chunks.slice(offset, offset + 10);
      statements.push(
        this.sql(
          `INSERT INTO ai_reference_chunks(material_id,material_version,ordinal,content,content_hash,search_tokens,created_at) VALUES ${group.map(() => "(?,?,?,?,?,?,?)").join(",")}`,
          ...group.flatMap((c) => [
            id,
            version,
            c.ordinal,
            c.content,
            c.hash,
            referenceSearchTokens(c.content).join(" "),
            this.now(),
          ]),
        ),
      );
    }
    return statements;
  }
  private publicMaterial(row: Row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      subject: row.subject,
      grade: row.grade,
      status: row.status,
      validFrom: row.valid_from,
      validTo: row.valid_to,
      version: row.version,
      needsIndexReview: row.needs_index_review === 1,
    };
  }
  async upload(
    session: AuthSession,
    input: ReferenceMetadata,
    format: "md" | "pdf",
    filename: string,
    bytes: Uint8Array,
  ) {
    await this.access(session, true);
    const data = metadata(input);
    scalar(filename, 255);
    if (
      !filename.toLowerCase().endsWith(`.${format}`) ||
      /[/\\\u0000-\u001f]/.test(filename)
    )
      fail("REFERENCE_FILENAME_INVALID");
    await this.privacy(filename, data.title, data.description ?? "");
    const parsed = await parseReference(format, bytes);
    await this.privacy(parsed.text, parsed.auxiliary);
    const chunks = chunkReferenceText(parsed.text, REFERENCE_LIMITS);
    const hashes = await Promise.all(chunks.map(fingerprint));
    const id = crypto.randomUUID(),
      key = `references/${id}/source`,
      now = this.now();
    let revision = await this.access(session, true);
    await this.db.batch([
      this.guard(session, revision, id, "REFERENCE_STAGE"),
      this.sql(
        "INSERT INTO reference_uploads(id,actor_id,object_key,status,created_at) VALUES (?,?,?,'pending',?)",
        id,
        session.adminId,
        key,
        now,
      ),
    ]);
    try {
      await this.files.put(key, new Uint8Array(bytes), {
        httpMetadata: {
          contentType: "application/octet-stream",
          cacheControl: "private, no-store",
        },
      });
      revision = await this.access(session, true);
      await this.privacy(
        filename,
        data.title,
        data.description ?? "",
        parsed.text,
        parsed.auxiliary,
      );
      await this.db.batch([
        this.guard(session, revision, id, "REFERENCE_UPLOAD"),
        this.sql(
          "INSERT INTO ai_reference_materials(id,title,description,object_key,content_hash,subject,grade,status,valid_from,valid_to,version,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'draft',?,?,1,?,?,?)",
          id,
          data.title,
          data.description,
          key,
          await fingerprint(bytes),
          data.subject,
          data.grade,
          data.from,
          data.to,
          session.adminId,
          now,
          now,
        ),
        ...this.chunkStatements(
          id,
          1,
          chunks.map((content, ordinal) => ({
            content,
            ordinal,
            hash: hashes[ordinal],
          })),
        ),
        this.sql(
          "UPDATE reference_uploads SET status='ready' WHERE id=? AND status='pending'",
          id,
        ),
      ]);
      return { id, version: 1, status: "draft", chunks: chunks.length };
    } catch (error) {
      // A successful but response-lost D1 batch must not lose its committed object.
      const committed = await this.sql(
        "SELECT id FROM ai_reference_materials WHERE id=?",
        id,
      ).first();
      if (committed)
        return { id, version: 1, status: "draft", chunks: chunks.length };
      await this.sql(
        "UPDATE reference_uploads SET status='cleanup' WHERE id=?",
        id,
      ).run();
      try {
        await this.files.delete(key);
      } catch {
        /* Durable cleanup item remains; never log source content. */
      }
      if (error instanceof ReferenceError) throw error;
      fail("REFERENCE_UPLOAD_FAILED", 503);
    }
  }
  async list(session: AuthSession, after = "") {
    await this.access(session, false);
    const rows = await this.sql(
      "SELECT m.*, EXISTS(SELECT 1 FROM ai_reference_chunks c WHERE c.material_id=m.id AND c.material_version=m.version AND c.search_tokens='') AS needs_index_review FROM ai_reference_materials m WHERE m.id>? ORDER BY m.id LIMIT 50",
      after,
    ).all<Row>();
    await this.access(session, false);
    return {
      items: rows.results.map((r) => this.publicMaterial(r)),
      next: rows.results.length === 50 ? rows.results.at(-1)!.id : null,
    };
  }
  async update(
    session: AuthSession,
    id: string,
    expectedVersion: number,
    input: ReferenceMetadata,
    status: "draft" | "active" | "archived",
    reviewed: boolean,
  ) {
    const revision = await this.access(session, true),
      old = await this.material(id);
    if (
      !Number.isSafeInteger(expectedVersion) ||
      old.version !== expectedVersion
    )
      fail("REFERENCE_VERSION_CONFLICT", 409);
    if (!["draft", "active", "archived"].includes(status))
      fail("REFERENCE_STATUS_INVALID");
    if (old.status === "archived") fail("REFERENCE_ARCHIVED_IMMUTABLE", 409);
    // Removing unsafe material from future retrieval must remain possible even
    // when today's privacy checks would reject its old text or metadata.
    if (status === "archived") {
      await this.db
        .batch([
          this.guard(
            session,
            revision,
            id,
            "REFERENCE_ARCHIVED",
            expectedVersion,
          ),
          this.sql(
            "UPDATE ai_reference_materials SET status='archived',version=version+1,updated_at=? WHERE id=? AND version=?",
            this.now(),
            id,
            expectedVersion,
          ),
        ])
        .catch(() => fail("REFERENCE_VERSION_OR_ACCESS_CHANGED", 409));
      return { id, version: expectedVersion + 1, status };
    }
    const data = metadata(input);
    const chunks = (
      await this.sql(
        "SELECT * FROM ai_reference_chunks WHERE material_id=? AND material_version=? ORDER BY ordinal",
        id,
        expectedVersion,
      ).all<Row>()
    ).results;
    if (status === "active" && reviewed !== true)
      fail("REFERENCE_PRIVACY_REVIEW_REQUIRED");
    await this.privacy(
      data.title,
      data.description ?? "",
      ...chunks.map((c) => String(c.content)),
    );
    if (
      !chunks.length ||
      chunks.length > REFERENCE_LIMITS.count ||
      chunks.some(
        (c) => Array.from(String(c.content)).length > REFERENCE_LIMITS.size,
      )
    )
      fail("REFERENCE_REIMPORT_REQUIRED", 409);
    await this.access(session, true);
    await this.db
      .batch([
        this.guard(
          session,
          revision,
          id,
          `REFERENCE_${status.toUpperCase()}`,
          expectedVersion,
        ),
        this.sql(
          "UPDATE ai_reference_materials SET title=?,description=?,subject=?,grade=?,status=?,valid_from=?,valid_to=?,version=version+1,updated_at=? WHERE id=? AND version=?",
          data.title,
          data.description,
          data.subject,
          data.grade,
          status,
          data.from,
          data.to,
          this.now(),
          id,
          expectedVersion,
        ),
        ...this.chunkStatements(
          id,
          expectedVersion + 1,
          chunks.map((c) => ({
            content: String(c.content),
            ordinal: Number(c.ordinal),
            hash: String(c.content_hash),
          })),
        ),
      ])
      .catch(() => fail("REFERENCE_VERSION_OR_ACCESS_CHANGED", 409));
    return { id, version: expectedVersion + 1, status };
  }
  async retrieve(session: AuthSession, search: ReferenceSearch) {
    if (
      !search ||
      !SUBJECTS.includes(search.subject as (typeof SUBJECTS)[number]) ||
      ![7, 8, 9].includes(search.grade)
    )
      fail("REFERENCE_SEARCH_INVALID");
    scalar(search.query, REFERENCE_LIMITS.query);
    const revision = await this.access(session, false, search);
    await this.privacy(search.query);
    const date = taipeiBusinessDate(this.now());
    const rows = (
      await this.sql(
        `SELECT c.id,c.content,c.content_hash,c.material_id,c.material_version,m.title FROM reference_search
      JOIN ai_reference_chunks c ON c.id=reference_search.rowid JOIN ai_reference_materials m ON m.id=c.material_id
      WHERE reference_search MATCH ? AND m.status='active' AND c.material_version=m.version AND (m.subject IS NULL OR m.subject=?) AND (m.grade IS NULL OR m.grade=?)
      AND (m.valid_from IS NULL OR m.valid_from<=?) AND (m.valid_to IS NULL OR m.valid_to>?) ORDER BY bm25(reference_search),c.id LIMIT ?`,
        referenceSearchQuery(search.query),
        search.subject,
        search.grade,
        date,
        date,
        REFERENCE_LIMITS.results,
      ).all<Row>()
    ).results;
    await this.privacy(
      ...rows.flatMap((r) => [String(r.content), String(r.title)]),
    );
    let characters = 0;
    const references = [];
    for (const row of rows) {
      characters += Array.from(String(row.content)).length;
      if (characters > REFERENCE_LIMITS.context) break;
      if ((await fingerprint(String(row.content))) !== row.content_hash)
        fail("REFERENCE_INTEGRITY_FAILED", 409);
      const material = await this.material(String(row.material_id));
      if (
        material.status !== "active" ||
        material.version !== row.material_version ||
        (material.valid_to &&
          String(material.valid_to) <= taipeiBusinessDate(this.now()))
      )
        fail("REFERENCE_CHANGED_RETRY", 409);
      references.push({
        chunkId: row.id,
        materialId: row.material_id,
        materialVersion: row.material_version,
        title: row.title,
        contentHash: row.content_hash,
        text: row.content,
      });
    }
    if (revision !== (await this.access(session, false, search)))
      fail("REFERENCE_CHANGED_RETRY", 409);
    return { trust: "untrusted_reference_data" as const, references };
  }
  async cleanup(session: AuthSession, id: string) {
    const initialRevision = await this.access(session, true);
    const row = await this.sql(
      "SELECT * FROM reference_uploads WHERE id=? AND status IN ('pending','cleanup')",
      scalar(id, 100),
    ).first<Row>();
    if (!row) return fail("REFERENCE_CLEANUP_NOT_FOUND", 404);
    await this.db.batch([
      this.guard(session, initialRevision, id, "REFERENCE_CLEANUP_START"),
      this.sql(
        "UPDATE reference_uploads SET status='cleanup' WHERE id=? AND status<>'ready'",
        id,
      ),
    ]);
    await this.files.delete(String(row.object_key));
    if (await this.files.head(String(row.object_key)))
      fail("REFERENCE_CLEANUP_PENDING", 503);
    const revision = await this.access(session, true);
    await this.db.batch([
      this.guard(session, revision, id, "REFERENCE_CLEANUP"),
    ]);
    return { id, status: "cleaned" };
  }
  async pending(session: AuthSession) {
    await this.access(session, true);
    const rows = await this.db
      .prepare(
        "SELECT id,status,created_at FROM reference_uploads WHERE status<>'ready' ORDER BY created_at LIMIT 50",
      )
      .all<Row>();
    await this.access(session, true);
    return { items: rows.results };
  }
}
