/** Reference text is data. These helpers never interpret Markdown, HTML or instructions. */
export class ReferenceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.name = "ReferenceError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeReferenceText(text: string): string {
  return text.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
}

export function chunkReferenceText(
  text: string,
  limits: { size: number; overlap: number; count: number },
): string[] {
  if (
    !Number.isSafeInteger(limits.size) ||
    !Number.isSafeInteger(limits.overlap) ||
    !Number.isSafeInteger(limits.count) ||
    limits.size < 1 ||
    limits.overlap < 0 ||
    limits.overlap >= limits.size ||
    limits.count < 1
  )
    throw new ReferenceError("INVALID_CHUNK_CONFIGURATION");
  // Count Unicode code points, without cutting a surrogate pair in half.
  const points = Array.from(normalizeReferenceText(text));
  if (!points.length) throw new ReferenceError("REFERENCE_TEXT_EMPTY");
  const chunks: string[] = [];
  for (let offset = 0; offset < points.length;) {
    if (chunks.length === limits.count)
      throw new ReferenceError("REFERENCE_CHUNK_LIMIT", 413);
    chunks.push(points.slice(offset, offset + limits.size).join(""));
    if (offset + limits.size >= points.length) break;
    offset += limits.size - limits.overlap;
  }
  return chunks;
}

/**
 * unicode61 does not split continuous Han text. Encode each Han character as one
 * ASCII token; encode other words separately to prevent collisions with literals.
 * A phrase query then supports Chinese substrings without changing source text.
 */
export function referenceSearchTokens(text: string): string[] {
  return (
    normalizeReferenceText(text)
      .toLowerCase()
      .match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}\p{M}])+/gu) ?? []
  ).map((word) =>
    Array.from(word, (point) => point.codePointAt(0)!.toString(16)).join("x"),
  );
}

export function referenceSearchQuery(text: string): string {
  const tokens = referenceSearchTokens(text);
  if (!tokens.length) throw new ReferenceError("REFERENCE_QUERY_EMPTY");
  // Only hexadecimal digits, x, and spaces can reach the FTS parser.
  return `"${tokens.join(" ")}"`;
}
