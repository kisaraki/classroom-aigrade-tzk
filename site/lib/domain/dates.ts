/** Taipei business dates use a half-open interval; no fixed 365/30-day years/months. */
export function assertBusinessDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("INVALID_BUSINESS_DATE");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new Error("INVALID_BUSINESS_DATE");
}

export function taipeiBusinessDate(utcMilliseconds: number): string {
  if (!Number.isSafeInteger(utcMilliseconds) || utcMilliseconds < 0)
    throw new Error("INVALID_TIMESTAMP");
  return new Date(utcMilliseconds + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function addCalendarMonths(value: string, months: number): string {
  assertBusinessDate(value);
  if (!Number.isSafeInteger(months)) throw new Error("INVALID_MONTH_OFFSET");
  const [year, month, day] = value.split("-").map(Number);
  const target = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  target.setUTCFullYear(year, month - 1 + months, 1);
  const last = new Date(target);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  target.setUTCDate(Math.min(day, last.getUTCDate()));
  if (
    !Number.isFinite(target.getTime()) ||
    target.getUTCFullYear() < 1 ||
    target.getUTCFullYear() > 9999
  )
    throw new Error("INVALID_MONTH_OFFSET");
  return target.toISOString().slice(0, 10);
}

export function addCalendarYears(value: string, years: number): string {
  if (!Number.isSafeInteger(years)) throw new Error("INVALID_YEAR_OFFSET");
  return addCalendarMonths(value, years * 12);
}

export function containsBusinessDate(
  from: string,
  to: string | null,
  value: string,
): boolean {
  for (const item of [from, to, value])
    if (item !== null) assertBusinessDate(item);
  if (to !== null && to <= from) throw new Error("INVALID_DATE_INTERVAL");
  return value >= from && (to === null || value < to);
}
