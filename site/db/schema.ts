import { sql, type SQL } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

// Business dates are Taipei YYYY-MM-DD; technical timestamps are UTC Unix ms.
// Cross-row invariants and FTS5 are journaled in the second, custom migration.
const id = () => text("id").primaryKey().notNull();
const createdAt = () =>
  integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const updatedAt = () =>
  integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`);
const version = () => integer("version").notNull().default(1);
const bool = (column: AnySQLiteColumn): SQL => sql`${column} IN (0, 1)`;
const date = (column: AnySQLiteColumn): SQL =>
  sql`length(${column}) = 10 AND ${column} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND date(${column}, '+0 days') IS NOT NULL AND date(${column}, '+0 days') = ${column}`;
const hexHash = (column: AnySQLiteColumn): SQL =>
  sql`length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
const json = (column: AnySQLiteColumn): SQL => sql`json_valid(${column})`;
const positiveVersion = (column: AnySQLiteColumn): SQL =>
  sql`typeof(${column}) = 'integer' AND ${column} > 0`;

export const academicYears = sqliteTable(
  "academic_years",
  {
    id: id(),
    code: text("code").notNull().unique(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      "year_dates",
      sql`${date(t.startsOn)} AND ${date(t.endsOn)} AND ${t.startsOn} < ${t.endsOn}`,
    ),
  ],
);

export const academicTerms = sqliteTable(
  "academic_terms",
  {
    id: id(),
    academicYearId: text("academic_year_id")
      .notNull()
      .references(() => academicYears.id),
    termNumber: integer("term_number").notNull(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("term_number_unique").on(t.academicYearId, t.termNumber),
    uniqueIndex("term_year_unique").on(t.id, t.academicYearId),
    check("term_number", sql`${t.termNumber} IN (1, 2)`),
    check(
      "term_dates",
      sql`${date(t.startsOn)} AND ${date(t.endsOn)} AND ${t.startsOn} < ${t.endsOn}`,
    ),
  ],
);

export const classes = sqliteTable(
  "classes",
  {
    id: id(),
    academicYearId: text("academic_year_id")
      .notNull()
      .references(() => academicYears.id),
    grade: integer("grade").notNull(),
    code: text("code").notNull(),
    archivedAt: integer("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("class_code_unique").on(t.academicYearId, t.code),
    uniqueIndex("class_year_unique").on(t.id, t.academicYearId),
    check(
      "class_grade_code",
      sql`${t.grade} IN (7, 8, 9) AND length(${t.code}) = 3 AND ${t.code} GLOB '[7-9][0-9][0-9]' AND substr(${t.code}, 1, 1) = CAST(${t.grade} AS TEXT)`,
    ),
  ],
);

export const students = sqliteTable(
  "students",
  {
    id: id(),
    studentNumber: text("student_number").notNull().unique(),
    name: text("name").notNull(),
    birthDate: text("birth_date").notNull(),
    identityNumberEncrypted: text("identity_number_encrypted").notNull(),
    identityEncryptionKeyVersion: integer(
      "identity_encryption_key_version",
    ).notNull(),
    rankingEligibleDefault: integer("ranking_eligible_default")
      .notNull()
      .default(1),
    status: text("status").notNull().default("active"),
    transferredOutOn: text("transferred_out_on"),
    graduatedOn: text("graduated_on"),
    retentionUntil: text("retention_until"),
    publicQueryUntil: text("public_query_until"),
    deletedAt: integer("deleted_at"),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("student_public_lookup").on(t.name, t.birthDate),
    check("student_birth_date", date(t.birthDate)),
    check("student_ranking_default", bool(t.rankingEligibleDefault)),
    check(
      "student_status",
      sql`${t.status} IN ('active', 'transferred_out', 'graduated')`,
    ),
    check(
      "student_ciphertext",
      sql`${json(t.identityNumberEncrypted)} AND json_extract(${t.identityNumberEncrypted}, '$.algorithm') IS 'AES-256-GCM' AND json_type(${t.identityNumberEncrypted}, '$.iv') IS 'text' AND json_type(${t.identityNumberEncrypted}, '$.ciphertext') IS 'text'`,
    ),
    check(
      "student_key_version",
      positiveVersion(t.identityEncryptionKeyVersion),
    ),
    check("student_version", positiveVersion(t.version)),
    check(
      "student_retention_dates",
      sql`(${t.retentionUntil} IS NULL OR ${date(t.retentionUntil)}) AND (${t.publicQueryUntil} IS NULL OR (${date(t.publicQueryUntil)} AND ${t.retentionUntil} IS NOT NULL AND ${t.publicQueryUntil} <= ${t.retentionUntil})) AND (${t.transferredOutOn} IS NULL OR ${date(t.transferredOutOn)}) AND (${t.graduatedOn} IS NULL OR ${date(t.graduatedOn)})`,
    ),
  ],
);

export const studentIdentityLookupHashes = sqliteTable(
  "student_identity_lookup_hashes",
  {
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    keyVersion: integer("key_version").notNull(),
    identityNumberLookupHash: text("identity_number_lookup_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("identity_student_version_unique").on(
      t.studentId,
      t.keyVersion,
    ),
    uniqueIndex("identity_hash_version_unique").on(
      t.keyVersion,
      t.identityNumberLookupHash,
    ),
    check("identity_hash_format", hexHash(t.identityNumberLookupHash)),
    check("identity_hash_version", positiveVersion(t.keyVersion)),
  ],
);

export const studentTermRankingPolicies = sqliteTable(
  "student_term_ranking_policies",
  {
    id: id(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    academicTermId: text("academic_term_id")
      .notNull()
      .references(() => academicTerms.id),
    rankingEligible: integer("ranking_eligible"),
    version: version(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("student_term_policy_unique").on(t.studentId, t.academicTermId),
    check("term_ranking_flag", bool(t.rankingEligible)),
    check("term_policy_version", positiveVersion(t.version)),
  ],
);

export const studentEnrollments = sqliteTable(
  "student_enrollments",
  {
    id: id(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    academicYearId: text("academic_year_id").notNull(),
    academicTermId: text("academic_term_id").notNull(),
    classId: text("class_id").notNull(),
    seatNumber: integer("seat_number").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    status: text("status").notNull().default("valid"),
    rankingEligible: integer("ranking_eligible"),
    changeSource: text("change_source").notNull(),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.academicTermId, t.academicYearId],
      foreignColumns: [academicTerms.id, academicTerms.academicYearId],
    }),
    foreignKey({
      columns: [t.classId, t.academicYearId],
      foreignColumns: [classes.id, classes.academicYearId],
    }),
    uniqueIndex("enrollment_snapshot_parent").on(
      t.id,
      t.studentId,
      t.academicTermId,
      t.classId,
    ),
    index("enrollment_student_period").on(
      t.studentId,
      t.effectiveFrom,
      t.effectiveTo,
    ),
    index("enrollment_seat_period").on(
      t.classId,
      t.seatNumber,
      t.effectiveFrom,
    ),
    check(
      "enrollment_dates",
      sql`${date(t.effectiveFrom)} AND (${t.effectiveTo} IS NULL OR (${date(t.effectiveTo)} AND ${t.effectiveTo} > ${t.effectiveFrom}))`,
    ),
    check(
      "enrollment_seat",
      sql`typeof(${t.seatNumber}) = 'integer' AND ${t.seatNumber} > 0`,
    ),
    check("enrollment_status", sql`${t.status} IN ('valid', 'voided')`),
    check("enrollment_ranking", bool(t.rankingEligible)),
    check("enrollment_version", positiveVersion(t.version)),
  ],
);

export const exams = sqliteTable(
  "exams",
  {
    id: id(),
    academicTermId: text("academic_term_id")
      .notNull()
      .references(() => academicTerms.id),
    sequence: integer("sequence").notNull(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    publishedAt: integer("published_at"),
    lockedAt: integer("locked_at"),
    archivedAt: integer("archived_at"),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("exam_term_sequence_unique").on(t.academicTermId, t.sequence),
    uniqueIndex("exam_term_unique").on(t.id, t.academicTermId),
    check("exam_sequence", sql`${t.sequence} IN (1, 2, 3)`),
    check(
      "exam_dates",
      sql`${date(t.startsOn)} AND ${date(t.endsOn)} AND ${t.endsOn} > ${t.startsOn}`,
    ),
    check("exam_version", positiveVersion(t.version)),
  ],
);

export const examSubjectSettings = sqliteTable(
  "exam_subject_settings",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    examType: text("exam_type").notNull(),
    subject: text("subject").notNull(),
    held: integer("held").notNull().default(1),
    version: version(),
  },
  (t) => [
    uniqueIndex("exam_subject_unique").on(t.examId, t.examType, t.subject),
    uniqueIndex("exam_setting_parent").on(
      t.id,
      t.examId,
      t.examType,
      t.subject,
    ),
    check(
      "exam_subject_types",
      sql`(${t.examType} = 'QUIZ' AND ${t.subject} IN ('CHINESE', 'ENGLISH', 'MATH')) OR (${t.examType} = 'MIDTERM' AND ${t.subject} IN ('CHINESE', 'ENGLISH', 'MATH', 'SCIENCE', 'GEOGRAPHY', 'HISTORY', 'CIVICS'))`,
    ),
    check("exam_held", bool(t.held)),
    check("setting_version", positiveVersion(t.version)),
  ],
);

export const examParticipations = sqliteTable(
  "exam_participations",
  {
    id: id(),
    examId: text("exam_id").notNull(),
    academicTermId: text("academic_term_id").notNull(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    enrollmentId: text("enrollment_id"),
    classIdSnapshot: text("class_id_snapshot").references(() => classes.id),
    classCodeSnapshot: text("class_code_snapshot"),
    gradeSnapshot: integer("grade_snapshot"),
    seatNumberSnapshot: integer("seat_number_snapshot"),
    origin: text("origin").notNull().default("LOCAL"),
    externalSchoolLabel: text("external_school_label"),
    studentEligibilitySnapshot: integer(
      "student_eligibility_snapshot",
    ).notNull(),
    termEligibilitySnapshot: integer("term_eligibility_snapshot"),
    examEligibilityOverride: integer("exam_eligibility_override"),
    rankingEligible: integer("ranking_eligible").notNull(),
    confirmedAt: integer("confirmed_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.examId, t.academicTermId],
      foreignColumns: [exams.id, exams.academicTermId],
    }),
    foreignKey({
      columns: [
        t.enrollmentId,
        t.studentId,
        t.academicTermId,
        t.classIdSnapshot,
      ],
      foreignColumns: [
        studentEnrollments.id,
        studentEnrollments.studentId,
        studentEnrollments.academicTermId,
        studentEnrollments.classId,
      ],
    }),
    uniqueIndex("participation_unique").on(t.examId, t.studentId, t.origin),
    uniqueIndex("participation_score_parent").on(
      t.id,
      t.examId,
      t.studentId,
      t.origin,
    ),
    index("participation_class_lookup").on(t.examId, t.classIdSnapshot),
    check(
      "participation_flags",
      sql`${bool(t.studentEligibilitySnapshot)} AND ${bool(t.termEligibilitySnapshot)} AND ${bool(t.examEligibilityOverride)} AND ${bool(t.rankingEligible)}`,
    ),
    check(
      "participation_source",
      sql`(${t.origin} = 'LOCAL' AND ${t.enrollmentId} IS NOT NULL AND ${t.classIdSnapshot} IS NOT NULL AND ${t.classCodeSnapshot} IS NOT NULL AND ${t.gradeSnapshot} IN (7,8,9) AND ${t.gradeSnapshot} IS NOT NULL AND ${t.seatNumberSnapshot} > 0 AND ${t.seatNumberSnapshot} IS NOT NULL AND ${t.externalSchoolLabel} IS NULL AND ${t.rankingEligible} = coalesce(${t.examEligibilityOverride}, ${t.termEligibilitySnapshot}, ${t.studentEligibilitySnapshot})) OR (${t.origin} = 'EXTERNAL_TRANSFER' AND ${t.rankingEligible} = 0 AND ${t.enrollmentId} IS NULL AND ${t.classIdSnapshot} IS NULL AND ${t.classCodeSnapshot} IS NULL AND ${t.gradeSnapshot} IS NULL AND ${t.seatNumberSnapshot} IS NULL AND ${t.externalSchoolLabel} IS NOT NULL)`,
    ),
  ],
);

export const scoreItems = sqliteTable(
  "score_items",
  {
    id: id(),
    participationId: text("participation_id").notNull(),
    settingId: text("setting_id").notNull(),
    examId: text("exam_id").notNull(),
    studentId: text("student_id").notNull(),
    examType: text("exam_type").notNull(),
    subject: text("subject").notNull(),
    origin: text("origin").notNull(),
    classIdSnapshot: text("class_id_snapshot").references(() => classes.id),
    scoreValue: integer("score_value"),
    scoreStatus: text("score_status").notNull().default("UNENTERED"),
    includeInAverage: integer("include_in_average").notNull().default(0),
    includeInRanking: integer("include_in_ranking").notNull().default(0),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.participationId, t.examId, t.studentId, t.origin],
      foreignColumns: [
        examParticipations.id,
        examParticipations.examId,
        examParticipations.studentId,
        examParticipations.origin,
      ],
    }),
    foreignKey({
      columns: [t.settingId, t.examId, t.examType, t.subject],
      foreignColumns: [
        examSubjectSettings.id,
        examSubjectSettings.examId,
        examSubjectSettings.examType,
        examSubjectSettings.subject,
      ],
    }),
    uniqueIndex("score_participation_setting_unique").on(
      t.participationId,
      t.settingId,
    ),
    index("scores_exam_class").on(t.examId, t.classIdSnapshot, t.examType),
    check(
      "score_value_status",
      sql`(${t.scoreStatus} = 'NORMAL' AND ${t.scoreValue} IS NOT NULL AND typeof(${t.scoreValue}) = 'integer' AND ${t.scoreValue} BETWEEN 0 AND 10000 AND ${t.includeInAverage} = 1) OR (${t.scoreStatus} IN ('UNENTERED', 'ABSENT', 'OFFICIAL_LEAVE', 'SICK_LEAVE', 'EXEMPT', 'NOT_HELD') AND ${t.scoreValue} IS NULL AND ${t.includeInAverage} = 0)`,
    ),
    check("score_ranking_flag", bool(t.includeInRanking)),
    check(
      "score_origin_ranking",
      sql`${t.origin} <> 'EXTERNAL_TRANSFER' OR ${t.includeInRanking} = 0`,
    ),
    check("score_version", positiveVersion(t.version)),
  ],
);

export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: id(),
    username: text("username").notNull().unique(),
    displayName: text("display_name").notNull(),
    authorizedEmail: text("authorized_email").notNull().unique(),
    googleSubjectId: text("google_subject_id").unique(),
    role: text("role").notNull(),
    status: text("status").notNull().default("pending_identity_binding"),
    identityBoundAt: integer("identity_bound_at"),
    lastLoginAt: integer("last_login_at"),
    authVersion: integer("auth_version").notNull().default(1),
    createdBy: text("created_by").references(
      (): AnySQLiteColumn => adminUsers.id,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "admin_role",
      sql`${t.role} IN ('super_admin', 'system_admin', 'academic_admin', 'score_admin', 'ai_admin', 'archive_admin', 'viewer')`,
    ),
    check(
      "admin_status",
      sql`${t.status} IN ('pending_identity_binding', 'active', 'disabled', 'locked', 'identity_rebind_required')`,
    ),
    check(
      "admin_active_binding",
      sql`${t.status} <> 'active' OR (${t.googleSubjectId} IS NOT NULL AND length(${t.googleSubjectId}) > 0 AND ${t.identityBoundAt} IS NOT NULL)`,
    ),
    check("admin_auth_version", positiveVersion(t.authVersion)),
  ],
);

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    id: id(),
    adminUserId: text("admin_user_id")
      .notNull()
      .references(() => adminUsers.id),
    tokenHash: text("token_hash").notNull().unique(),
    authVersion: integer("auth_version").notNull(),
    authenticatedAt: integer("authenticated_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    createdAt: createdAt(),
    recentAuthAt: integer("recent_auth_at").notNull().default(0),
  },
  (t) => [
    index("sessions_admin_expiry").on(t.adminUserId, t.expiresAt),
    check("session_hash", hexHash(t.tokenHash)),
    check(
      "session_times",
      sql`${t.expiresAt} > ${t.authenticatedAt} AND ${t.lastSeenAt} >= ${t.authenticatedAt}`,
    ),
    check("session_auth_version", positiveVersion(t.authVersion)),
  ],
);

export const adminAssignments = sqliteTable(
  "admin_assignments",
  {
    id: id(),
    adminUserId: text("admin_user_id")
      .notNull()
      .references(() => adminUsers.id),
    academicTermId: text("academic_term_id")
      .notNull()
      .references(() => academicTerms.id),
    scopeType: text("scope_type").notNull(),
    grade: integer("grade"),
    classId: text("class_id").references(() => classes.id),
    subject: text("subject"),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on"),
    createdAt: createdAt(),
  },
  (t) => [
    index("assignments_admin_term").on(t.adminUserId, t.academicTermId),
    check(
      "assignment_shape",
      sql`(${t.scopeType} = 'school' AND ${t.grade} IS NULL AND ${t.classId} IS NULL AND ${t.subject} IS NULL) OR (${t.scopeType} = 'grade' AND ${t.grade} IS NOT NULL AND ${t.grade} IN (7,8,9) AND ${t.classId} IS NULL AND ${t.subject} IS NULL) OR (${t.scopeType} IN ('class', 'homeroom') AND ${t.classId} IS NOT NULL AND ${t.grade} IS NULL AND ${t.subject} IS NULL) OR (${t.scopeType} = 'teaching_subject' AND ${t.classId} IS NOT NULL AND ${t.grade} IS NULL AND ${t.subject} IS NOT NULL AND ${t.subject} IN ('CHINESE','ENGLISH','MATH','SCIENCE','GEOGRAPHY','HISTORY','CIVICS'))`,
    ),
    check(
      "assignment_dates",
      sql`${date(t.startsOn)} AND (${t.endsOn} IS NULL OR (${date(t.endsOn)} AND ${t.endsOn} > ${t.startsOn}))`,
    ),
  ],
);

export const bootstrapState = sqliteTable(
  "bootstrap_state",
  {
    id: integer("id").primaryKey(),
    initializedBy: text("initialized_by")
      .notNull()
      .references(() => adminUsers.id),
    initializedAt: integer("initialized_at").notNull(),
  },
  (t) => [check("bootstrap_singleton", sql`${t.id} = 1`)],
);

// OAuth state is short-lived server data. The browser retains only the
// transient state/nonce/PKCE verifier; D1 stores hashes so a database read
// cannot recover the callback secrets.
export const authOauthStates = sqliteTable(
  "auth_oauth_states",
  {
    id: id(),
    stateHash: text("state_hash").notNull().unique(),
    nonceHash: text("nonce_hash").notNull(),
    codeVerifierHash: text("code_verifier_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: createdAt(),
    purpose: text("purpose").notNull().default("login"),
    adminSessionId: text("admin_session_id"),
    identityRequestId: text("identity_request_id"),
  },
  (t) => [
    index("oauth_state_expiry").on(t.expiresAt),
    check("oauth_state_hash", hexHash(t.stateHash)),
    check("oauth_nonce_hash", hexHash(t.nonceHash)),
    check("oauth_verifier_hash", hexHash(t.codeVerifierHash)),
    // Purpose/actor/request constraints are maintained by migration triggers
    // so upgrading Phase 3A never rebuilds the existing OAuth state table.
    check(
      "oauth_state_times",
      sql`${t.expiresAt} > ${t.createdAt} AND (${t.usedAt} IS NULL OR ${t.usedAt} >= ${t.createdAt})`,
    ),
  ],
);

export const authIdentityRequests = sqliteTable(
  "auth_identity_requests",
  {
    id: id(),
    targetAdminId: text("target_admin_id")
      .notNull()
      .references(() => adminUsers.id),
    authorizedEmail: text("authorized_email").notNull(),
    approvalHash: text("approval_hash").notNull(),
    status: text("status").notNull().default("approved"),
    expiresAt: integer("expires_at").notNull(),
    approvedAt: integer("approved_at").notNull(),
    consumedAt: integer("consumed_at"),
    createdAt: createdAt(),
    kind: text("kind").notNull(),
    targetAuthVersion: integer("target_auth_version").notNull(),
    actorSessionId: text("actor_session_id").references(() => adminSessions.id),
    approvedBy: text("approved_by").notNull(),
    evidenceReference: text("evidence_reference").notNull(),
  },
  (t) => [
    index("recovery_target_status").on(t.targetAdminId, t.status),
    index("recovery_expiry").on(t.expiresAt),
    check("recovery_approval_hash", hexHash(t.approvalHash)),
    uniqueIndex("identity_request_token").on(t.approvalHash),
    check("identity_request_version", positiveVersion(t.targetAuthVersion)),
    check(
      "identity_request_kind",
      sql`(${t.kind} = 'rebind' AND ${t.actorSessionId} IS NOT NULL) OR (${t.kind} = 'recovery' AND ${t.actorSessionId} IS NULL)`,
    ),
    check(
      "recovery_status",
      sql`${t.status} IN ('approved', 'consumed', 'expired', 'rejected')`,
    ),
    check(
      "recovery_times",
      sql`${t.expiresAt} > ${t.approvedAt} AND (${t.consumedAt} IS NULL OR ${t.consumedAt} >= ${t.approvedAt})`,
    ),
  ],
);

export const scoreChangeHistory = sqliteTable(
  "score_change_history",
  {
    id: id(),
    scoreItemId: text("score_item_id")
      .notNull()
      .references(() => scoreItems.id),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => adminUsers.id),
    operationId: text("operation_id").notNull(),
    reason: text("reason").notNull(),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    fromVersion: integer("from_version").notNull(),
    toVersion: integer("to_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("score_history_version").on(t.scoreItemId, t.toVersion),
    index("score_history_student").on(t.studentId, t.createdAt),
    check(
      "score_history_values",
      sql`${json(t.beforeJson)} AND ${json(t.afterJson)} AND length(trim(${t.reason})) > 0 AND ${t.toVersion} = ${t.fromVersion} + 1`,
    ),
  ],
);

export const systemSettings = sqliteTable(
  "system_settings",
  {
    key: text("key").primaryKey().notNull(),
    valueJson: text("value_json").notNull(),
    version: version(),
    updatedBy: text("updated_by").references(() => adminUsers.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      "settings_key_allowlist",
      sql`${t.key} IN ('ai_provider', 'ai_model', 'ai_prompt', 'rag_config')`,
    ),
    check("settings_json", json(t.valueJson)),
    check("settings_version", positiveVersion(t.version)),
  ],
);

// D-08 release components and complete snapshots live in publication_snapshots.
export const examResultVersions = sqliteTable(
  "exam_result_versions",
  {
    id: id(),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    version: version(),
    sourceVersion: integer("source_version").notNull(),
    calculationVersion: text("calculation_version").notNull(),
    provisional: integer("provisional").notNull(),
    publishedAt: integer("published_at"),
    createdBy: text("created_by").references(() => adminUsers.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("exam_result_version_unique").on(t.examId, t.version),
    uniqueIndex("result_version_exam_parent").on(t.id, t.examId),
    check(
      "result_version_number",
      sql`${positiveVersion(t.version)} AND ${positiveVersion(t.sourceVersion)}`,
    ),
    check("result_provisional", bool(t.provisional)),
  ],
);

export const examResults = sqliteTable(
  "exam_results",
  {
    id: id(),
    resultVersionId: text("result_version_id").notNull(),
    examId: text("exam_id").notNull(),
    participationId: text("participation_id")
      .notNull()
      .references(() => examParticipations.id),
    averageHundredths: integer("average_hundredths"),
    totalHundredths: integer("total_hundredths"),
    classRank: integer("class_rank"),
    gradeRank: integer("grade_rank"),
    computedJson: text("computed_json").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.resultVersionId, t.examId],
      foreignColumns: [examResultVersions.id, examResultVersions.examId],
    }),
    uniqueIndex("result_participation_unique").on(
      t.resultVersionId,
      t.participationId,
    ),
    check("result_json", json(t.computedJson)),
    check(
      "result_numbers",
      sql`(${t.averageHundredths} IS NULL OR (typeof(${t.averageHundredths}) = 'integer' AND ${t.averageHundredths} BETWEEN 0 AND 10000)) AND (${t.totalHundredths} IS NULL OR (typeof(${t.totalHundredths}) = 'integer' AND ${t.totalHundredths} >= 0)) AND (${t.classRank} IS NULL OR ${positiveVersion(t.classRank)}) AND (${t.gradeRank} IS NULL OR ${positiveVersion(t.gradeRank)})`,
    ),
  ],
);

export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: id(),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    resultVersionId: text("result_version_id").references(
      () => examResultVersions.id,
    ),
    audience: text("audience").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    sourceVersion: integer("source_version").notNull(),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseTokenHash: text("lease_token_hash"),
    leaseExpiresAt: integer("lease_expires_at"),
    nextAttemptAt: integer("next_attempt_at"),
    errorCode: text("error_code"),
    completedAt: integer("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ai_jobs_queue").on(t.status, t.nextAttemptAt, t.leaseExpiresAt),
    index("ai_jobs_student_version").on(t.studentId, t.examId, t.sourceVersion),
    check(
      "ai_job_status",
      sql`${t.status} IN ('pending', 'processing', 'completed', 'failed')`,
    ),
    check("ai_job_audience", sql`${t.audience} IN ('parent', 'student')`),
    check(
      "ai_job_attempt",
      sql`typeof(${t.attemptCount}) = 'integer' AND ${t.attemptCount} >= 0`,
    ),
    check("ai_job_source", positiveVersion(t.sourceVersion)),
    check(
      "ai_job_lease",
      sql`(${t.leaseTokenHash} IS NULL AND ${t.leaseExpiresAt} IS NULL) OR (${t.leaseTokenHash} IS NOT NULL AND ${hexHash(t.leaseTokenHash)} AND ${t.leaseExpiresAt} IS NOT NULL)`,
    ),
  ],
);

export const aiAdvices = sqliteTable(
  "ai_advices",
  {
    id: id(),
    jobId: text("job_id")
      .notNull()
      .unique()
      .references(() => aiJobs.id),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    audience: text("audience").notNull(),
    version: version(),
    sourceVersion: integer("source_version").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    content: text("content").notNull(),
    staleAt: integer("stale_at"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("advice_version_unique").on(
      t.studentId,
      t.examId,
      t.audience,
      t.version,
    ),
    check("advice_audience", sql`${t.audience} IN ('parent', 'student')`),
    check("advice_provider", sql`${t.provider} IN ('openai', 'gemini')`),
    check(
      "advice_versions",
      sql`${positiveVersion(t.version)} AND ${positiveVersion(t.sourceVersion)}`,
    ),
  ],
);

export const aiReferenceMaterials = sqliteTable(
  "ai_reference_materials",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    objectKey: text("object_key").notNull().unique(),
    contentHash: text("content_hash").notNull(),
    subject: text("subject"),
    grade: integer("grade"),
    status: text("status").notNull().default("draft"),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    version: version(),
    createdBy: text("created_by")
      .notNull()
      .references(() => adminUsers.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("material_hash", hexHash(t.contentHash)),
    check(
      "material_status",
      sql`${t.status} IN ('draft', 'active', 'archived')`,
    ),
    check("material_grade", sql`${t.grade} IN (7,8,9)`),
    check(
      "material_dates",
      sql`(${t.validFrom} IS NULL OR ${date(t.validFrom)}) AND (${t.validTo} IS NULL OR ${date(t.validTo)}) AND (${t.validFrom} IS NULL OR ${t.validTo} IS NULL OR ${t.validTo} > ${t.validFrom})`,
    ),
    check("material_version", positiveVersion(t.version)),
  ],
);

export const aiReferenceChunks = sqliteTable(
  "ai_reference_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    materialId: text("material_id")
      .notNull()
      .references(() => aiReferenceMaterials.id),
    materialVersion: integer("material_version").notNull(),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("chunk_material_ordinal").on(
      t.materialId,
      t.materialVersion,
      t.ordinal,
    ),
    check(
      "chunk_ordinal",
      sql`typeof(${t.ordinal}) = 'integer' AND ${t.ordinal} >= 0`,
    ),
    check("chunk_hash", hexHash(t.contentHash)),
    check("chunk_version", positiveVersion(t.materialVersion)),
  ],
);

export const aiAdviceReferences = sqliteTable(
  "ai_advice_references",
  {
    id: id(),
    adviceId: text("advice_id")
      .notNull()
      .references(() => aiAdvices.id),
    chunkId: integer("chunk_id")
      .notNull()
      .references(() => aiReferenceChunks.id),
    materialVersion: integer("material_version").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    contentHashSnapshot: text("content_hash_snapshot").notNull(),
  },
  (t) => [
    uniqueIndex("advice_reference_unique").on(t.adviceId, t.chunkId),
    check("citation_hash", hexHash(t.contentHashSnapshot)),
    check("citation_version", positiveVersion(t.materialVersion)),
  ],
);

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: id(),
    actorId: text("actor_id")
      .notNull()
      .references(() => adminUsers.id),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    objectKey: text("object_key").notNull(),
    fileHash: text("file_hash").notNull(),
    mappingJson: text("mapping_json"),
    previewVersion: integer("preview_version").notNull().default(1),
    confirmedAt: integer("confirmed_at"),
    committedAt: integer("committed_at"),
    rollbackUntil: integer("rollback_until"),
    errorCode: text("error_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("import_actor_created").on(t.actorId, t.createdAt),
    check("import_file_hash", hexHash(t.fileHash)),
    check("import_mapping", json(t.mappingJson)),
    check("import_preview_version", positiveVersion(t.previewVersion)),
    check(
      "import_rollback_window",
      sql`${t.rollbackUntil} IS NULL OR (${t.committedAt} IS NOT NULL AND ${t.rollbackUntil} > ${t.committedAt})`,
    ),
  ],
);

export const importJobItems = sqliteTable(
  "import_job_items",
  {
    id: id(),
    jobId: text("job_id")
      .notNull()
      .references(() => importJobs.id),
    rowNumber: integer("row_number").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    studentId: text("student_id").references(() => students.id),
    status: text("status").notNull(),
    sourceVersion: integer("source_version"),
    committedVersion: integer("committed_version"),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    errorCode: text("error_code"),
  },
  (t) => [
    uniqueIndex("import_row_unique").on(t.jobId, t.rowNumber),
    index("import_item_student").on(t.studentId),
    check("import_row_number", positiveVersion(t.rowNumber)),
    check(
      "import_item_snapshots",
      sql`${json(t.beforeJson)} AND ${json(t.afterJson)}`,
    ),
  ],
);

export const archiveBatches = sqliteTable(
  "archive_batches",
  {
    id: id(),
    actorId: text("actor_id")
      .notNull()
      .references(() => adminUsers.id),
    reason: text("reason").notNull(),
    status: text("status").notNull(),
    manifestJson: text("manifest_json").notNull(),
    undoUntil: integer("undo_until").notNull(),
    restoredAt: integer("restored_at"),
    createdAt: createdAt(),
  },
  (t) => [
    check("archive_manifest", json(t.manifestJson)),
    check("archive_reason", sql`length(trim(${t.reason})) > 0`),
    check("archive_undo_window", sql`${t.undoUntil} > ${t.createdAt}`),
  ],
);

export const archiveItems = sqliteTable(
  "archive_items",
  {
    id: id(),
    batchId: text("batch_id")
      .notNull()
      .references(() => archiveBatches.id),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    studentId: text("student_id").references(() => students.id),
    sourceVersion: integer("source_version").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    status: text("status").notNull(),
    purgeEligibleOn: text("purge_eligible_on"),
    purgedAt: integer("purged_at"),
    errorCode: text("error_code"),
  },
  (t) => [
    uniqueIndex("archive_item_unique").on(t.batchId, t.entityType, t.entityId),
    index("archive_student").on(t.studentId),
    check("archive_snapshot", json(t.snapshotJson)),
    check("archive_source_version", positiveVersion(t.sourceVersion)),
    check(
      "archive_purge_date",
      sql`${t.purgeEligibleOn} IS NULL OR ${date(t.purgeEligibleOn)}`,
    ),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: id(),
    actorId: text("actor_id").references(() => adminUsers.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    operationId: text("operation_id").notNull(),
    outcome: text("outcome").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    occurredAt: createdAt(),
    retentionUntil: text("retention_until").notNull(),
  },
  (t) => [
    index("audit_operation").on(t.operationId),
    index("audit_retention").on(t.retentionUntil),
    check("audit_metadata", json(t.metadataJson)),
    check("audit_retention_date", date(t.retentionUntil)),
  ],
);

// Phase 2 command boundary. Domain services are internal until Phase 3A/3B.
export const academicState = sqliteTable(
  "academic_state",
  {
    id: integer("id").primaryKey(),
    currentYearId: text("current_year_id").references(() => academicYears.id),
    revision: integer("revision").notNull().default(0),
  },
  (t) => [
    check("academic_state_singleton", sql`${t.id} = 1`),
    check(
      "academic_revision",
      sql`typeof(${t.revision}) = 'integer' AND ${t.revision} >= 0`,
    ),
  ],
);

export const academicPreviews = sqliteTable(
  "academic_previews",
  {
    id: id(),
    actorId: text("actor_id")
      .notNull()
      .references(() => adminUsers.id),
    kind: text("kind").notNull(),
    baseRevision: integer("base_revision").notNull(),
    payloadJson: text("payload_json").notNull(),
    resourcesJson: text("resources_json").notNull(),
    historyReason: text("history_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("academic_preview_actor").on(t.actorId, t.createdAt),
    check(
      "academic_preview_json",
      sql`${json(t.payloadJson)} AND ${json(t.resourcesJson)}`,
    ),
    check(
      "academic_preview_revision",
      sql`typeof(${t.baseRevision}) = 'integer' AND ${t.baseRevision} >= 0`,
    ),
  ],
);

export const academicOperations = sqliteTable(
  "academic_operations",
  {
    id: id(),
    previewId: text("preview_id")
      .notNull()
      .unique()
      .references(() => academicPreviews.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => adminUsers.id),
    authSessionId: text("auth_session_id")
      .notNull()
      .references(() => adminSessions.id),
    kind: text("kind").notNull(),
    beforeRevision: integer("before_revision").notNull(),
    afterRevision: integer("after_revision"),
    changesJson: text("changes_json").notNull(),
    resultJson: text("result_json").notNull(),
    undoOf: text("undo_of")
      .unique()
      .references((): AnySQLiteColumn => academicOperations.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("academic_operation_actor").on(t.actorId, t.createdAt),
    check(
      "academic_operation_json",
      sql`${json(t.changesJson)} AND ${json(t.resultJson)}`,
    ),
    check(
      "academic_operation_revision",
      sql`typeof(${t.beforeRevision}) = 'integer' AND ${t.beforeRevision} >= 0 AND (${t.afterRevision} IS NULL OR (typeof(${t.afterRevision}) = 'integer' AND ${t.afterRevision} >= ${t.beforeRevision}))`,
    ),
  ],
);

export const academicOperationStudents = sqliteTable(
  "academic_operation_students",
  {
    operationId: text("operation_id")
      .notNull()
      .references(() => academicOperations.id),
    studentId: text("student_id")
      .notNull()
      .references(() => students.id),
  },
  (t) => [
    uniqueIndex("academic_operation_student_unique").on(
      t.operationId,
      t.studentId,
    ),
    index("academic_operations_by_student").on(t.studentId),
  ],
);

export const examRosterPreviews = sqliteTable(
  "exam_roster_previews",
  {
    id: id(),
    actorId: text("actor_id")
      .notNull()
      .references(() => adminUsers.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    classId: text("class_id")
      .notNull()
      .references(() => classes.id),
    examVersion: integer("exam_version").notNull(),
    academicRevision: integer("academic_revision").notNull(),
    rosterJson: text("roster_json").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("exam_preview_actor").on(t.actorId, t.createdAt),
    check("exam_preview_version", positiveVersion(t.examVersion)),
    check(
      "exam_preview_revision",
      sql`typeof(${t.academicRevision}) = 'integer' AND ${t.academicRevision} >= 0`,
    ),
    check(
      "exam_preview_roster",
      sql`${json(t.rosterJson)} AND json_type(${t.rosterJson}) = 'array'`,
    ),
  ],
);

export const examOperations = sqliteTable(
  "exam_operations",
  {
    id: id(),
    actorId: text("actor_id")
      .notNull()
      .references(() => adminUsers.id),
    authSessionId: text("auth_session_id")
      .notNull()
      .references(() => adminSessions.id),
    kind: text("kind").notNull(),
    requestHash: text("request_hash").notNull(),
    resultJson: text("result_json").notNull(),
    previewId: text("preview_id")
      .unique()
      .references(() => examRosterPreviews.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("exam_operation_actor").on(t.actorId, t.createdAt),
    check("exam_operation_hash", hexHash(t.requestHash)),
    check("exam_operation_result", json(t.resultJson)),
    check(
      "exam_operation_kind",
      sql`${t.kind} IN ('CREATE_EXAM','SCHEDULE','SUBJECT','ROSTER','EXTERNAL','SCORES')`,
    ),
  ],
);

export const publicationPreviews = sqliteTable(
  "publication_previews",
  {
    id: id(),
    actorId: text("actor_id")
      .notNull()
      .references(() => adminUsers.id),
    examId: text("exam_id")
      .notNull()
      .references(() => exams.id),
    sourceVersion: integer("source_version").notNull(),
    academicRevision: integer("academic_revision").notNull(),
    payloadJson: text("payload_json").notNull(),
    resultVersionId: text("result_version_id").references(
      () => examResultVersions.id,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    check("publication_preview_payload", json(t.payloadJson)),
    check("publication_preview_version", positiveVersion(t.sourceVersion)),
    index("publication_preview_actor").on(t.actorId, t.createdAt),
  ],
);

export const publicationSnapshots = sqliteTable(
  "publication_snapshots",
  {
    resultVersionId: text("result_version_id")
      .primaryKey()
      .notNull()
      .references(() => examResultVersions.id),
    snapshotJson: text("snapshot_json").notNull(),
  },
  (t) => [check("publication_snapshot_json", json(t.snapshotJson))],
);
