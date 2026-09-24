import {
  addCalendarMonths,
  addCalendarYears,
  assertBusinessDate,
  taipeiBusinessDate,
} from "../../domain/dates.ts";
import { maskIdentity, sealIdentity, type IdentityKeys } from "../identity.ts";
import {
  AcademicError,
  type AcademicDependencies,
  type AcademicKind,
  type AccessGrant,
  type Change,
  type EnrollmentInput,
  type HistoryOptions,
  type NewStudent,
  type Plan,
  type Preview,
  type PromotionOverride,
  type Receipt,
  type Resources,
  type Row,
  type Table,
} from "./types.ts";

const fail = (code: string): never => {
  throw new AcademicError(code);
};
const string = (value: unknown): string =>
  typeof value === "string" && value.trim()
    ? value.trim().normalize("NFC")
    : fail("INVALID_INPUT");
const seat = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : fail("INVALID_SEAT_NUMBER");
const date = (value: unknown): string => {
  const result = string(value);
  try {
    assertBusinessDate(result);
  } catch {
    fail("INVALID_BUSINESS_DATE");
  }
  return result;
};
const unique = (values: string[]) => [...new Set(values)].sort();
const emptyResources = (): Resources => ({
  yearIds: [],
  classIds: [],
  studentIds: [],
  historicalYearIds: [],
});
const newPlan = (kind: AcademicKind): Plan => ({
  kind,
  changes: [],
  resources: emptyResources(),
  display: [],
  undoOf: null,
  keyVersions: null,
});
const newId = () => crypto.randomUUID();
const tables: Table[] = [
  "academic_years",
  "academic_terms",
  "classes",
  "students",
  "student_enrollments",
  "student_identity_lookup_hashes",
];
const reversible: AcademicKind[] = [
  "ENROLLMENT",
  "MOVE",
  "PROMOTION",
  "TRANSFER_OUT",
];

/** Internal domain service: no HTTP route or production authorization adapter exists yet. */
export class AcademicService {
  private readonly db: D1Database;
  private readonly dependencies: AcademicDependencies;
  constructor(dependencies: AcademicDependencies) {
    this.db = dependencies.db;
    this.dependencies = dependencies;
  }

  private now(): number {
    const now = (this.dependencies.now ?? Date.now)();
    return Number.isSafeInteger(now) && now >= 0 ? now : fail("INVALID_CLOCK");
  }
  private async one(
    sql: string,
    ...values: (string | number | null)[]
  ): Promise<Row> {
    const row = await this.db
      .prepare(sql)
      .bind(...values)
      .first<Row>();
    return row ?? fail("NOT_FOUND");
  }
  private async all(
    sql: string,
    ...values: (string | number | null)[]
  ): Promise<Row[]> {
    return (
      await this.db
        .prepare(sql)
        .bind(...values)
        .all<Row>()
    ).results;
  }
  private async state() {
    return this.one(
      "SELECT current_year_id, revision FROM academic_state WHERE id = 1",
    );
  }
  private async term(id: string) {
    return this.one("SELECT * FROM academic_terms WHERE id = ?", string(id));
  }
  private async classInTerm(classId: string, term: Row) {
    return this.one(
      "SELECT * FROM classes WHERE id = ? AND academic_year_id = ? AND archived_at IS NULL",
      string(classId),
      term.academic_year_id,
    );
  }
  private async activeStudent(id: string) {
    return this.one(
      "SELECT * FROM students WHERE id = ? AND status = 'active' AND deleted_at IS NULL",
      string(id),
    );
  }
  private async validateSession(grant: AccessGrant): Promise<Row> {
    const row = await this.db
      .prepare(
        "SELECT a.id, a.role FROM admin_users a JOIN admin_sessions s ON s.admin_user_id = a.id WHERE a.id = ? AND s.id = ? AND a.status = 'active' AND a.google_subject_id IS NOT NULL AND s.revoked_at IS NULL AND s.auth_version = a.auth_version AND s.expires_at > ?",
      )
      .bind(grant.adminId, grant.sessionId, this.now())
      .first<Row>();
    return row ?? fail("ACCESS_DENIED");
  }
  private async access(
    action: AcademicKind | "READ_YEARS" | "READ_ROSTER",
    stage: "preview" | "confirm" | "read",
    resources: Resources,
    historyReason: string | null,
  ): Promise<AccessGrant> {
    const grant = await this.dependencies.authorize?.({
      action,
      stage,
      resources: structuredClone(resources),
      historyReason,
    });
    if (!grant) return fail("ACCESS_DENIED");
    const account = await this.validateSession(grant);
    if (
      resources.historicalYearIds.length &&
      (account.role !== "super_admin" ||
        !grant.recentGoogleAuthentication ||
        !historyReason?.trim())
    )
      return fail("HISTORICAL_YEAR_LOCKED");
    return { ...grant };
  }
  private add(
    plan: Plan,
    table: Table,
    after: Row,
    key: Row = { id: after.id },
  ) {
    plan.changes.push({ table, key, before: null, after });
  }
  private update(plan: Plan, table: Table, row: Row, fields: Row) {
    const before: Row = {};
    for (const name of Object.keys(fields)) before[name] = row[name];
    plan.changes.push({ table, key: { id: row.id }, before, after: fields });
  }
  private touchStudent(plan: Plan, student: Row, fields: Row = {}) {
    this.update(plan, "students", student, {
      ...fields,
      version: Number(student.version) + 1,
      updated_at: this.now(),
    });
    plan.resources.studentIds.push(String(student.id));
  }
  private enrollment(
    plan: Plan,
    term: Row,
    studentId: string,
    classId: string,
    seatNumber: number,
    from: string,
    to = String(term.ends_on),
  ) {
    const id = newId();
    this.add(plan, "student_enrollments", {
      id,
      student_id: studentId,
      academic_year_id: term.academic_year_id,
      academic_term_id: term.id,
      class_id: classId,
      seat_number: seat(seatNumber),
      effective_from: from,
      effective_to: to,
      status: "valid",
      ranking_eligible: null,
      change_source: plan.kind,
      version: 1,
      created_at: this.now(),
    });
    plan.resources.yearIds.push(String(term.academic_year_id));
    plan.resources.classIds.push(classId);
    return id;
  }
  private withinTerm(from: string, term: Row) {
    if (from < String(term.starts_on) || from >= String(term.ends_on))
      fail("DATE_OUTSIDE_TERM");
  }
  private async notDuringExam(termId: string, on: string) {
    if (
      (
        await this.all(
          "SELECT id FROM exams WHERE academic_term_id = ? AND starts_on <= ? AND ends_on > ?",
          termId,
          on,
          on,
        )
      ).length
    )
      fail("ASSESSMENT_IN_PROGRESS");
  }
  private async validateEnrollments(plan: Plan) {
    const changedIds = new Set(
      plan.changes
        .filter((c) => c.table === "student_enrollments" && c.before)
        .map((c) => String(c.key.id)),
    );
    const proposed = plan.changes.filter(
      (c) => c.table === "student_enrollments" && c.after.status === "valid",
    );
    const originals = await this.all(
      "SELECT * FROM student_enrollments WHERE status = 'valid'",
    );
    const rows = originals.filter((row) => !changedIds.has(String(row.id)));
    for (const change of proposed) {
      const row = change.before
        ? {
            ...(await this.one(
              "SELECT * FROM student_enrollments WHERE id = ?",
              change.key.id,
            )),
            ...change.after,
          }
        : change.after;
      for (const other of rows) {
        const overlaps =
          String(row.effective_from) <
            String(other.effective_to ?? "9999-12-31") &&
          String(row.effective_to ?? "9999-12-31") >
            String(other.effective_from);
        if (overlaps && row.student_id === other.student_id)
          fail("ENROLLMENT_OVERLAP");
        if (
          overlaps &&
          row.class_id === other.class_id &&
          row.seat_number === other.seat_number
        )
          fail("SEAT_OCCUPIED");
      }
      rows.push(row);
    }
  }
  private async save(
    plan: Plan,
    base: Row,
    options: HistoryOptions,
    writeYearIds = plan.resources.yearIds,
  ): Promise<Preview> {
    for (const key of ["yearIds", "classIds", "studentIds"] as const)
      plan.resources[key] = unique(plan.resources[key]);
    plan.resources.historicalYearIds = [];
    for (const id of unique(writeYearIds))
      if (
        id !== base.current_year_id &&
        (await this.all("SELECT id FROM academic_years WHERE id = ?", id))
          .length
      )
        plan.resources.historicalYearIds.push(id);
    const reason = options.historyReason ? string(options.historyReason) : null;
    const grant = await this.access(
      plan.kind,
      "preview",
      plan.resources,
      reason,
    );
    await this.validateEnrollments(plan);
    if ((await this.state()).revision !== base.revision) fail("STALE_PREVIEW");
    const id = newId();
    await this.db
      .prepare(
        "INSERT INTO academic_previews (id, actor_id, kind, base_revision, payload_json, resources_json, history_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        grant.adminId,
        plan.kind,
        base.revision,
        JSON.stringify(plan),
        JSON.stringify(plan.resources),
        reason,
        this.now(),
      )
      .run();
    return {
      id,
      kind: plan.kind,
      revision: Number(base.revision),
      rows: structuredClone(plan.display),
      requiresConfirmation: true,
    };
  }

  async previewAcademicYear(input: {
    code: string;
    startsOn: string;
    secondTermStartsOn: string;
    endsOn: string;
  }): Promise<Preview> {
    const base = await this.state();
    const starts = date(input.startsOn),
      second = date(input.secondTermStartsOn),
      ends = date(input.endsOn);
    if (!(starts < second && second < ends)) fail("INVALID_YEAR_INTERVAL");
    if (base.current_year_id) {
      const current = await this.one(
        "SELECT * FROM academic_years WHERE id = ?",
        base.current_year_id,
      );
      if (starts < String(current.ends_on)) fail("YEAR_OVERLAP_OR_NOT_NEWER");
    }
    const code = string(input.code);
    if (
      (await this.all("SELECT id FROM academic_years WHERE code = ?", code))
        .length
    )
      fail("DUPLICATE_YEAR");
    const plan = newPlan("CREATE_YEAR"),
      id = newId();
    this.add(plan, "academic_years", {
      id,
      code,
      starts_on: starts,
      ends_on: ends,
      created_at: this.now(),
    });
    for (const [number, from, to] of [
      [1, starts, second],
      [2, second, ends],
    ] as const)
      this.add(plan, "academic_terms", {
        id: newId(),
        academic_year_id: id,
        term_number: number,
        starts_on: from,
        ends_on: to,
        created_at: this.now(),
      });
    plan.resources.yearIds.push(id);
    plan.display.push({
      yearId: id,
      code,
      startsOn: starts,
      secondTermStartsOn: second,
      endsOn: ends,
      terms: 2,
    });
    return this.save(plan, base, {}, []);
  }

  async previewClasses(
    yearId: string,
    codes: string[],
    options: HistoryOptions = {},
  ): Promise<Preview> {
    const base = await this.state(),
      plan = newPlan("CREATE_CLASSES");
    await this.one(
      "SELECT id FROM academic_years WHERE id = ?",
      string(yearId),
    );
    if (!Array.isArray(codes) || !codes.length) fail("EMPTY_BATCH");
    const normalized = codes.map(string);
    if (new Set(normalized).size !== normalized.length) fail("DUPLICATE_CLASS");
    for (const code of normalized) {
      if (!/^[789][0-9]{2}$/.test(code)) fail("INVALID_CLASS_CODE");
      if (
        (
          await this.all(
            "SELECT id FROM classes WHERE academic_year_id = ? AND code = ?",
            yearId,
            code,
          )
        ).length
      )
        fail("DUPLICATE_CLASS");
      const id = newId();
      this.add(plan, "classes", {
        id,
        academic_year_id: yearId,
        grade: Number(code[0]),
        code,
        archived_at: null,
        created_at: this.now(),
      });
      plan.resources.classIds.push(id);
      plan.display.push({ classId: id, code, grade: Number(code[0]) });
    }
    plan.resources.yearIds.push(yearId);
    return this.save(plan, base, options);
  }

  private keyVersions(keys = this.dependencies.identityKeys?.()): string {
    if (!keys) return fail("IDENTITY_KEYS_REQUIRED");
    return JSON.stringify({
      encryption: keys.encryption.version,
      lookup: keys.lookup.map((k) => k.version).sort((a, b) => a - b),
    });
  }

  async previewNewStudents(
    termId: string,
    rows: NewStudent[],
    mode: "new" | "transfer_in" = "new",
    options: HistoryOptions = {},
  ): Promise<Preview> {
    if (!Array.isArray(rows) || !rows.length) fail("EMPTY_BATCH");
    if (mode !== "new" && mode !== "transfer_in") fail("INVALID_INPUT");
    const base = await this.state(),
      term = await this.term(termId),
      plan = newPlan(mode === "new" ? "NEW_STUDENTS" : "TRANSFER_IN");
    const keys = this.dependencies.identityKeys?.();
    plan.keyVersions = this.keyVersions(keys);
    const numbers = new Set<string>(),
      identities = new Set<string>();
    for (const input of rows) {
      const name = string(input.name),
        birth = date(input.birthDate),
        studentNumber = string(input.studentNumber);
      const identity = string(input.identityNumber).toUpperCase();
      const from = date(input.effectiveFrom),
        classroom = await this.classInTerm(input.classId, term);
      this.withinTerm(from, term);
      if (birth > taipeiBusinessDate(this.now()) || birth >= from)
        fail("INVALID_BIRTH_DATE");
      if (mode === "new" && classroom.grade !== 7)
        fail("NEW_STUDENT_REQUIRES_GRADE_7");
      if (numbers.has(studentNumber) || identities.has(identity))
        fail("DUPLICATE_STUDENT_INPUT");
      numbers.add(studentNumber);
      identities.add(identity);
      if (
        (
          await this.all(
            "SELECT id FROM students WHERE student_number = ?",
            studentNumber,
          )
        ).length
      )
        fail("STUDENT_ALREADY_EXISTS");
      const id = newId(),
        sealed = await sealIdentity(id, identity, keys as IdentityKeys);
      for (const hash of sealed.lookupHashes)
        if (
          (
            await this.all(
              "SELECT student_id FROM student_identity_lookup_hashes WHERE key_version = ? AND identity_number_lookup_hash = ?",
              hash.keyVersion,
              hash.hash,
            )
          ).length
        )
          fail("STUDENT_ALREADY_EXISTS");
      this.add(plan, "students", {
        id,
        student_number: studentNumber,
        name,
        birth_date: birth,
        identity_number_encrypted: sealed.encrypted,
        identity_encryption_key_version: sealed.encryptionKeyVersion,
        ranking_eligible_default: 1,
        status: "active",
        transferred_out_on: null,
        graduated_on: null,
        retention_until: null,
        public_query_until: null,
        deleted_at: null,
        version: 1,
        created_at: this.now(),
        updated_at: this.now(),
      });
      for (const hash of sealed.lookupHashes)
        this.add(
          plan,
          "student_identity_lookup_hashes",
          {
            student_id: id,
            key_version: hash.keyVersion,
            identity_number_lookup_hash: hash.hash,
            created_at: this.now(),
          },
          { student_id: id, key_version: hash.keyVersion },
        );
      this.enrollment(
        plan,
        term,
        id,
        String(classroom.id),
        input.seatNumber,
        from,
      );
      plan.resources.studentIds.push(id);
      plan.display.push({
        studentId: id,
        name,
        birthDate: birth,
        studentNumber,
        identityMasked: maskIdentity(identity),
        classCode: classroom.code,
        seatNumber: seat(input.seatNumber),
        effectiveFrom: from,
      });
    }
    return this.save(plan, base, options);
  }

  async previewEnrollments(
    termId: string,
    rows: EnrollmentInput[],
    options: HistoryOptions = {},
  ): Promise<Preview> {
    if (!Array.isArray(rows) || !rows.length) fail("EMPTY_BATCH");
    const base = await this.state(),
      term = await this.term(termId),
      plan = newPlan("ENROLLMENT"),
      seen = new Set<string>();
    for (const input of rows) {
      if (seen.has(input.studentId)) fail("DUPLICATE_STUDENT_INPUT");
      seen.add(input.studentId);
      const student = await this.activeStudent(input.studentId),
        classroom = await this.classInTerm(input.classId, term),
        from = date(input.effectiveFrom);
      this.withinTerm(from, term);
      this.enrollment(
        plan,
        term,
        String(student.id),
        String(classroom.id),
        input.seatNumber,
        from,
      );
      this.touchStudent(plan, student);
      plan.display.push({
        studentId: student.id,
        classCode: classroom.code,
        seatNumber: seat(input.seatNumber),
        effectiveFrom: from,
      });
    }
    return this.save(plan, base, options);
  }

  private replacePrefix(plan: Plan, old: Row, on: string) {
    this.update(plan, "student_enrollments", old, {
      status: "voided",
      version: Number(old.version) + 1,
    });
    if (String(old.effective_from) < on)
      this.add(plan, "student_enrollments", {
        ...old,
        id: newId(),
        effective_to: on,
        change_source: plan.kind,
        version: 1,
        created_at: this.now(),
      });
    plan.resources.yearIds.push(String(old.academic_year_id));
    plan.resources.classIds.push(String(old.class_id));
  }

  async previewMove(
    input: {
      enrollmentId: string;
      targetClassId: string;
      seatNumber: number;
      effectiveFrom: string;
    },
    options: HistoryOptions = {},
  ): Promise<Preview> {
    const base = await this.state(),
      plan = newPlan("MOVE");
    const old = await this.one(
      "SELECT * FROM student_enrollments WHERE id = ? AND status = 'valid'",
      string(input.enrollmentId),
    );
    const term = await this.term(String(old.academic_term_id)),
      from = date(input.effectiveFrom),
      classroom = await this.classInTerm(input.targetClassId, term);
    const oldClass = await this.classInTerm(String(old.class_id), term),
      student = await this.activeStudent(String(old.student_id));
    if (classroom.grade !== oldClass.grade) fail("TRANSFER_GRADE_MISMATCH");
    if (
      from < String(old.effective_from) ||
      from >= String(old.effective_to ?? term.ends_on)
    )
      fail("DATE_OUTSIDE_ENROLLMENT");
    if (
      old.class_id === classroom.id &&
      old.seat_number === seat(input.seatNumber)
    )
      fail("NO_CHANGE");
    await this.notDuringExam(String(term.id), from);
    if (
      (
        await this.all(
          "SELECT p.id FROM exam_participations p JOIN exams e ON e.id = p.exam_id WHERE p.enrollment_id = ? AND e.starts_on >= ?",
          old.id,
          from,
        )
      ).length
    )
      fail("FROZEN_SUBSEQUENT_ROSTER");
    this.replacePrefix(plan, old, from);
    this.enrollment(
      plan,
      term,
      String(student.id),
      String(classroom.id),
      input.seatNumber,
      from,
      String(old.effective_to ?? term.ends_on),
    );
    this.touchStudent(plan, student);
    plan.display.push({
      studentId: student.id,
      fromClass: oldClass.code,
      fromSeat: old.seat_number,
      toClass: classroom.code,
      toSeat: input.seatNumber,
      effectiveFrom: from,
    });
    return this.save(plan, base, options);
  }

  async previewPromotion(
    input: {
      sourceTermId: string;
      targetTermId: string;
      overrides?: PromotionOverride[];
    },
    options: HistoryOptions = {},
  ): Promise<Preview> {
    const base = await this.state(),
      plan = newPlan("PROMOTION"),
      source = await this.term(input.sourceTermId),
      target = await this.term(input.targetTermId);
    const sourceYear = await this.one(
        "SELECT * FROM academic_years WHERE id = ?",
        source.academic_year_id,
      ),
      targetYear = await this.one(
        "SELECT * FROM academic_years WHERE id = ?",
        target.academic_year_id,
      );
    if (
      source.academic_year_id === target.academic_year_id ||
      String(targetYear.starts_on) < String(sourceYear.ends_on) ||
      source.term_number !== 2 ||
      target.term_number !== 1
    )
      fail("INVALID_PROMOTION_TERMS");
    const enrolled = await this.all(
      "SELECT e.*, c.code, c.grade FROM student_enrollments e JOIN students s ON s.id = e.student_id JOIN classes c ON c.id = e.class_id WHERE e.academic_term_id = ? AND e.status = 'valid' AND s.status = 'active' AND s.deleted_at IS NULL AND e.effective_from < ? AND (e.effective_to IS NULL OR e.effective_to >= ?) ORDER BY c.code, e.seat_number, e.student_id",
      source.id,
      source.ends_on,
      source.ends_on,
    );
    if (!enrolled.length) fail("EMPTY_PROMOTION_ROSTER");
    const overrides = new Map<string, PromotionOverride>();
    for (const override of input.overrides ?? []) {
      if (
        overrides.has(override.studentId) ||
        !enrolled.some(
          (row) =>
            row.student_id === override.studentId && Number(row.grade) < 9,
        )
      )
        fail("INVALID_PROMOTION_OVERRIDE");
      overrides.set(override.studentId, override);
    }
    const writeYears = [String(target.academic_year_id)];
    for (const old of enrolled) {
      plan.resources.classIds.push(String(old.class_id));
      if (old.grade === 9) {
        plan.display.push({
          studentId: old.student_id,
          fromClass: old.code,
          status: "SKIPPED_GRADE_9",
        });
        continue;
      }
      const override = overrides.get(String(old.student_id));
      const targetClass = override
        ? await this.classInTerm(override.classId, target)
        : await this.one(
            "SELECT * FROM classes WHERE academic_year_id = ? AND code = ? AND archived_at IS NULL",
            target.academic_year_id,
            String(Number(old.code) + 100),
          );
      if (Number(targetClass.grade) !== Number(old.grade) + 1)
        fail("PROMOTION_GRADE_MISMATCH");
      const targetSeat = seat(override?.seatNumber ?? old.seat_number);
      if (old.effective_to === null) {
        this.replacePrefix(
          plan,
          await this.one(
            "SELECT * FROM student_enrollments WHERE id = ?",
            old.id,
          ),
          String(source.ends_on),
        );
        writeYears.push(String(source.academic_year_id));
      }
      const student = await this.activeStudent(String(old.student_id));
      this.enrollment(
        plan,
        target,
        String(student.id),
        String(targetClass.id),
        targetSeat,
        String(target.starts_on),
      );
      this.touchStudent(plan, student);
      plan.display.push({
        studentId: student.id,
        fromClass: old.code,
        toClass: targetClass.code,
        seatNumber: targetSeat,
        effectiveFrom: target.starts_on,
        status: "PROMOTE",
      });
    }
    if (!plan.changes.length) fail("NO_PROMOTABLE_STUDENTS");
    plan.resources.yearIds.push(
      String(source.academic_year_id),
      String(target.academic_year_id),
    );
    return this.save(plan, base, options, writeYears);
  }

  async previewTransferOut(
    studentId: string,
    effectiveOn: string,
    options: HistoryOptions = {},
  ): Promise<Preview> {
    const base = await this.state(),
      plan = newPlan("TRANSFER_OUT"),
      student = await this.activeStudent(studentId),
      on = date(effectiveOn);
    if (
      student.retention_until !== null ||
      student.public_query_until !== null ||
      student.graduated_on !== null ||
      student.transferred_out_on !== null
    )
      fail("RETENTION_POLICY_REQUIRED");
    if (on > taipeiBusinessDate(this.now()))
      fail("FUTURE_TRANSFER_OUT_NOT_SUPPORTED");
    const enrollments = await this.all(
      "SELECT * FROM student_enrollments WHERE student_id = ? AND status = 'valid' AND (effective_to IS NULL OR effective_to > ?) ORDER BY effective_from",
      student.id,
      on,
    );
    if (!enrollments.some((row) => String(row.effective_from) <= on))
      fail("NO_ACTIVE_ENROLLMENT");
    for (const old of enrollments) this.replacePrefix(plan, old, on);
    const until = addCalendarYears(on, 3);
    this.touchStudent(plan, student, {
      status: "transferred_out",
      transferred_out_on: on,
      retention_until: until,
      public_query_until: until,
    });
    plan.display.push({
      studentId: student.id,
      effectiveOn: on,
      retentionUntil: until,
      publicQueryUntil: until,
    });
    return this.save(plan, base, options);
  }

  async previewUndo(
    operationId: string,
    options: HistoryOptions = {},
  ): Promise<Preview> {
    const base = await this.state(),
      original = await this.one(
        "SELECT * FROM academic_operations WHERE id = ? AND after_revision IS NOT NULL",
        string(operationId),
      );
    if (!reversible.includes(original.kind as AcademicKind))
      fail("OPERATION_NOT_REVERSIBLE");
    if (
      (
        await this.all(
          "SELECT id FROM academic_operations WHERE undo_of = ?",
          original.id,
        )
      ).length
    )
      fail("OPERATION_ALREADY_UNDONE");
    const changes: Change[] = JSON.parse(String(original.changes_json));
    const plan = newPlan("UNDO");
    plan.undoOf = String(original.id);
    // Void inserted segments first, then restore original segments. Keep snapshot FK targets intact.
    const ordered = [
      ...changes.filter((c) => c.before === null),
      ...changes.filter((c) => c.before !== null),
    ];
    for (const change of ordered) {
      if (change.table !== "students" && change.table !== "student_enrollments")
        fail("OPERATION_NOT_REVERSIBLE");
      const row = await this.one(
        `SELECT * FROM ${change.table} WHERE id = ?`,
        change.key.id,
      );
      if (
        Object.entries(change.after).some(([key, value]) => row[key] !== value)
      )
        fail("UNDO_VERSION_CONFLICT");
      if (change.table === "student_enrollments") {
        this.update(plan, change.table, row, {
          ...(change.before ?? { status: "voided" }),
          version: Number(row.version) + 1,
        });
        plan.resources.yearIds.push(String(row.academic_year_id));
        plan.resources.classIds.push(String(row.class_id));
        plan.resources.studentIds.push(String(row.student_id));
      } else {
        this.update(plan, "students", row, {
          ...change.before,
          version: Number(row.version) + 1,
          updated_at: this.now(),
        });
        plan.resources.studentIds.push(String(row.id));
      }
    }
    plan.display.push({
      undoOf: original.id,
      kind: original.kind,
      affectedStudents: unique(plan.resources.studentIds).length,
    });
    return this.save(plan, base, options);
  }

  private statement(change: Change): D1PreparedStatement {
    if (!tables.includes(change.table)) return fail("INVALID_STORED_PLAN");
    const columns = Object.keys(change.after),
      keyColumns = Object.keys(change.key);
    // Identifiers come only from our immutable server-created plan; still reject arbitrary SQL syntax.
    if ([...columns, ...keyColumns].some((column) => !/^[a-z_]+$/.test(column)))
      return fail("INVALID_STORED_PLAN");
    if (!change.before)
      return this.db
        .prepare(
          `INSERT INTO ${change.table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
        )
        .bind(...Object.values(change.after));
    return this.db
      .prepare(
        `UPDATE ${change.table} SET ${columns.map((column) => `${column} = ?`).join(",")} WHERE ${keyColumns.map((column) => `${column} IS ?`).join(" AND ")}`,
      )
      .bind(...Object.values(change.after), ...Object.values(change.key));
  }

  private async receipt(operation: Row, grant: AccessGrant): Promise<Receipt> {
    if (
      operation.actor_id !== grant.adminId ||
      operation.after_revision === null
    )
      return fail("ACCESS_DENIED");
    await this.validateSession(grant);
    return {
      ...JSON.parse(String(operation.result_json)),
      revision: Number(operation.after_revision),
      replayed: true,
    };
  }

  async confirm(
    previewId: string,
    input: { confirmed: boolean },
    transactionStatements: readonly D1PreparedStatement[] = [],
  ): Promise<Receipt> {
    if (input.confirmed !== true) fail("CONFIRMATION_REQUIRED");
    const preview = await this.one(
      "SELECT * FROM academic_previews WHERE id = ?",
      string(previewId),
    );
    const resources: Resources = JSON.parse(String(preview.resources_json));
    const grant = await this.access(
      preview.kind as AcademicKind,
      "confirm",
      resources,
      preview.history_reason as string | null,
    );
    if (preview.actor_id !== grant.adminId) fail("ACCESS_DENIED");
    const existing = await this.db
      .prepare("SELECT * FROM academic_operations WHERE preview_id = ?")
      .bind(preview.id)
      .first<Row>();
    if (existing) return this.receipt(existing, grant);
    const plan: Plan = JSON.parse(String(preview.payload_json));
    if (plan.keyVersions !== null && plan.keyVersions !== this.keyVersions())
      fail("IDENTITY_KEY_RING_CHANGED");
    if ((await this.state()).revision !== preview.base_revision)
      fail("STALE_PREVIEW");
    const now = this.now();
    const result: Receipt = {
      operationId: String(preview.id),
      kind: plan.kind,
      revision: 0,
      studentIds: plan.resources.studentIds,
      yearIds: plan.resources.yearIds,
      classIds: plan.resources.classIds,
      replayed: false,
    };
    // Creation profiles are needed only until commit; receipts contain IDs, and previews are cleared atomically.
    const undoChanges = reversible.includes(plan.kind) ? plan.changes : [];
    const statements = [
      this.db
        .prepare(
          "INSERT INTO academic_operations (id, preview_id, actor_id, auth_session_id, kind, before_revision, changes_json, result_json, undo_of, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          preview.id,
          preview.id,
          grant.adminId,
          grant.sessionId,
          plan.kind,
          preview.base_revision,
          JSON.stringify(undoChanges),
          JSON.stringify(result),
          plan.undoOf,
          now,
        ),
      ...plan.changes.map((change) => this.statement(change)),
    ];
    for (const studentId of unique(plan.resources.studentIds))
      statements.push(
        this.db
          .prepare(
            "INSERT INTO academic_operation_students (operation_id, student_id) VALUES (?, ?)",
          )
          .bind(preview.id, studentId),
      );
    statements.push(
      this.db
        .prepare(
          "INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, operation_id, outcome, metadata_json, created_at, retention_until) VALUES (?, ?, ?, 'academic_operation', ?, ?, 'success', ?, ?, ?)",
        )
        .bind(
          newId(),
          grant.adminId,
          plan.kind,
          preview.id,
          preview.id,
          JSON.stringify({
            affectedStudents: plan.resources.studentIds.length,
            historicalYearIds: resources.historicalYearIds,
            reason: preview.history_reason,
          }),
          now,
          addCalendarMonths(taipeiBusinessDate(now), 2),
        ),
    );
    statements.push(
      this.db
        .prepare(
          "UPDATE academic_operations SET after_revision = (SELECT revision FROM academic_state WHERE id = 1), result_json = json_set(result_json, '$.revision', (SELECT revision FROM academic_state WHERE id = 1)) WHERE id = ?",
        )
        .bind(preview.id),
    );
    statements.push(
      this.db
        .prepare(
          "UPDATE academic_previews SET payload_json = '{}' WHERE id = ?",
        )
        .bind(preview.id),
    );
    try {
      await this.db.batch([...statements, ...transactionStatements]);
    } catch {
      const committed = await this.db
        .prepare("SELECT * FROM academic_operations WHERE id = ?")
        .bind(preview.id)
        .first<Row>();
      if (committed)
        return this.receipt(
          committed,
          await this.access(
            preview.kind as AcademicKind,
            "confirm",
            resources,
            preview.history_reason as string | null,
          ),
        );
      // Do not expose D1 errors containing bound student data or encrypted fields.
      fail("COMMIT_CONFLICT");
    }
    const committed = await this.one(
      "SELECT after_revision FROM academic_operations WHERE id = ?",
      preview.id,
    );
    return { ...result, revision: Number(committed.after_revision) };
  }

  async listAcademicYears(): Promise<Row[]> {
    await this.access("READ_YEARS", "read", emptyResources(), null);
    return this.all(
      "SELECT y.*, CASE WHEN y.id = s.current_year_id THEN 0 ELSE 1 END AS historical_read_only FROM academic_years y CROSS JOIN academic_state s ORDER BY y.starts_on DESC, y.id",
    );
  }

  async classRoster(
    termId: string,
    classId: string,
    onDate: string,
  ): Promise<Row[]> {
    const term = await this.term(termId),
      classroom = await this.classInTerm(classId, term),
      on = date(onDate);
    this.withinTerm(on, term);
    await this.access(
      "READ_ROSTER",
      "read",
      {
        yearIds: [String(term.academic_year_id)],
        classIds: [String(classroom.id)],
        studentIds: [],
        historicalYearIds: [],
      },
      null,
    );
    return this.all(
      "SELECT s.id AS student_id, s.student_number, s.name, s.birth_date, s.status, e.id AS enrollment_id, e.seat_number FROM student_enrollments e JOIN students s ON s.id = e.student_id WHERE e.academic_term_id = ? AND e.class_id = ? AND e.status = 'valid' AND s.deleted_at IS NULL AND e.effective_from <= ? AND (e.effective_to IS NULL OR e.effective_to > ?) ORDER BY e.seat_number, s.id",
      term.id,
      classroom.id,
      on,
      on,
    );
  }
}
