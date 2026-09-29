/** Appended to the publication batch: invalidation and durable requests commit with scores. */
export function aiRegenerationStatements(
  db: D1Database,
  changedExamId: string,
  now: number,
) {
  return [
    db
      .prepare(
        `UPDATE ai_advices SET stale_at=COALESCE(stale_at,?) WHERE exam_id IN
      (SELECT following.id FROM exams changed JOIN exams following ON following.academic_term_id=changed.academic_term_id AND following.sequence=changed.sequence+1 WHERE changed.id=?)`,
      )
      .bind(now, changedExamId),
    ...["parent", "student"].map((audience) =>
      db
        .prepare(
          `
      INSERT OR IGNORE INTO ai_jobs (id,student_id,exam_id,result_version_id,audience,dedupe_key,source_version,pair_key,requested_by,request_auth_version,previous_result_id,configuration_version,provider,model,prompt_version,created_at,updated_at)
      SELECT lower(hex(randomblob(16))),p.student_id,e.id,v.id,?,
        json_array(v.id,pr.id,p.student_id,cfg.version,'phase12-v1')||':'||?,v.source_version,
        json_array(v.id,pr.id,p.student_id,cfg.version,'phase12-v1'),
        old.requested_by,old.request_auth_version,pr.id,cfg.version,json_extract(cfg.value_json,'$'),json_extract(model.value_json,'$'),'phase12-v1',?,?
      FROM exams changed JOIN exams e ON e.academic_term_id=changed.academic_term_id AND e.sequence IN (changed.sequence,changed.sequence+1)
      JOIN exam_result_versions v ON v.id=(SELECT id FROM exam_result_versions WHERE exam_id=e.id AND published_at IS NOT NULL ORDER BY version DESC LIMIT 1)
      JOIN exam_participations p ON p.exam_id=e.id AND p.origin='LOCAL'
      JOIN students s ON s.id=p.student_id AND s.status='active' AND s.deleted_at IS NULL AND s.archived_at IS NULL
      JOIN ai_jobs old ON old.id=(SELECT id FROM ai_jobs WHERE exam_id=e.id AND student_id=p.student_id AND requested_by IS NOT NULL AND audience='parent' ORDER BY created_at DESC,id DESC LIMIT 1)
      JOIN system_settings cfg ON cfg.key='ai_provider' JOIN system_settings model ON model.key='ai_model' AND model.version=cfg.version
      LEFT JOIN exam_result_versions pr ON pr.id=(SELECT pv.id FROM exams pe JOIN exam_result_versions pv ON pv.exam_id=pe.id WHERE pe.academic_term_id=e.academic_term_id AND pe.sequence=e.sequence-1 AND pv.published_at IS NOT NULL ORDER BY pv.version DESC LIMIT 1)
      WHERE changed.id=? AND NOT EXISTS(SELECT 1 FROM purged_exams WHERE exam_id=e.id)
    `,
        )
        .bind(audience, audience, now, now, changedExamId),
    ),
  ];
}
