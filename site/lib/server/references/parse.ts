import { getDocumentProxy } from "unpdf";
import {
  ReferenceError,
  normalizeReferenceText,
} from "../../domain/rag-text.ts";

export const REFERENCE_LIMITS = Object.freeze({
  bytes: 5 * 1024 * 1024,
  pages: 100,
  characters: 200_000,
  size: 1000,
  overlap: 100,
  count: 250,
  query: 200,
  results: 8,
  context: 8000,
});
export const fail = (code: string, status = 400): never => {
  throw new ReferenceError(code, status);
};
export const fingerprint = async (value: Uint8Array | string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : new Uint8Array(value),
      ),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");

export function checkedText(text: string) {
  const normalized = normalizeReferenceText(text);
  if (
    !normalized ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(normalized)
  )
    fail("REFERENCE_TEXT_INVALID");
  if (Array.from(normalized).length > REFERENCE_LIMITS.characters)
    fail("REFERENCE_TEXT_TOO_LARGE", 413);
  return normalized;
}

/** No rendering, scripting, network fonts, OCR, HTML evaluation or tool execution. */
export async function parseReference(format: "md" | "pdf", bytes: Uint8Array) {
  if (!bytes.length || bytes.length > REFERENCE_LIMITS.bytes)
    fail("REFERENCE_FILE_TOO_LARGE", 413);
  if (format === "md") {
    try {
      return {
        text: checkedText(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        ),
        auxiliary: "",
      };
    } catch (error) {
      if (error instanceof ReferenceError) throw error;
      return fail("REFERENCE_UTF8_REQUIRED");
    }
  }
  if (
    format !== "pdf" ||
    new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
  )
    fail("REFERENCE_FORMAT_INVALID", 415);
  // Supplement semantic inspection with decoded PDF names, including escaped names.
  const names = new TextDecoder("latin1")
    .decode(bytes)
    .replace(/#([0-9a-f]{2})/gi, (_, h: string) =>
      String.fromCharCode(parseInt(h, 16)),
    );
  if (
    /\/(?:Encrypt|JavaScript|JS|Launch|RichMedia|EmbeddedFile|XFA|SubmitForm|ImportData|GoToR|GoToE|URI|OpenAction|AA)\b/.test(
      names,
    )
  )
    fail("REFERENCE_PDF_ACTIVE_OR_ENCRYPTED");
  let document: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    document = await getDocumentProxy(new Uint8Array(bytes), {
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      enableXfa: false,
      stopAtErrors: true,
      verbosity: 0,
      cMapUrl: undefined,
      standardFontDataUrl: undefined,
    });
    if (document.numPages > REFERENCE_LIMITS.pages)
      fail("REFERENCE_PDF_PAGE_LIMIT", 413);
    const metadata = await document.getMetadata();
    const info = metadata.info as Record<string, unknown>;
    if (
      (await document.getJSActions()) ||
      (await document.getAttachments()) ||
      info.IsAcroFormPresent ||
      info.IsXFAPresent ||
      (await document.getPermissions())
    )
      fail("REFERENCE_PDF_ACTIVE_OR_ENCRYPTED");
    const pages: string[] = [];
    const annotationText: string[] = [];
    let characters = 0;
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      if (await page.getJSActions()) fail("REFERENCE_PDF_ACTIVE_OR_ENCRYPTED");
      const annotations = await page.getAnnotations();
      annotationText.push(JSON.stringify(annotations));
      if (
        annotations.some(
          (a) =>
            a.file ||
            a.actions ||
            a.url ||
            a.unsafeUrl ||
            a.hasJSActions ||
            a.subtype === "RichMedia" ||
            a.subtype === "Widget",
        )
      )
        fail("REFERENCE_PDF_ACTIVE_OR_ENCRYPTED");
      const reader = page.streamTextContent().getReader();
      let text = "";
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        for (const item of next.value.items) {
          if (!("str" in item)) continue;
          const part = item.str + (item.hasEOL ? "\n" : " ");
          characters += Array.from(part).length;
          if (characters > REFERENCE_LIMITS.characters) {
            await reader.cancel();
            fail("REFERENCE_TEXT_TOO_LARGE", 413);
          }
          text += part;
        }
      }
      if (!text.trim()) fail("REFERENCE_PDF_OCR_REQUIRED");
      pages.push(text);
      page.cleanup();
    }
    return {
      text: checkedText(pages.join("\n")),
      auxiliary: JSON.stringify({
        info,
        metadata: metadata.metadata?.getRaw(),
        outline: await document.getOutline(),
        annotations: annotationText,
      }),
    };
  } catch (error) {
    if (error instanceof ReferenceError) throw error;
    return fail("REFERENCE_PDF_INVALID");
  } finally {
    await document?.loadingTask.destroy();
  }
}

export function privacyText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\p{Cf}\s]/gu, "")
    .toLowerCase();
}
export function assertReferencePrivacy(
  text: string,
  identifiers: readonly string[],
) {
  const value = privacyText(text);
  if (
    /[a-z][12]\d{8}/i.test(value) ||
    /[a-z][89a-d]\d{8}/i.test(value) ||
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value) ||
    /(?:09\d{8}|\d{4}[-/]\d{1,2}[-/]\d{1,2})/.test(value) ||
    /(?:姓名|生日|出生日期|身分證|身份證|學號|student_?id)[:：=]/i.test(
      value,
    ) ||
    identifiers.some(
      (identifier) => identifier && value.includes(privacyText(identifier)),
    )
  )
    fail("REFERENCE_PERSONAL_DATA_REJECTED");
}
