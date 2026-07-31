import type {
  LedgerRepository,
  LedgerTransaction,
  RecordExpenseInput,
  RecordExpenseResult,
  WalletBalance,
} from "./LedgerRepository.js";

/**
 * Thrown for domain-level validation failures (bad currency code, non-positive
 * amount, etc). Kept as a distinct type from generic errors (DB failures,
 * network errors) so callers can safely show its message to the end user
 * without leaking internals.
 */
export class LedgerValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "LedgerValidationError";
  }
}

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export class LedgerService {
  public constructor(private readonly repository: LedgerRepository) {}

  public async setOpeningBalance(
    userWhatsAppId: string,
    currency: string,
    amountMinor: bigint,
  ): Promise<void> {
    if (!CURRENCY_CODE_PATTERN.test(currency)) {
      throw new LedgerValidationError("Wallet currency must be a three-letter ISO 4217 code.");
    }

    await this.repository.setOpeningBalance(userWhatsAppId, currency, amountMinor);
  }

  public async addFunds(
    userWhatsAppId: string,
    currency: string,
    amountMinor: bigint,
    sourceMessageId: string,
  ): Promise<void> {
    if (!CURRENCY_CODE_PATTERN.test(currency)) {
      throw new LedgerValidationError("Wallet currency must be a three-letter ISO 4217 code.");
    }

    if (amountMinor <= 0n) {
      throw new LedgerValidationError("Amount to add must be greater than zero.");
    }

    await this.repository.addFunds(userWhatsAppId, currency, amountMinor, sourceMessageId);
  }

  public async recordExpense(input: RecordExpenseInput): Promise<RecordExpenseResult> {
    if (input.amountMinor <= 0n) {
      throw new LedgerValidationError("Expense amount must be greater than zero.");
    }

    if (!CURRENCY_CODE_PATTERN.test(input.walletCurrency)) {
      throw new LedgerValidationError("Wallet currency must be a three-letter ISO 4217 code.");
    }

    return this.repository.recordExpense(input);
  }

  public getBalances(userWhatsAppId: string): Promise<WalletBalance[]> {
    return this.repository.getBalances(userWhatsAppId);
  }

  public async deleteWallet(userWhatsAppId: string, currency: string): Promise<void> {
    if (!CURRENCY_CODE_PATTERN.test(currency)) {
      throw new LedgerValidationError("Wallet currency must be a three-letter ISO 4217 code.");
    }

    const deleted = await this.repository.deleteWallet(userWhatsAppId, currency);
    if (!deleted) {
      throw new LedgerValidationError(`No ${currency} wallet exists for this account.`);
    }
  }

  public async getMonthlyReportData(
    userWhatsAppId: string,
    currency: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<{ wallet: WalletBalance; transactions: LedgerTransaction[] }> {
    if (!CURRENCY_CODE_PATTERN.test(currency)) {
      throw new LedgerValidationError("Wallet currency must be a three-letter ISO 4217 code.");
    }

    const balances = await this.repository.getBalances(userWhatsAppId);
    const wallet = balances.find((balance) => balance.currency === currency);
    if (!wallet) {
      throw new LedgerValidationError(`No ${currency} wallet exists for this account.`);
    }

    const transactions = await this.repository.listTransactionsInRange(
      userWhatsAppId,
      currency,
      periodStart,
      periodEnd,
    );

    return { wallet, transactions };
  }
}