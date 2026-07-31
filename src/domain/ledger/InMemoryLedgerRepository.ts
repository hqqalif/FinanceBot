import { randomUUID } from "node:crypto";

import type {
  LedgerRepository,
  LedgerTransaction,
  RecordExpenseInput,
  RecordExpenseResult,
  WalletBalance,
} from "./LedgerRepository.js";

type StoredTransaction = {
  userWhatsAppId: string;
  walletCurrency: string;
  categoryName: string | null;
  description: string;
  amountMinor: bigint;
  transactionType: "expense" | "income" | "transfer" | "adjustment";
  occurredAt: Date;
  transactionId: string;
};

export class InMemoryLedgerRepository implements LedgerRepository {
  private readonly transactionsByMessageId = new Map<string, StoredTransaction>();
  private readonly openingBalances = new Map<string, bigint>();

  public async setOpeningBalance(userWhatsAppId: string, currency: string, amountMinor: bigint): Promise<void> {
    this.openingBalances.set(this.walletKey(userWhatsAppId, currency), amountMinor);
  }

  public async addFunds(
    userWhatsAppId: string,
    currency: string,
    amountMinor: bigint,
    sourceMessageId: string,
  ): Promise<void> {
    if (this.transactionsByMessageId.has(sourceMessageId)) return;

    const key = this.walletKey(userWhatsAppId, currency);
    const currentBalance = this.openingBalances.get(key) ?? 0n;
    this.openingBalances.set(key, currentBalance + amountMinor);
    this.transactionsByMessageId.set(sourceMessageId, {
      userWhatsAppId,
      walletCurrency: currency,
      categoryName: null,
      description: "Top up",
      amountMinor,
      transactionType: "income",
      occurredAt: new Date(),
      transactionId: randomUUID(),
    });
  }

  public async recordExpense(input: RecordExpenseInput): Promise<RecordExpenseResult> {
    const existingExpense = this.transactionsByMessageId.get(input.sourceMessageId);

    if (existingExpense) {
      return { created: false, transactionId: existingExpense.transactionId };
    }

    const transactionId = randomUUID();
    this.transactionsByMessageId.set(input.sourceMessageId, {
      userWhatsAppId: input.userWhatsAppId,
      walletCurrency: input.walletCurrency,
      categoryName: input.categoryName,
      description: input.description,
      amountMinor: input.amountMinor,
      transactionType: "expense",
      occurredAt: input.occurredAt,
      transactionId,
    });
    return { created: true, transactionId };
  }

  public async getBalances(userWhatsAppId: string): Promise<WalletBalance[]> {
    const currencies = new Set<string>();

    for (const [key] of this.openingBalances) {
      const [owner, currency] = key.split(":", 2);
      if (owner === userWhatsAppId) currencies.add(currency);
    }

    for (const transaction of this.transactionsByMessageId.values()) {
      if (transaction.userWhatsAppId === userWhatsAppId) currencies.add(transaction.walletCurrency);
    }

    return [...currencies]
      .sort()
      .map((currency) => {
        const openingBalanceMinor = this.openingBalances.get(this.walletKey(userWhatsAppId, currency)) ?? 0n;
        const expenseTotalMinor = [...this.transactionsByMessageId.values()]
          .filter(
            (transaction) =>
              transaction.userWhatsAppId === userWhatsAppId &&
              transaction.walletCurrency === currency &&
              transaction.transactionType === "expense",
          )
          .reduce((total, transaction) => total + transaction.amountMinor, 0n);

        return {
          walletId: this.walletKey(userWhatsAppId, currency),
          currency,
          openingBalanceMinor,
          expenseTotalMinor,
          currentBalanceMinor: openingBalanceMinor - expenseTotalMinor,
        };
      });
  }

  public async deleteWallet(userWhatsAppId: string, currency: string): Promise<boolean> {
    const key = this.walletKey(userWhatsAppId, currency);
    const hadOpeningBalance = this.openingBalances.delete(key);

    let hadTransactions = false;
    for (const [messageId, transaction] of this.transactionsByMessageId) {
      if (transaction.userWhatsAppId === userWhatsAppId && transaction.walletCurrency === currency) {
        this.transactionsByMessageId.delete(messageId);
        hadTransactions = true;
      }
    }

    return hadOpeningBalance || hadTransactions;
  }

  public async listTransactionsInRange(
    userWhatsAppId: string,
    currency: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<LedgerTransaction[]> {
    return [...this.transactionsByMessageId.values()]
      .filter(
        (transaction) =>
          transaction.userWhatsAppId === userWhatsAppId &&
          transaction.walletCurrency === currency &&
          transaction.occurredAt >= periodStart &&
          transaction.occurredAt <= periodEnd,
      )
      .map((transaction) => ({
        occurredAt: transaction.occurredAt,
        categoryName: transaction.categoryName,
        description: transaction.description,
        amountMinor: transaction.amountMinor,
        transactionType: transaction.transactionType,
      }))
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  private walletKey(userWhatsAppId: string, currency: string): string {
    return `${userWhatsAppId}:${currency}`;
  }
}