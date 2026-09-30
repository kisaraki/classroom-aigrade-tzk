import { assertBusinessDate, taipeiBusinessDate } from "../../domain/dates.ts";
import { withinPublicDeadline } from "../../domain/retention.ts";
import { validateAdvice, type AdviceContent } from "../ai/advice.ts";
import { LookupError, limitLookup } from "./limit.ts";
import { publicResult, type PublishedSnapshot } from "./result.ts";
export type LookupInput = {
  year: string;
  term: number;
  classCode: string;
  sequence: number;
  name: string;
  birthDate: string;
};
export function lookupInput(value: unknown): LookupInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LookupError();
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).length !== 6 ||
    Object.keys(v).some(
      (k) =>
        ![
          "year",
          "term",
          "classCode",
          "sequence",
          "name",
          "birthDate",
        ].includes(k),
    ) ||
    typeof v.year !== "string" ||
    !/^\d{2,3}$/.test(v.year) ||
    ![1, 2].includes(v.term as number) ||
    ![1, 2, 3].includes(v.sequence as number) ||
    typeof v.classCode !== "string" ||
    !/^[7-9]\d{2}$/.test(v.classCode) ||
    typeof v.name !== "string" ||
    !v.name.trim() ||
    v.name.length > 100 ||
    typeof v.birthDate !== "string"
  )
    throw new LookupError();
  try {
    assertBusinessDate(v.birthDate);
  } catch {
    throw new LookupError();
  }
  return {
    year: v.year,
    term: Number(v.term),
    classCode: v.classCode,
    sequence: Number(v.sequence),
    name: v.name.normalize("NFC").trim(),
    birthDate: v.birthDate,
  };
}
type Student = {
  id: string;
  version: number;
  deleted_at: number | null;
  public_query_until: string | null;
  retention_until: string | null;
  exam_id: string;
};
type RecordRow = {
  id: string;
  exam_id: string;
  year: string;
  term: number;
  sequence: number;
  snapshot_json: string;
};
export class PublicLookupService {
  private deps: { db: D1Database; hmacSecret: string; now?: () => number };
  constructor(deps: {
    db: D1Database;
    hmacSecret: string;
    now?: () => number;
  }) {
    this.deps = deps;
  }
  private now() {
    return (this.deps.now ?? Date.now)();
  }
  private match(input: LookupInput) {
    return this.deps.db
      .prepare(
        `SELECT DISTINCT s.id,s.version,s.deleted_at,s.public_query_until,s.retention_until,e.id AS exam_id
      FROM students s JOIN exam_participations p ON p.student_id=s.id AND p.origin='LOCAL'
      JOIN exams e ON e.id=p.exam_id JOIN academic_terms t ON t.id=e.academic_term_id JOIN academic_years y ON y.id=t.academic_year_id
      WHERE y.code=? AND t.term_number=? AND p.class_code_snapshot=? AND e.sequence=? AND s.name=? AND s.birth_date=? LIMIT 2`,
      )
      .bind(
        input.year,
        input.term,
        input.classCode,
        input.sequence,
        input.name,
        input.birthDate,
      );
  }
  async lookup(raw: unknown, trustedIp: string | null) {
    let input: LookupInput;
    try {
      input = lookupInput(raw);
    } catch {
      await limitLookup(
        this.deps.db,
        this.deps.hmacSecret,
        trustedIp,
        "invalid:" + JSON.stringify(raw),
        this.now(),
      );
      throw new LookupError();
    }
    await limitLookup(
      this.deps.db,
      this.deps.hmacSecret,
      trustedIp,
      JSON.stringify(input),
      this.now(),
    );
    const matches = (await this.match(input).all<Student>()).results;
    if (
      matches.length !== 1 ||
      !withinPublicDeadline(matches[0], taipeiBusinessDate(this.now()))
    )
      throw new LookupError();
    const student = matches[0];
    if (
      await this.deps.db
        .prepare("SELECT id FROM purge_jobs WHERE status<>'DONE' LIMIT 1")
        .first()
    )
      throw new LookupError();
    const rows = (
      await this.deps.db
        .prepare(
          `SELECT v.id,v.exam_id,y.code AS year,t.term_number AS term,e.sequence,s.snapshot_json
      FROM exam_result_versions v JOIN exams e ON e.id=v.exam_id JOIN academic_terms t ON t.id=e.academic_term_id JOIN academic_years y ON y.id=t.academic_year_id
      JOIN publication_snapshots s ON s.result_version_id=v.id
      WHERE v.id=(SELECT id FROM exam_result_versions WHERE exam_id=e.id AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1)
      AND EXISTS(SELECT 1 FROM exam_participations p WHERE p.exam_id=e.id AND p.student_id=?)
      ORDER BY y.starts_on DESC,t.term_number DESC,e.sequence DESC LIMIT 18`,
        )
        .bind(student.id)
        .all<RecordRow>()
    ).results;
    const records = rows.map((r) => ({
      year: r.year,
      term: r.term,
      sequence: r.sequence,
      snapshot: JSON.parse(r.snapshot_json) as PublishedSnapshot,
    }));
    const selected = rows.findIndex((r) => r.exam_id === student.exam_id);
    if (selected < 0) throw new LookupError();
    const result = publicResult(records[selected], records, student.id);
    let advice: {
      status: "ready" | "unavailable";
      parent?: AdviceContent;
      student?: AdviceContent;
    } = { status: "unavailable" };
    try {
      const advices = (
        await this.deps.db
          .prepare(
            `SELECT a.audience,a.content,a.version FROM ai_advices a JOIN ai_jobs j ON j.id=a.job_id
        WHERE a.student_id=? AND a.exam_id=? AND a.stale_at IS NULL AND j.status='completed' AND j.result_version_id=?
        AND a.version=(SELECT MAX(version) FROM ai_advices WHERE student_id=a.student_id AND exam_id=a.exam_id)
        ORDER BY a.audience`,
          )
          .bind(student.id, student.exam_id, rows[selected].id)
          .all<{ audience: string; content: string; version: number }>()
      ).results;
      if (advices.length === 2 && advices[0].version === advices[1].version) {
        const parent = advices.find((a) => a.audience === "parent"),
          child = advices.find((a) => a.audience === "student");
        if (parent && child)
          advice = {
            status: "ready",
            parent: validateAdvice(parent.content, "parent", [
              input.name,
              student.id,
              input.birthDate,
            ]),
            student: validateAdvice(child.content, "student", [
              input.name,
              student.id,
              input.birthDate,
            ]),
          };
      }
    } catch {
      /* AI does not block the published score query. */
    }
    // Recheck identity, deadlines, purge and every source pointer together before releasing the projection.
    const checks = await this.deps.db.batch<Record<string, unknown>>([
      this.match(input),
      this.deps.db.prepare(
        "SELECT id FROM purge_jobs WHERE status<>'DONE' LIMIT 1",
      ),
      ...rows.map((r) =>
        this.deps.db
          .prepare(
            "SELECT v.id,s.snapshot_json FROM exam_result_versions v JOIN publication_snapshots s ON s.result_version_id=v.id WHERE v.exam_id=? AND v.published_at IS NOT NULL ORDER BY v.version DESC LIMIT 1",
          )
          .bind(r.exam_id),
      ),
    ]);
    const final = checks[0].results as unknown as Student[];
    if (
      final.length !== 1 ||
      final[0].id !== student.id ||
      final[0].version !== student.version ||
      !withinPublicDeadline(final[0], taipeiBusinessDate(this.now())) ||
      checks[1].results.length ||
      rows.some(
        (r, i) =>
          checks[i + 2].results[0]?.id !== r.id ||
          checks[i + 2].results[0]?.snapshot_json !== r.snapshot_json,
      )
    )
      throw new LookupError();
    return { ...result, advice };
  }
}
export type LookupResult = Awaited<ReturnType<PublicLookupService["lookup"]>>;
