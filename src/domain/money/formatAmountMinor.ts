/**
 * Formats a minor-unit amount (e.g. cents) as a decimal string using the
 * given currency precision. fractionDigits === 0 currencies (IDR, JPY, ...)
 * are returned as-is since their minor and major units are the same.
 */
export function formatAmountMinor(amountMinor: bigint, fractionDigits: number): string {
  if (fractionDigits === 0) return amountMinor.toString();

  const scale = 10n ** BigInt(fractionDigits);
  const sign = amountMinor < 0n ? "-" : "";
  const absoluteAmount = amountMinor < 0n ? -amountMinor : amountMinor;
  const whole = absoluteAmount / scale;
  const fraction = (absoluteAmount % scale).toString().padStart(fractionDigits, "0");

  return `${sign}${whole}.${fraction}`;
}

/**
 * Converts a minor-unit amount into a plain JS number of major units, e.g.
 * for writing numeric (chartable/sortable) cells into a spreadsheet. Safe for
 * ordinary personal-finance amounts, which stay well within
 * Number.MAX_SAFE_INTEGER.
 */
export function minorToMajorNumber(amountMinor: bigint, fractionDigits: number): number {
  if (fractionDigits === 0) return Number(amountMinor);

  const scale = 10 ** fractionDigits;
  return Number(amountMinor) / scale;
}

