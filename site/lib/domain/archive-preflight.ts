export const ARCHIVE_WARNINGS = [
  "MISSING_SCORES",
  "AI_INCOMPLETE",
  "UNPUBLISHED_EXAMS",
  "IMPORT_INCOMPLETE",
  "AI_FAILED",
] as const;
export type ArchiveWarningCode = (typeof ARCHIVE_WARNINGS)[number];

/** Business warnings only. This grants no permission and never bypasses transaction guards. */
export function archivePreflight(
  counts: Record<ArchiveWarningCode, number>,
  confirmation: { force: boolean; reason: string },
) {
  if (
    !counts ||
    Object.keys(counts).length !== ARCHIVE_WARNINGS.length ||
    ARCHIVE_WARNINGS.some(
      (key) => !Number.isSafeInteger(counts[key]) || counts[key] < 0,
    ) ||
    !confirmation ||
    typeof confirmation.force !== "boolean" ||
    typeof confirmation.reason !== "string" ||
    confirmation.reason.length > 320
  )
    throw new Error("INVALID_ARCHIVE_PREFLIGHT");
  const warnings = ARCHIVE_WARNINGS.filter((code) => counts[code] > 0).map(
    (code) => ({ code, count: counts[code] }),
  );
  // Every archive needs a reason, including a clean preflight; forced warnings require explicit acknowledgement.
  return {
    warnings,
    reasonRequired: !confirmation.reason.trim(),
    warningsAcknowledged: warnings.length === 0 || confirmation.force,
  };
}
