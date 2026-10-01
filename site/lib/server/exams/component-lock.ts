import type { ExamType } from "../../domain/scores.ts";

/** Empty means no publication; null means inconsistent publication state. */
export async function readPublishedComponents(
  db: D1Database,
  examId: string,
): Promise<ExamType[] | null> {
  const publication = await db
    .prepare(
      `SELECT v.id,
    CASE WHEN json_valid(s.snapshot_json) THEN json_extract(s.snapshot_json,'$.components') END AS components_json
    FROM exam_result_versions v LEFT JOIN publication_snapshots s ON s.result_version_id=v.id
    WHERE v.exam_id=? AND v.published_at IS NOT NULL ORDER BY v.version DESC LIMIT 1`,
    )
    .bind(examId)
    .first<{ id: string; components_json: string | null }>();

  if (!publication) return [];
  if (!publication.components_json) return null;
  try {
    const components: unknown = JSON.parse(publication.components_json);
    return Array.isArray(components) &&
      components.length >= 1 &&
      components.length <= 2 &&
      components.every((t) => t === "QUIZ" || t === "MIDTERM") &&
      new Set(components).size === components.length
      ? components
      : null;
  } catch {
    return null;
  }
}

/** Only score writes may use this exception to the whole-exam draft gate. */
export async function canWriteComponents(
  db: D1Database,
  exam: {
    id: string;
    published_at: unknown;
    locked_at: unknown;
    archived_at: unknown;
  },
  types: readonly ExamType[],
) {
  if (
    !types.length ||
    types.some((t) => !["QUIZ", "MIDTERM"].includes(t)) ||
    exam.archived_at !== null
  )
    return false;
  const components = await readPublishedComponents(db, exam.id);
  if (components === null) return false;
  if (!components.length)
    return exam.published_at === null && exam.locked_at === null;
  return (
    exam.published_at !== null &&
    exam.locked_at !== null &&
    types.every((t) => !components.includes(t))
  );
}

/** Rechecked inside the same D1 batch as scores, History, import job and receipt. */
export function componentWritePredicate(types: readonly ExamType[]) {
  if (!types.length || types.some((t) => !["QUIZ", "MIDTERM"].includes(t)))
    throw new Error("INVALID_COMPONENT_GATE");
  return `( (e.published_at IS NULL AND e.locked_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM exam_result_versions v WHERE v.exam_id=e.id AND v.published_at IS NOT NULL))
    OR (e.published_at IS NOT NULL AND e.locked_at IS NOT NULL AND EXISTS(
      SELECT 1 FROM exam_result_versions v JOIN publication_snapshots s ON s.result_version_id=v.id
      WHERE v.id=(SELECT id FROM exam_result_versions WHERE exam_id=e.id AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1)
      AND json_valid(s.snapshot_json) AND json_type(s.snapshot_json,'$.components')='array'
      AND json_array_length(s.snapshot_json,'$.components') BETWEEN 1 AND 2
      AND NOT EXISTS(SELECT 1 FROM json_each(s.snapshot_json,'$.components') WHERE type<>'text' OR value NOT IN ('QUIZ','MIDTERM'))
      AND json_array_length(s.snapshot_json,'$.components')=(SELECT count(DISTINCT value) FROM json_each(s.snapshot_json,'$.components'))
      AND NOT EXISTS(SELECT 1 FROM json_each(s.snapshot_json,'$.components') WHERE value IN (${types.map(() => "?").join(",")}))
    )))`;
}
