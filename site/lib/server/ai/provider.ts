/** Server-only transport. Callers must authorize and build a PII-free AIContext. */
export type ProviderName = "openai" | "gemini";
export type ProviderConfiguration = { provider: ProviderName; model: string };
export type AIInput = { instructions: string; text: string };
export type AIOutput = {
  provider: ProviderName;
  model: string;
  text: string;
  attempts: number;
};
export interface AIProvider {
  generate(input: AIInput, signal?: AbortSignal): Promise<AIOutput>;
}
export const AI_LIMITS = Object.freeze({
  attemptMs: 30_000,
  totalMs: 100_000,
  attempts: 3,
  inputCharacters: 32_000,
  outputTokens: 4096,
  responseBytes: 1024 * 1024,
});
export type AIErrorCode =
  | "AI_CONFIGURATION_INVALID"
  | "AI_SECRET_MISSING"
  | "AI_INPUT_INVALID"
  | "AI_CANCELLED"
  | "AI_TIMEOUT"
  | "AI_NETWORK"
  | "AI_RATE_LIMITED"
  | "AI_UPSTREAM_UNAVAILABLE"
  | "AI_UPSTREAM_REJECTED"
  | "AI_RESPONSE_TOO_LARGE"
  | "AI_RESPONSE_INVALID"
  | "AI_OUTPUT_REJECTED";
export class AIProviderError extends Error {
  readonly code: AIErrorCode;
  constructor(code: AIErrorCode) {
    super(code);
    this.name = "AIProviderError";
    this.code = code;
  }
}
const fail = (code: AIErrorCode): never => {
  throw new AIProviderError(code);
};
export function providerConfiguration(value: unknown): ProviderConfiguration {
  const v = record(value);
  if (
    !v ||
    Object.keys(v).some((k) => !["provider", "model"].includes(k)) ||
    !["openai", "gemini"].includes(v.provider as string) ||
    typeof v.model !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(v.model)
  )
    return fail("AI_CONFIGURATION_INVALID");
  return { provider: v.provider as ProviderName, model: v.model };
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function inputText(value: AIInput) {
  if (
    !record(value) ||
    Object.keys(value).some((k) => !["instructions", "text"].includes(k)) ||
    typeof value.instructions !== "string" ||
    typeof value.text !== "string" ||
    !value.text.trim() ||
    [...value.instructions].length + [...value.text].length >
      AI_LIMITS.inputCharacters
  )
    fail("AI_INPUT_INVALID");
}
export type ProviderDependencies = {
  secrets: { OPENAI_API_KEY?: string; GEMINI_API_KEY?: string };
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
};
function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) fail("AI_CANCELLED");
}
async function pause(ms: number, signal?: AbortSignal) {
  cancelled(signal);
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(new AIProviderError("AI_CANCELLED"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
async function responseJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (
    Number(response.headers.get("Content-Length")) > AI_LIMITS.responseBytes
  ) {
    void response.body?.cancel().catch(() => {});
    return fail("AI_RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) return fail("AI_RESPONSE_INVALID");
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > AI_LIMITS.responseBytes) {
        void reader.cancel().catch(() => {});
        return fail("AI_RESPONSE_TOO_LARGE");
      }
      chunks.push(chunk.value);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return fail("AI_RESPONSE_INVALID");
  }
}
function openAIText(value: unknown) {
  const r = record(value);
  checkOutputTokens(record(r?.usage)?.output_tokens);
  if (
    !r ||
    r.status !== "completed" ||
    r.error ||
    r.incomplete_details ||
    !Array.isArray(r.output)
  )
    return fail("AI_OUTPUT_REJECTED");
  const output: string[] = [];
  for (const item of r.output) {
    const message = record(item);
    if (message?.type === "reasoning") continue;
    if (
      !message ||
      message.type !== "message" ||
      message.role !== "assistant" ||
      message.status !== "completed" ||
      !Array.isArray(message.content)
    )
      return fail("AI_OUTPUT_REJECTED");
    for (const part of message.content) {
      const p = record(part);
      if (!p || p.type !== "output_text" || typeof p.text !== "string")
        return fail("AI_OUTPUT_REJECTED");
      output.push(p.text);
    }
  }
  if (!output.join("").trim()) return fail("AI_OUTPUT_REJECTED");
  return output.join("");
}
function geminiText(value: unknown) {
  const r = record(value);
  checkOutputTokens(record(r?.usageMetadata)?.candidatesTokenCount);
  if (
    !r ||
    record(r.promptFeedback)?.blockReason ||
    !Array.isArray(r.candidates) ||
    r.candidates.length !== 1
  )
    return fail("AI_OUTPUT_REJECTED");
  const c = record(r.candidates[0]),
    content = record(c?.content);
  if (
    !c ||
    c.finishReason !== "STOP" ||
    content?.role !== "model" ||
    !Array.isArray(content.parts)
  )
    return fail("AI_OUTPUT_REJECTED");
  const output: string[] = [];
  for (const part of content.parts) {
    const p = record(part);
    if (
      !p ||
      Object.keys(p).some(
        (k) => !["text", "thought", "thoughtSignature"].includes(k),
      ) ||
      typeof p.text !== "string"
    )
      return fail("AI_OUTPUT_REJECTED");
    if (p.thought === true) continue;
    if (p.thought !== undefined && p.thought !== false)
      return fail("AI_OUTPUT_REJECTED");
    output.push(p.text);
  }
  if (!output.join("").trim()) return fail("AI_OUTPUT_REJECTED");
  return output.join("");
}
function checkOutputTokens(value: unknown) {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) ||
      Number(value) < 0 ||
      Number(value) > AI_LIMITS.outputTokens)
  )
    fail("AI_OUTPUT_REJECTED");
}
function retryDelay(header: string | null, now: number) {
  if (!header) return 0;
  if (/^\d+(\.\d+)?$/.test(header.trim())) return Number(header) * 1000;
  const timestamp = Date.parse(header);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}
class TextProvider implements AIProvider {
  private readonly config: ProviderConfiguration;
  private readonly deps: ProviderDependencies;
  constructor(config: ProviderConfiguration, deps: ProviderDependencies) {
    this.config = providerConfiguration(config);
    this.deps = deps;
  }
  async generate(input: AIInput, signal?: AbortSignal): Promise<AIOutput> {
    inputText(input);
    cancelled(signal);
    const { provider, model } = this.config;
    const key =
      provider === "openai"
        ? this.deps.secrets.OPENAI_API_KEY
        : this.deps.secrets.GEMINI_API_KEY;
    if (typeof key !== "string" || !key.trim() || /[\r\n]/.test(key))
      return fail("AI_SECRET_MISSING");
    const now = this.deps.now ?? Date.now,
      deadline = now() + AI_LIMITS.totalMs;
    const url =
      provider === "openai"
        ? "https://api.openai.com/v1/responses"
        : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const body = JSON.stringify(
      provider === "openai"
        ? {
            model,
            instructions: input.instructions,
            input: input.text,
            max_output_tokens: AI_LIMITS.outputTokens,
            store: false,
            tools: [],
          }
        : {
            systemInstruction: { parts: [{ text: input.instructions }] },
            contents: [{ role: "user", parts: [{ text: input.text }] }],
            generationConfig: {
              maxOutputTokens: AI_LIMITS.outputTokens,
              candidateCount: 1,
            },
            store: false,
          },
    );
    for (let attempt = 1; attempt <= AI_LIMITS.attempts; attempt++) {
      cancelled(signal);
      const remaining = deadline - now();
      if (remaining <= 0) return fail("AI_TIMEOUT");
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      let retryAfter = 0;
      try {
        const interrupted = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              controller.abort();
              reject(new AIProviderError("AI_TIMEOUT"));
            },
            Math.min(AI_LIMITS.attemptMs, remaining),
          );
          abort = () => {
            controller.abort();
            reject(new AIProviderError("AI_CANCELLED"));
          };
          signal?.addEventListener("abort", abort, { once: true });
        });
        const execute = async () => {
          const response = await (this.deps.fetch ?? fetch)(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(provider === "openai"
                ? { Authorization: `Bearer ${key}` }
                : { "x-goog-api-key": key }),
            },
            body,
            signal: controller.signal,
            redirect: "manual",
          });
          if (controller.signal.aborted) {
            void response.body?.cancel().catch(() => {});
            return fail("AI_TIMEOUT");
          }
          if (!response.ok) {
            retryAfter = retryDelay(response.headers.get("Retry-After"), now());
            void response.body?.cancel().catch(() => {});
            return fail(
              response.status === 429
                ? "AI_RATE_LIMITED"
                : [500, 502, 503, 504].includes(response.status)
                  ? "AI_UPSTREAM_UNAVAILABLE"
                  : "AI_UPSTREAM_REJECTED",
            );
          }
          const data = await responseJson(response, controller.signal);
          return provider === "openai" ? openAIText(data) : geminiText(data);
        };
        const text = await Promise.race([execute(), interrupted]);
        cancelled(signal);
        if (now() >= deadline) return fail("AI_TIMEOUT");
        return { provider, model, text, attempts: attempt };
      } catch (error) {
        cancelled(signal);
        const safe =
          error instanceof AIProviderError
            ? error
            : new AIProviderError("AI_NETWORK");
        if (
          attempt === AI_LIMITS.attempts ||
          ![
            "AI_TIMEOUT",
            "AI_NETWORK",
            "AI_RATE_LIMITED",
            "AI_UPSTREAM_UNAVAILABLE",
          ].includes(safe.code)
        )
          throw safe;
        const random = this.deps.random?.() ?? Math.random();
        const delay = Math.max(
          retryAfter,
          1000 * attempt + Math.floor(Math.max(0, Math.min(1, random)) * 250),
        );
        if (now() + delay >= deadline) return fail("AI_TIMEOUT");
        // End the attempt before sleeping; the total deadline includes backoff.
        clearTimeout(timer);
        if (abort) signal?.removeEventListener("abort", abort);
        await pause(delay, signal);
      } finally {
        clearTimeout(timer);
        if (abort) signal?.removeEventListener("abort", abort);
        controller.abort();
      }
    }
    return fail("AI_UPSTREAM_UNAVAILABLE");
  }
}
export class OpenAIProvider extends TextProvider {
  constructor(model: string, deps: ProviderDependencies) {
    super({ provider: "openai", model }, deps);
  }
}
export class GeminiProvider extends TextProvider {
  constructor(model: string, deps: ProviderDependencies) {
    super({ provider: "gemini", model }, deps);
  }
}
export function createAIProvider(
  config: ProviderConfiguration,
  deps: ProviderDependencies,
): AIProvider {
  const checked = providerConfiguration(config);
  return checked.provider === "openai"
    ? new OpenAIProvider(checked.model, deps)
    : new GeminiProvider(checked.model, deps);
}
