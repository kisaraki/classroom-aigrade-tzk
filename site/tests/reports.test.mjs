import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { extractText } from "unpdf";
import {
  createIsolatedDatabase,
  migrateLocalDatabase,
  fictionalKeys,
} from "../scripts/db-local.mjs";
import { sealIdentity } from "../lib/server/identity.ts";
import { seedFictional } from "../db/seed-fictional.ts";
import { AuthService } from "../lib/server/auth/service.ts";
import { AuthorizationService } from "../lib/server/auth/authorization.ts";
import { AdminManagementService } from "../lib/server/auth/admin-management.ts";
import { PublicationService } from "../lib/server/exams/publication.ts";
import { ReportService } from "../lib/server/reports/service.ts";
import { handleReport } from "../lib/server/reports/http.ts";
import {
  csv,
  xlsx,
  bounded,
  MAX_REPORT_BYTES,
  safeSpreadsheetText,
  ReportSourceBudget,
  validateReportSource,
} from "../lib/server/reports/formats.ts";
import { pdf, parseFont } from "../lib/server/reports/pdf.ts";

test("Phase 16 source cap counts UTF-8 incrementally, including surrogate pairs and aggregate rows", () => {
  const budget = new ReportSourceBudget();
  budget.add("學".repeat(Math.floor(MAX_REPORT_BYTES / 3)));
  budget.addBytes(MAX_REPORT_BYTES % 3);
  assert.throws(() => budget.add("a"), {
    code: "REPORT_SOURCE_TOO_LARGE",
    status: 413,
  });
  const emoji = new ReportSourceBudget();
  emoji.add("😀".repeat(1025));
  emoji.addBytes(MAX_REPORT_BYTES - 4100);
  assert.throws(() => emoji.addBytes(1), { code: "REPORT_SOURCE_TOO_LARGE" });
  const report = {
    title: "",
    subtitle: "",
    columns: [],
    rows: [["學".repeat(1_800_000)], ["學".repeat(1_800_000)]],
  };
  for (const render of [validateReportSource, csv, xlsx, pdf])
    assert.throws(() => render(report), {
      code: "REPORT_SOURCE_TOO_LARGE",
      status: 413,
    });
});

test("Phase 16 oversized combined AI sources are rejected before loading the over-budget pair, even if invalid", async (t) => {
  const f = await fixture(t);
  const ids = ["fictional-a", "fictional-b"];
  for (let n = 0; n < 4; n++) {
    const id = "fictional-large-student-" + n;
    ids.push(id);
    const sealed = await sealIdentity(
      id,
      "fictional-large-identity-" + n,
      fictionalKeys(),
    );
    await f.db
      .prepare(
        "INSERT INTO students(id,student_number,name,birth_date,identity_number_encrypted,identity_encryption_key_version) VALUES(?,?,?,'2013-05-10',?,?)",
      )
      .bind(
        id,
        "FICTIONAL-LARGE-" + n,
        "虛構容量學生" + n,
        sealed.encrypted,
        sealed.encryptionKeyVersion,
      )
      .run();
    await f.db
      .prepare(
        "INSERT INTO student_enrollments(id,student_id,academic_year_id,academic_term_id,class_id,seat_number,effective_from,effective_to,change_source) VALUES(?,?,'year-115','term-115-1','class-701',?,'2026-08-01','2027-02-01','fictional_test')",
      )
      .bind(id, id, 10 + n)
      .run();
    await f.db
      .prepare(
        "INSERT INTO exam_participations(id,exam_id,academic_term_id,student_id,enrollment_id,class_id_snapshot,class_code_snapshot,grade_snapshot,seat_number_snapshot,student_eligibility_snapshot,ranking_eligible,confirmed_at) VALUES(?,'exam-1','term-115-1',?,?,'class-701','701',7,?,1,1,?)",
      )
      .bind(id, id, id, 10 + n, now)
      .run();
  }
  await f.publish();
  const v = await f.db
    .prepare(
      "SELECT id,source_version FROM exam_result_versions WHERE exam_id='exam-1' ORDER BY version DESC LIMIT 1",
    )
    .first();
  for (const studentId of ids)
    for (const audience of ["parent", "student"]) {
      const id = studentId + "-" + audience;
      await f.db
        .prepare(
          "INSERT INTO ai_jobs(id,student_id,exam_id,result_version_id,audience,dedupe_key,source_version,status) VALUES(?,?,'exam-1',?,?,?,?,'completed')",
        )
        .bind(id, studentId, v.id, audience, id, v.source_version)
        .run();
      await f.db
        .prepare(
          "INSERT INTO ai_advices(id,job_id,student_id,exam_id,audience,source_version,provider,model,prompt_version,content) VALUES(?,?,?,'exam-1',?,?,'openai','fictional-model','phase12-v1',?)",
        )
        .bind(
          id,
          id,
          studentId,
          audience,
          v.source_version,
          JSON.stringify({ summary: "x".repeat(900_000) }),
        )
        .run();
    }
  let reads = 0;
  const db = {
    batch: f.db.batch.bind(f.db),
    prepare(sql) {
      if (sql.includes("SELECT id,content FROM ai_advices")) reads++;
      return f.db.prepare(sql);
    },
  };
  const service = new ReportService({ db, now: () => now });
  await assert.rejects(
    service.prepare(f.owner, {
      kind: "ai",
      examId: "exam-1",
      classId: "class-701",
    }),
    { code: "REPORT_SOURCE_TOO_LARGE", status: 413 },
  );
  assert.equal(reads, 5);
});

test("Phase 15 AI report requires complete matching pair and suppresses stale or invalid advice", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const v = await f.db
    .prepare(
      "SELECT id,source_version FROM exam_result_versions WHERE exam_id='exam-1' ORDER BY version DESC LIMIT 1",
    )
    .first();
  for (const audience of ["parent", "student"]) {
    await f.db
      .prepare(
        "INSERT INTO ai_jobs (id,student_id,exam_id,result_version_id,audience,dedupe_key,source_version,status) VALUES (?,'fictional-a','exam-1',?,?,?,?,'completed')",
      )
      .bind(
        "fictional-report-" + audience,
        v.id,
        audience,
        "fictional-report-" + audience,
        v.source_version,
      )
      .run();
    const content = {
      summary: "學習".repeat(250),
      diagnosis: "持續練習",
      improvements: "加強理解",
      plan: "每日複習",
      encouragement: "持續進步",
      ...(audience === "parent" ? { parentSupport: "陪伴學習" } : {}),
    };
    await f.db
      .prepare(
        "INSERT INTO ai_advices (id,job_id,student_id,exam_id,audience,source_version,provider,model,prompt_version,content) VALUES (?,?,'fictional-a','exam-1',?,?,'openai','fictional-model','phase12-v1',?)",
      )
      .bind(
        "fictional-advice-" + audience,
        "fictional-report-" + audience,
        audience,
        v.source_version,
        JSON.stringify(content),
      )
      .run();
  }
  const input = { kind: "ai", examId: "exam-1", classId: "class-701" };
  const ready = await f.reports.prepare(f.owner, input);
  assert.ok(ready.report.rows.some((row) => row.includes("有效")));
  await f.db
    .prepare("UPDATE ai_advices SET stale_at=? WHERE audience='student'")
    .bind(now)
    .run();
  await assert.rejects(ready.revalidate(), { code: "REPORT_VERSION_CHANGED" });
  const stale = await f.reports.prepare(f.owner, input);
  assert.ok(stale.report.rows.every((row) => !row.includes("有效")));
  for (const audience of ["parent", "student"]) {
    await f.db
      .prepare(
        "INSERT INTO ai_jobs (id,student_id,exam_id,result_version_id,audience,dedupe_key,source_version,status) VALUES (?,'fictional-a','exam-1',?,?,?,?,'completed')",
      )
      .bind(
        "fictional-invalid-" + audience,
        v.id,
        audience,
        "fictional-invalid-" + audience,
        v.source_version,
      )
      .run();
    await f.db
      .prepare(
        "INSERT INTO ai_advices (id,job_id,student_id,exam_id,audience,version,source_version,provider,model,prompt_version,content) VALUES (?,?,'fictional-a','exam-1',?,2,?,'openai','fictional-model','phase12-v1',?)",
      )
      .bind(
        "fictional-invalid-advice-" + audience,
        "fictional-invalid-" + audience,
        audience,
        v.source_version,
        JSON.stringify({ summary: "invalid" }),
      )
      .run();
  }
  const invalid = await f.reports.prepare(f.owner, input);
  assert.ok(
    invalid.report.rows.every((row) => !row.includes("學習".repeat(250))),
  );
});

test("Phase 15 capacity refuses a scoped query returning 1,001 students before projection", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const db = {
    prepare: (q) => f.db.prepare(q),
    batch: async (statements) => {
      const result = await f.db.batch(statements);
      if (statements.length === 2 && result[0].results[0]?.snapshot_json) {
        const sample = result[1].results[0];
        result[1].results = Array.from({ length: 1001 }, (_, i) => ({
          ...sample,
          id: "fictional-capacity-" + i,
          student_id: "fictional-capacity-" + i,
        }));
      }
      return result;
    },
  };
  const reports = new ReportService({ db, now: () => now });
  await assert.rejects(
    reports.prepare(f.owner, {
      kind: "class",
      examId: "exam-1",
      classId: "class-701",
    }),
    { code: "REPORT_TOO_MANY_STUDENTS" },
  );
});

test("Phase 15 personal external-school scores require current student scope and never enter local rankings", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const oldTeacher = await f.user("oldteacher", "homeroom", {
      classId: "class-701",
    }),
    currentTeacher = await f.user("newteacher", "homeroom", {
      classId: "class-702",
    });
  const input = {
    kind: "individual",
    examId: "exam-1",
    studentId: "fictional-external",
  };
  await assert.rejects(f.reports.prepare(oldTeacher, input), {
    code: "SCOPE_DENIED",
  });
  const personal = await f.reports.prepare(currentTeacher, input);
  assert.ok(personal.report.rows[0].includes("原校：虛構原學校"));
  assert.ok(personal.report.rows[0].includes(80));
  assert.equal(personal.report.rows[0].at(-1), null);
  const ranking = await f.reports.prepare(f.owner, {
    kind: "grade-ranking",
    examId: "exam-1",
    grade: 7,
  });
  assert.ok(!JSON.stringify(ranking.report).includes("原學校"));
});

test("Phase 15 HTTP does not release bytes after final session revocation", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const response = await handleReport(
    new Request("https://fictional.test/api/admin/reports", {
      method: "POST",
      headers: {
        Origin: "https://fictional.test",
        "Content-Type": "application/json",
        Cookie: "__Host-admin_session=" + f.owner.token,
      },
      body: JSON.stringify({
        kind: "class",
        examId: "exam-1",
        classId: "class-701",
        format: "csv",
      }),
    }),
    {
      auth: f.auth,
      font: async () => font,
      reports: {
        prepare: async () => ({
          report: {
            title: "機密測試內容",
            subtitle: "",
            columns: ["姓名"],
            rows: [["不得釋出"]],
          },
          version: 1,
          revalidate: async () => {
            await f.db
              .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
              .bind(now, f.owner.sessionId)
              .run();
          },
        }),
      },
    },
  );
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes("不得釋出"));
});
const now = Date.UTC(2026, 9, 1, 4),
  font = parseFont(
    new Uint8Array(
      readFileSync(
        new URL("../assets/reports/NotoSansTC-Regular.ttf", import.meta.url),
      ),
    ),
  );
const identity = (name) => ({
  verified: true,
  emailVerified: true,
  subject: "fictional-" + name,
  email: name + "@example.test",
  issuer: "https://accounts.google.com",
  audience: "fictional",
  nonce: "fictional",
  issuedAt: now / 1000,
  authTime: now / 1000,
  expiresAt: now / 1000 + 600,
});
async function fixture(t) {
  const { mf, db } = await createIsolatedDatabase();
  t.after(() => mf.dispose());
  await migrateLocalDatabase(db);
  await seedFictional(db, fictionalKeys());
  await db
    .prepare("UPDATE academic_state SET current_year_id='year-115' WHERE id=1")
    .run();
  const auth = new AuthService({
      db,
      now: () => now,
      bootstrapSecret: "fictional-bootstrap",
    }),
    owner = await auth.bootstrap({
      secret: "fictional-bootstrap",
      identity: identity("owner"),
    }),
    publication = new PublicationService({ db, now: () => now }),
    reports = new ReportService({ db, now: () => now });
  async function publish(component = "QUIZ") {
    const e = await db
      .prepare("SELECT version FROM exams WHERE id='exam-1'")
      .first();
    const p = await publication.preview(owner, "exam-1", {
      kind: "PUBLISH",
      component,
      expectedVersion: e.version,
    });
    return publication.confirm(owner, p.previewId, true);
  }
  async function user(name, scope, extra = {}) {
    const m = new AdminManagementService({
      db,
      now: () => now,
      authorization: new AuthorizationService({ db, now: () => now }),
    });
    await m.createAdmin(owner, {
      username: name,
      displayName: "虛構教師",
      authorizedEmail: name + "@example.test",
      role: "score_admin",
      assignments: [
        {
          academicTermId: "term-115-1",
          scopeType: scope,
          startsOn: "2026-08-01",
          ...extra,
        },
      ],
      confirmed: true,
    });
    return auth.loginVerifiedGoogle(identity(name));
  }
  const call = (session, input, overrides = {}) =>
    handleReport(
      new Request("https://fictional.test/api/admin/reports", {
        method: "POST",
        headers: {
          Origin: "https://fictional.test",
          "Content-Type": "application/json",
          Cookie: session ? "__Host-admin_session=" + session.token : "",
        },
        body: JSON.stringify(input),
        ...overrides,
      }),
      { auth, reports, font: async () => font },
    );
  return { db, owner, auth, reports, call, publish, user };
}
test("Phase 15 CSV and XLSX neutralize whitespace/control formula injection and preserve null versus zero", () => {
  for (const s of [
    "=1+1",
    "+1",
    "-2",
    "@SUM(A1)",
    " \t=1",
    "\u0000=1",
    "＝1",
    "＋1",
    "－2",
    "＠SUM(A1)",
    "\n=1",
    "\t文字",
  ])
    assert.equal(safeSpreadsheetText(s), "文字：" + s);
  const r = {
    title: "虛構測試報表",
    subtitle: "暫時排名",
    columns: ["姓名", "分數", "名次"],
    rows: [
      ['\t=HYPERLINK("evil")', 0, null],
      ["<script>中文</script>", 50, 1],
    ],
  };
  const csvBytes = csv(r),
    text = strFromU8(csvBytes);
  assert.deepEqual([...csvBytes.slice(0, 3)], [239, 187, 191]);
  assert.match(text, /"0","—"/);
  assert.ok(text.includes("文字：\t=HYPERLINK"));
  const files = unzipSync(xlsx(r)),
    sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.ok(!sheet.includes("<f>"));
  assert.match(sheet, /t="inlineStr"/);
  assert.match(sheet, /&lt;script&gt;/);
  assert.match(sheet, /<v>0<\/v>/);
  assert.throws(() => bounded(new Uint8Array(MAX_REPORT_BYTES + 1)), {
    code: "REPORT_TOO_LARGE",
  });
  assert.equal(
    bounded(new Uint8Array(MAX_REPORT_BYTES)).length,
    MAX_REPORT_BYTES,
  );
  assert.throws(() => xlsx({ ...r, rows: [["文".repeat(32768)]] }), {
    code: "REPORT_CELL_TOO_LONG",
  });
});
test("Phase 15 PDF embeds Chinese font, preserves Unicode and wraps multi-page text without active content", async () => {
  const r = {
    title: "虛構班級成績總表",
    subtitle: "115 學年度・暫時排名・發布版本 1",
    columns: ["姓名", "定評平均", "AI 建議"],
    rows: [
      ["虛構學生甲", 0, "持續學習、理解與練習。".repeat(400)],
      ["虛構學生乙", null, "尚無有效建議"],
    ],
  };
  const bytes = pdf(r, font),
    text = await extractText(bytes.slice(), { mergePages: true });
  assert.match(text.text, /虛構學生甲/);
  assert.match(text.text, /虛構學生乙/);
  assert.ok(text.totalPages > 1);
  const raw = strFromU8(bytes);
  assert.match(raw, /FontFile2/);
  assert.ok(!raw.includes("/JavaScript"));
  assert.ok(!raw.includes("/OpenAction"));
  assert.throws(() => pdf({ ...r, rows: [["\u{10ffff}", 0, ""]] }, font), {
    code: "REPORT_UNSUPPORTED_CHARACTER",
  });
  if (process.env.REPORT_QA_OUTPUT)
    writeFileSync(process.env.REPORT_QA_OUTPUT, bytes);
});
test("Phase 15 six report kinds use published snapshots, no private identifiers, and distinguish zero/absence", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.reports.prepare(f.owner, {
      kind: "class",
      examId: "exam-1",
      classId: "class-701",
    }),
    { code: "REPORT_NOT_PUBLISHED" },
  );
  await f.publish();
  for (const kind of [
    "class",
    "grade",
    "individual",
    "class-ranking",
    "grade-ranking",
    "ai",
  ]) {
    const scope = kind.startsWith("grade")
      ? { grade: 7 }
      : kind === "individual"
        ? { studentId: "fictional-a" }
        : { classId: "class-701" };
    const r = await f.reports.prepare(f.owner, {
      kind,
      examId: "exam-1",
      ...scope,
    });
    assert.match(r.report.subtitle, /暫時排名/);
    assert.equal(r.version, 1);
    assert.ok(r.report.rows.length);
    const serialized = JSON.stringify(r.report);
    for (const sensitive of [
      "fictional-a",
      "2013-",
      "birth_date",
      "student_id",
      "identity_number",
    ])
      assert.ok(!serialized.includes(sensitive));
    if (kind === "class") {
      assert.ok(r.report.rows.some((row) => row.includes(0)));
      assert.ok(r.report.rows.some((row) => row.includes("缺考")));
    }
    if (kind === "ai")
      assert.ok(r.report.rows.every((row) => row.includes("尚無有效建議")));
  }
});
test("Phase 15 class/grade/individual IDOR and teaching-subject scopes fail closed", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const homeroom = await f.user("homeroom", "homeroom", {
      classId: "class-701",
    }),
    teacher = await f.user("math", "teaching_subject", {
      classId: "class-701",
      subject: "MATH",
    });
  await f.reports.prepare(homeroom, {
    kind: "class",
    examId: "exam-1",
    classId: "class-701",
  });
  await f.reports.prepare(homeroom, {
    kind: "individual",
    examId: "exam-1",
    studentId: "fictional-a",
  });
  for (const input of [
    { kind: "class", classId: "class-702" },
    { kind: "grade", grade: 7 },
    { kind: "individual", studentId: "fictional-new" },
  ])
    await assert.rejects(
      f.reports.prepare(homeroom, { examId: "exam-1", ...input }),
      { code: "SCOPE_DENIED" },
    );
  await assert.rejects(
    f.reports.prepare(teacher, {
      kind: "class",
      examId: "exam-1",
      classId: "class-701",
    }),
    { code: "SCOPE_DENIED" },
  );
  await assert.rejects(
    f.reports.prepare(f.owner, {
      kind: "individual",
      examId: "exam-1",
      studentId: "fictional-a",
      classId: "class-701",
    }),
    { code: "INVALID_REPORT_SCOPE" },
  );
});
test("Phase 15 prepared downloads reject publication drift, profile drift and revoked sessions", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const input = { kind: "class", examId: "exam-1", classId: "class-701" },
    r = await f.reports.prepare(f.owner, input);
  await f.db
    .prepare(
      "UPDATE students SET name='虛構改名',version=version+1 WHERE id='fictional-a'",
    )
    .run();
  await assert.rejects(r.revalidate(), { code: "REPORT_VERSION_CHANGED" });
  const second = await f.reports.prepare(f.owner, input);
  await f.publish("MIDTERM");
  await assert.rejects(second.revalidate(), { code: "REPORT_VERSION_CHANGED" });
  await assert.rejects(
    f.reports.prepare(f.owner, { ...input, expectedVersion: 1 }),
    { code: "REPORT_VERSION_CHANGED" },
  );
  const third = await f.reports.prepare(f.owner, input);
  await f.db
    .prepare("UPDATE admin_sessions SET revoked_at=? WHERE id=?")
    .bind(now, f.owner.sessionId)
    .run();
  await assert.rejects(third.revalidate(), { code: "ACCESS_DENIED" });
});
test("Phase 15 download HTTP requires origin/session/whitelist/version and returns private attachment", async (t) => {
  const f = await fixture(t);
  await f.publish();
  const input = {
    kind: "class",
    examId: "exam-1",
    classId: "class-701",
    format: "csv",
    expectedVersion: 1,
  };
  assert.equal((await f.call(null, input)).status, 401);
  assert.equal(
    (
      await f.call(f.owner, input, {
        headers: { Origin: "https://wrong.test" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.call(f.owner, { ...input, role: "super_admin" })).status,
    400,
  );
  assert.equal(
    (await f.call(f.owner, input, { body: "x".repeat(65537) })).status,
    413,
  );
  assert.equal(
    (await f.call(f.owner, { ...input, expectedVersion: 2 })).status,
    409,
  );
  for (const format of ["preview", "csv", "xlsx", "pdf"]) {
    const response = await f.call(f.owner, { ...input, format });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    if (format !== "preview")
      assert.match(
        response.headers.get("Content-Disposition"),
        /^attachment; filename="report-class\./,
      );
  }
});
