import assert from "node:assert/strict";
import { test } from "node:test";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";
import {
  createAIProvider,
  AI_LIMITS,
  providerConfiguration,
} from "../lib/server/ai/provider.ts";
const input = {
  instructions: "給予具體學習建議。",
  text: "數學需要加強分數。",
};
const secrets = {
  OPENAI_API_KEY: "fictional-openai-secret",
  GEMINI_API_KEY: "fictional-gemini-secret",
};
const openai = () => ({
  status: "completed",
  output: [
    { type: "reasoning", summary: [] },
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        { type: "output_text", text: "練習" },
        { type: "output_text", text: "分數" },
      ],
    },
  ],
});
const gemini = () => ({
  candidates: [
    {
      finishReason: "STOP",
      content: {
        role: "model",
        parts: [{ text: "內部思考", thought: true }, { text: "練習分數" }],
      },
    },
  ],
});
const provider = (name, fetch, extra = {}) =>
  createAIProvider(
    { provider: name, model: "fictional-model" },
    { secrets, fetch, random: () => 0, ...extra },
  );
test("AI providers use fixed endpoints, header secrets, explicit model, bounded output and no tools/storage", async () => {
  for (const name of ["openai", "gemini"]) {
    const p = provider(name, async (url, init) => {
      assert.equal(init.redirect, "manual");
      assert.equal(init.method, "POST");
      assert.ok(init.signal instanceof AbortSignal);
      const body = JSON.parse(init.body);
      assert.equal(body.store, false);
      assert.ok(!JSON.stringify(body).includes("secret"));
      assert.ok(!url.includes("secret"));
      if (name === "openai") {
        assert.equal(url, "https://api.openai.com/v1/responses");
        assert.equal(
          init.headers.Authorization,
          `Bearer ${secrets.OPENAI_API_KEY}`,
        );
        assert.equal(body.model, "fictional-model");
        assert.equal(body.max_output_tokens, 4096);
        assert.deepEqual(body.tools, []);
      } else {
        assert.equal(
          url,
          "https://generativelanguage.googleapis.com/v1beta/models/fictional-model:generateContent",
        );
        assert.equal(init.headers["x-goog-api-key"], secrets.GEMINI_API_KEY);
        assert.equal(body.generationConfig.maxOutputTokens, 4096);
        assert.equal(body.tools, undefined);
      }
      return Response.json(name === "openai" ? openai() : gemini());
    });
    assert.deepEqual(await p.generate(input), {
      provider: name,
      model: "fictional-model",
      text: "練習分數",
      attempts: 1,
    });
  }
});
test("AI configuration and Unicode input limits fail before outbound calls; key is provider-specific", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return Response.json(openai());
  };
  for (const config of [
    null,
    {},
    { provider: "other", model: "x" },
    { provider: "openai", model: "../x?key=bad" },
    { provider: "openai", model: "x", url: "https://example.test" },
  ])
    assert.throws(() => providerConfiguration(config), {
      code: "AI_CONFIGURATION_INVALID",
    });
  const p = provider("openai", fetch);
  for (const value of [
    null,
    {},
    { ...input, studentId: "fictional" },
    { instructions: "", text: "😀".repeat(32001) },
  ])
    await assert.rejects(p.generate(value), { code: "AI_INPUT_INVALID" });
  assert.equal(calls, 0);
  await p.generate({ instructions: "", text: "😀".repeat(32000) });
  assert.equal(calls, 1);
  await assert.rejects(
    provider("gemini", fetch, {
      secrets: { OPENAI_API_KEY: secrets.OPENAI_API_KEY },
    }).generate(input),
    { code: "AI_SECRET_MISSING" },
  );
  assert.equal(calls, 1);
});
test("AI refuses incomplete, refused, empty and tool output without exposing payload", async () => {
  const invalidOpenAI = [
    { ...openai(), status: "incomplete" },
    { ...openai(), error: { message: "fictional-private" } },
    {
      status: "completed",
      output: [{ type: "function_call", arguments: "fictional-private" }],
    },
    {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "refusal", refusal: "fictional-private" }],
        },
      ],
    },
    { status: "completed", output: [] },
  ];
  const invalidGemini = [
    { promptFeedback: { blockReason: "SAFETY" } },
    { candidates: [{ ...gemini().candidates[0], finishReason: "MAX_TOKENS" }] },
    {
      candidates: [
        {
          finishReason: "STOP",
          content: {
            role: "model",
            parts: [{ functionCall: { name: "private" } }],
          },
        },
      ],
    },
    { candidates: [...gemini().candidates, ...gemini().candidates] },
  ];
  for (const [name, values] of [
    ["openai", invalidOpenAI],
    ["gemini", invalidGemini],
  ])
    for (const value of values) {
      let calls = 0;
      await assert.rejects(
        provider(name, async () => {
          calls++;
          return Response.json(value);
        }).generate(input),
        (error) => {
          assert.equal(error.code, "AI_OUTPUT_REJECTED");
          assert.equal(error.message, error.code);
          assert.equal(error.cause, undefined);
          return true;
        },
      );
      assert.equal(calls, 1);
    }
});
test("AI response byte cap covers Content-Length and chunked bodies; malformed JSON does not retry", async () => {
  for (const response of [
    new Response("", {
      headers: { "Content-Length": String(AI_LIMITS.responseBytes + 1) },
    }),
    new Response(new Uint8Array(AI_LIMITS.responseBytes + 1)),
  ])
    await assert.rejects(
      provider("openai", async () => response).generate(input),
      { code: "AI_RESPONSE_TOO_LARGE" },
    );
  let calls = 0;
  await assert.rejects(
    provider("openai", async () => {
      calls++;
      return new Response("not-json-fictional-private");
    }).generate(input),
    { code: "AI_RESPONSE_INVALID" },
  );
  assert.equal(calls, 1);
});
test("AI retry is restricted to approved HTTP statuses and network errors; maximum three attempts", async () => {
  for (const status of [301, 302, 307, 308, 400, 401, 403, 404, 409, 501]) {
    let calls = 0;
    await assert.rejects(
      provider("openai", async () => {
        calls++;
        return new Response("fictional-private", { status });
      }).generate(input),
      { code: "AI_UPSTREAM_REJECTED" },
    );
    assert.equal(calls, 1);
  }
  for (const status of [429, 500, 502, 503, 504, "network"]) {
    let calls = 0;
    const result = await provider("openai", async () => {
      calls++;
      if (calls === 1) {
        if (status === "network") throw new Error("fictional-secret-and-input");
        return new Response("private", { status });
      }
      return Response.json(openai());
    }).generate(input);
    assert.equal(result.attempts, 2);
  }
  let calls = 0;
  await assert.rejects(
    provider("gemini", async () => {
      calls++;
      throw new Error("fictional-secret");
    }).generate(input),
    { code: "AI_NETWORK", message: "AI_NETWORK" },
  );
  assert.equal(calls, 3);
});
test("AI Retry-After cannot cross total deadline and does not fallback", async () => {
  for (const header of [
    "101",
    new Date(Date.UTC(2026, 8, 28) + 101000).toUTCString(),
  ]) {
    let calls = 0;
    await assert.rejects(
      provider(
        "openai",
        async (url) => {
          calls++;
          assert.equal(new URL(url).hostname, "api.openai.com");
          return new Response("", {
            status: 429,
            headers: { "Retry-After": header },
          });
        },
        { now: () => Date.UTC(2026, 8, 28) },
      ).generate(input),
      { code: "AI_TIMEOUT" },
    );
    assert.equal(calls, 1);
  }
});
test("AI cancellation interrupts fetch, response stream and retry delay without retrying", async () => {
  for (const mode of ["fetch", "body", "retry"]) {
    const controller = new AbortController();
    let calls = 0;
    let upstream;
    const p = provider("openai", async (_, init) => {
      calls++;
      upstream = init.signal;
      setTimeout(() => controller.abort("fictional-private-reason"), 20);
      if (mode === "fetch") return new Promise(() => {});
      if (mode === "body")
        return new Response(new ReadableStream({ start() {} }));
      return new Response("", { status: 503 });
    });
    await assert.rejects(p.generate(input, controller.signal), {
      code: "AI_CANCELLED",
      message: "AI_CANCELLED",
    });
    assert.equal(calls, 1);
    assert.equal(upstream.aborted, true);
  }
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    provider("openai", () => assert.fail("unexpected network")).generate(
      input,
      c.signal,
    ),
    { code: "AI_CANCELLED" },
  );
});
test("AI 30-second deadline applies through body read even when fetch ignores abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let calls = 0;
  const pending = provider("openai", async () => {
    calls++;
    return new Response(new ReadableStream({ start() {} }));
  }).generate(input);
  const rejected = assert.rejects(pending, { code: "AI_TIMEOUT" });
  for (const ms of [30000, 1000, 30000, 2000, 30000]) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(ms);
  }
  await rejected;
  assert.equal(calls, 3);
});

test("AI Retry-After is honored and the remaining attempt ends at the total 100-second deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let calls = 0;
  const pending = provider("gemini", async () => {
    calls++;
    if (calls === 1)
      return new Response("", {
        status: 429,
        headers: { "Retry-After": "80" },
      });
    return new Promise(() => {});
  }).generate(input);
  const rejected = assert.rejects(pending, { code: "AI_TIMEOUT" });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(79999);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  t.mock.timers.tick(20000);
  await rejected;
  assert.equal(calls, 2);
});

test("AI reports over-limit or invalid token counts as rejected output", async () => {
  for (const count of [4097, -1, "4096"]) {
    await assert.rejects(
      provider("openai", async () =>
        Response.json({ ...openai(), usage: { output_tokens: count } }),
      ).generate(input),
      { code: "AI_OUTPUT_REJECTED" },
    );
    await assert.rejects(
      provider("gemini", async () =>
        Response.json({
          ...gemini(),
          usageMetadata: { candidatesTokenCount: count },
        }),
      ).generate(input),
      { code: "AI_OUTPUT_REJECTED" },
    );
  }
});

test("Phase 12 provider usage normalizes counts and leaves unreported usage unknown", async () => {
  for (const name of ["openai", "gemini"]) {
    const response =
      name === "openai"
        ? {
            ...openai(),
            usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
          }
        : {
            ...gemini(),
            usageMetadata: {
              promptTokenCount: 10,
              candidatesTokenCount: 20,
              totalTokenCount: 30,
            },
          };
    assert.deepEqual(
      (
        await provider(name, async () => Response.json(response)).generate(
          input,
        )
      ).usage,
      { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    );
  }
  assert.equal(
    (
      await provider("openai", async () => Response.json(openai())).generate(
        input,
      )
    ).usage,
    undefined,
  );
});

test("AI adapters run in Workers with mocked outbound responses and no paid API", async (t) => {
  const { build } = await import("vite");
  const entry = "virtual:ai-provider-runtime";
  const source = fileURLToPath(
    new URL("../lib/server/ai/provider.ts", import.meta.url),
  ).replaceAll("\\", "/");
  const bundle = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "ai-provider-probe",
        resolveId(id) {
          if (id === entry) return id;
        },
        load(id) {
          if (id === entry)
            return `import { createAIProvider } from ${JSON.stringify(source)}; export default { async fetch(request) { const provider = new URL(request.url).pathname.slice(1); const ai = createAIProvider({provider, model:'fictional-model'}, {secrets:{OPENAI_API_KEY:'fictional-openai',GEMINI_API_KEY:'fictional-gemini'}}); return Response.json(await ai.generate({instructions:'',text:'Practice fractions'})); } };`;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      rolldownOptions: {
        input: entry,
        preserveEntrySignatures: "strict",
        output: { format: "es", codeSplitting: false },
      },
    },
  });
  let calls = 0;
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: "2026-05-15",
    cf: false,
    script: bundle.output.find((item) => item.type === "chunk" && item.isEntry)
      .code,
    outboundService: (request) => {
      calls++;
      return Response.json(
        new URL(request.url).hostname === "api.openai.com"
          ? openai()
          : gemini(),
      );
    },
  });
  t.after(() => mf.dispose());
  for (const name of ["openai", "gemini"]) {
    const response = await mf.dispatchFetch(`https://fictional.test/${name}`);
    assert.equal(
      response.status,
      200,
      response.status === 200 ? "ok" : await response.text(),
    );
    assert.equal((await response.json()).text, "練習分數");
  }
  assert.equal(calls, 2);
});
