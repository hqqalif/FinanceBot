export type SpendingCommand = {
  description: string;
  category: string;
  amountMinor: bigint;
  currency: string;
};

export type ResolvedCurrency = {
  currency: string;
  fractionDigits: number;
};

export type ParseSpendingCommandOptions = {
  resolveCurrency: (explicitCurrency: string | undefined) => ResolvedCurrency;
};

export class SpendingCommandError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SpendingCommandError";
  }
}

const DECIMAL_PATTERN = /^(?<whole>\d+)(?:\.(?<fraction>\d+))?$/;
const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;

export function parseSpendingCommand(
  message: string,
  { resolveCurrency }: ParseSpendingCommandOptions,
): SpendingCommand {
  const parts = message.split(",");

  const [rawDescription, rawCategory, rawAmount, rawCurrency] = parts.map((part) => part.trim());

  if (!rawDescription || !rawCategory || !rawAmount) {
    throw new SpendingCommandError("Isi semua data sesuai template");
  }

  let explicitCurrency: string | undefined;

  if (rawCurrency) {
    if (!CURRENCY_CODE_PATTERN.test(rawCurrency)) {
      throw new SpendingCommandError("Mata uang harus singkatan 3 huruf. Contoh: IDR, AUD.");
    }

    explicitCurrency = rawCurrency.toUpperCase();
  }

  const { currency, fractionDigits } = resolveCurrency(explicitCurrency);

  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > 4) {
    throw new SpendingCommandError("Angka dibelakang koma harus kurang dari 4");
  }

  return {
    description: rawDescription,
    category: rawCategory,
    amountMinor: parseAmountToMinorUnits(rawAmount, fractionDigits),
    currency,
  };
}


function parseAmountToMinorUnits(rawAmount: string, fractionDigits: number): bigint {
  const trimmed = rawAmount.trim();

  if (fractionDigits === 0) {
    const normalized = trimmed.replace(/,/g, "");
    const match = DECIMAL_PATTERN.exec(normalized);

    if (!match?.groups) {
      throw new SpendingCommandError("Harga harus berupa angka positif");
    }

    if (match.groups.fraction && /[1-9]/.test(match.groups.fraction)) {
      throw new SpendingCommandError(
        "Terlalu banyak angka di belakang koma",
      );
    }

    const amountMinor = BigInt(match.groups.whole);
    if (amountMinor === 0n) {
      throw new SpendingCommandError("Harga harus lebih besar dari 0");
    }

    return amountMinor;
  }

  const normalized = trimmed.replace(/,/g, "");
  const match = DECIMAL_PATTERN.exec(normalized);

  if (!match?.groups) {
    throw new SpendingCommandError("PHarga harus berupa angka positif");
  }

  const whole = BigInt(match.groups.whole);
  const rawFraction = match.groups.fraction ?? "";

  if (rawFraction.length > fractionDigits) {
    throw new SpendingCommandError(
      `Terlalu banyak angka di belakang koma (maksimal ${fractionDigits} digit).`,
    );
  }

  const scale = 10n ** BigInt(fractionDigits);
  const fraction = rawFraction.padEnd(fractionDigits, "0");
  const amountMinor = whole * scale + BigInt(fraction || "0");

  if (amountMinor === 0n) {
    throw new SpendingCommandError("Harga harus lebih besar dari 0");
  }

  return amountMinor;
}