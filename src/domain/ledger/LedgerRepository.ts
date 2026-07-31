export type WalletBalance = {
  walletId: string;
  currency: string;
  openingBalanceMinor: bigint;
  expenseTotalMinor: bigint;
  currentBalanceMinor: bigint;
};

export type RecordExpenseInput = {
  userWhatsAppId: string;
  sourceMessageId: string;
  walletCurrency: string;
  description: string;
  categoryName: string;
  amountMinor: bigint;
  occurredAt: Date;
};

export type RecordExpenseResult = {
  created: boolean;
  transactionId: string;
};

export interface LedgerRepository {
  setOpeningBalance(userWhatsAppId: string, currency: string, amountMinor: bigint): Promise<void>;
  addFunds(userWhatsAppId: string, currency: string, amountMinor: bigint, sourceMessageId: string): Promise<void>;
  recordExpense(input: RecordExpenseInput): Promise<RecordExpenseResult>;
  getBalances(userWhatsAppId: string): Promise<WalletBalance[]>;
  /** Returns true if a matching wallet existed and was deleted. */
  deleteWallet(userWhatsAppId: string, currency: string): Promise<boolean>;
  listTransactionsInRange(
    userWhatsAppId: string,
    currency: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<LedgerTransaction[]>;
}

export type LedgerTransaction = {
  occurredAt: Date;
  categoryName: string | null;
  description: string;
  amountMinor: bigint;
  transactionType: "expense" | "income" | "transfer" | "adjustment";
};