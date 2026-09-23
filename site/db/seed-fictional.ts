import { sealIdentity, type IdentityKeys } from "../lib/server/identity.ts";

/** Only the disposable local verification script calls this. Never included in migrations. */
export async function seedFictional(
  db: D1Database,
  keys: IdentityKeys,
): Promise<void> {
  const existing = await db
    .prepare(
      "SELECT (SELECT count(*) FROM students) + (SELECT count(*) FROM academic_years) + (SELECT count(*) FROM admin_users) AS count",
    )
    .first<{ count: number }>();
  if (!existing || existing.count !== 0)
    throw new Error("SEED_REQUIRES_EMPTY_DATABASE");
  const now = Date.UTC(2026, 8, 14);
  const statements: D1PreparedStatement[] = [];
  const insert = (
    table: string,
    row: Record<string, string | number | null>,
  ) => {
    const columns = Object.keys(row);
    statements.push(
      db
        .prepare(
          `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        )
        .bind(...Object.values(row)),
    );
  };
  insert("academic_years", {
    id: "year-115",
    code: "115",
    starts_on: "2026-08-01",
    ends_on: "2027-08-01",
  });
  insert("academic_terms", {
    id: "term-115-1",
    academic_year_id: "year-115",
    term_number: 1,
    starts_on: "2026-08-01",
    ends_on: "2027-02-01",
  });
  insert("academic_terms", {
    id: "term-115-2",
    academic_year_id: "year-115",
    term_number: 2,
    starts_on: "2027-02-01",
    ends_on: "2027-08-01",
  });
  for (const code of ["701", "702"])
    insert("classes", {
      id: `class-${code}`,
      academic_year_id: "year-115",
      grade: 7,
      code,
    });
  for (const [position, student] of ["a", "b", "late", "external"].entries()) {
    const studentId = `fictional-${student}`;
    const sealed = await sealIdentity(
      studentId,
      `fictional-identity-${student}`,
      keys,
    );
    insert("students", {
      id: studentId,
      student_number: `FICTIONAL-${position + 1}`,
      name: position < 2 ? "虛構同名學生" : `虛構學生${position + 1}`,
      birth_date: "2013-05-10",
      identity_number_encrypted: sealed.encrypted,
      identity_encryption_key_version: sealed.encryptionKeyVersion,
    });
    for (const hash of sealed.lookupHashes)
      insert("student_identity_lookup_hashes", {
        student_id: studentId,
        key_version: hash.keyVersion,
        identity_number_lookup_hash: hash.hash,
      });
  }
  for (const [id, student, code, seat, from, to] of [
    ["enroll-a1", "a", "701", 1, "2026-08-01", "2026-10-01"],
    ["enroll-a2", "a", "702", 1, "2026-10-01", "2027-02-01"],
    ["enroll-b", "b", "701", 2, "2026-08-01", "2027-02-01"],
    ["enroll-late", "late", "701", 3, "2026-09-16", "2027-02-01"],
    ["enroll-external", "external", "702", 2, "2026-09-20", "2027-02-01"],
  ] as const)
    insert("student_enrollments", {
      id,
      student_id: `fictional-${student}`,
      academic_year_id: "year-115",
      academic_term_id: "term-115-1",
      class_id: `class-${code}`,
      seat_number: seat,
      effective_from: from,
      effective_to: to,
      change_source: "fictional_seed",
    });
  insert("student_term_ranking_policies", {
    id: "policy-b",
    student_id: "fictional-b",
    academic_term_id: "term-115-1",
    ranking_eligible: 0,
  });
  for (const [sequence, start, end] of [
    [1, "2026-09-15", "2026-09-19"],
    [2, "2026-11-01", "2026-11-05"],
  ] as const) {
    insert("exams", {
      id: `exam-${sequence}`,
      academic_term_id: "term-115-1",
      sequence,
      starts_on: start,
      ends_on: end,
    });
    for (const examType of ["QUIZ", "MIDTERM"])
      for (const subject of examType === "QUIZ"
        ? ["CHINESE", "ENGLISH", "MATH"]
        : [
            "CHINESE",
            "ENGLISH",
            "MATH",
            "SCIENCE",
            "GEOGRAPHY",
            "HISTORY",
            "CIVICS",
          ])
        insert("exam_subject_settings", {
          id: `setting-${sequence}-${examType}-${subject}`,
          exam_id: `exam-${sequence}`,
          exam_type: examType,
          subject,
          held: subject === "CIVICS" ? 0 : 1,
        });
  }
  for (const [id, exam, student, enrollment, code, seat, term, override] of [
    ["part-a1", 1, "a", "enroll-a1", "701", 1, null, null],
    ["part-a2", 2, "a", "enroll-a2", "702", 1, null, null],
    ["part-b1", 1, "b", "enroll-b", "701", 2, 0, 1],
  ] as const)
    insert("exam_participations", {
      id,
      exam_id: `exam-${exam}`,
      academic_term_id: "term-115-1",
      student_id: `fictional-${student}`,
      enrollment_id: enrollment,
      class_id_snapshot: `class-${code}`,
      class_code_snapshot: code,
      grade_snapshot: 7,
      seat_number_snapshot: seat,
      student_eligibility_snapshot: 1,
      term_eligibility_snapshot: term,
      exam_eligibility_override: override,
      ranking_eligible: 1,
      confirmed_at: now,
    });
  insert("exam_participations", {
    id: "part-external",
    exam_id: "exam-1",
    academic_term_id: "term-115-1",
    student_id: "fictional-external",
    origin: "EXTERNAL_TRANSFER",
    external_school_label: "虛構原學校",
    student_eligibility_snapshot: 1,
    ranking_eligible: 0,
    confirmed_at: now,
  });
  for (const [
    id,
    participation,
    student,
    origin,
    value,
    status,
    average,
    ranking,
  ] of [
    ["score-zero", "part-a1", "a", "LOCAL", 0, "NORMAL", 1, 1],
    ["score-absent", "part-b1", "b", "LOCAL", null, "ABSENT", 0, 1],
    [
      "score-external",
      "part-external",
      "external",
      "EXTERNAL_TRANSFER",
      8000,
      "NORMAL",
      1,
      0,
    ],
  ] as const)
    insert("score_items", {
      id,
      participation_id: participation,
      setting_id: "setting-1-QUIZ-CHINESE",
      exam_id: "exam-1",
      student_id: `fictional-${student}`,
      exam_type: "QUIZ",
      subject: "CHINESE",
      origin,
      class_id_snapshot: origin === "LOCAL" ? "class-701" : null,
      score_value: value,
      score_status: status,
      include_in_average: average,
      include_in_ranking: ranking,
    });
  // No administrator, bootstrap completion, sessions, role grants or real secrets are seeded.
  await db.batch(statements);
}
