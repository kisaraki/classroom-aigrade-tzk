/** D-03: these inputs are frozen on roster confirmation, never recalculated in old rows. */
export function resolveRankingEligibility(input: {
  studentDefault: boolean;
  termOverride: boolean | null;
  examOverride: boolean | null;
  origin: "LOCAL" | "EXTERNAL_TRANSFER";
}): boolean {
  return (
    input.origin === "LOCAL" &&
    (input.examOverride ?? input.termOverride ?? input.studentDefault)
  );
}
