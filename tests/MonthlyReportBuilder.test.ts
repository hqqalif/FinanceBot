import { describe, expect, it } from "vitest";

import { buildMonthlyReport } from "../src/domain/reporting/MonthlyReportBuilder.js";
import type { LedgerTransaction, WalletBalance } from "../src/domain/ledger/LedgerRepository.js";

const wallet: WalletBalance = {
  walletId: "wallet-1",
  currency: "IDR",
  openingBalanceMinor: 200_000n,
  expenseTotalMinor: 55_000n,
  currentBalanceMinor: 145_000n,
};

const transactions: LedgerTransaction[] = [
  {
    occurredAt: new Date("2026-07-01T08:00:00Z"),
    categoryName: "Food",
    description: "Lunch",
    amountMinor: 45_000n,
    transactionType: "expense",
  },
  {
    occurredAt: new Date("2026-07-01T18:00:00Z"),
    categoryName: "Transport",
    description: "Taxi",
    amountMinor: 10_000n,
    transactionType: "expense",
  },
  {
    occurredAt: new Date("2026-07-05T09:00:00Z"),
    categoryName: null,
    description: "Top up",
    amountMinor: 200_000n,
    transactionType: "income",
  },
];

describe("buildMonthlyReport", () => {
  it("aggregates totals, category breakdown, daily summary, and detailed ledger", () => {
    const report = buildMonthlyReport({
      currency: "IDR",
      fractionDigits: 0,
      periodLabel: "07-2026",
      wallet,
      transactions,
    });

    expect(report.totalIncome).toBe(200_000);
    expect(report.totalExpenses).toBe(55_000);
    expect(report.netForPeriod).toBe(145_000);
    expect(report.currentWalletBalance).toBe(145_000);

    expect(report.categoryBreakdown).toEqual([
      { category: "Food", totalAmount: 45_000, percentOfTotal: (45_000 / 55_000) * 100 },
      { category: "Transport", totalAmount: 10_000, percentOfTotal: (10_000 / 55_000) * 100 },
    ]);

    expect(report.dailySummary).toEqual([
      { date: "2026-07-01", totalSpent: 55_000, topCategory: "Food", count: 2 },
    ]);

    expect(report.detailedLedger).toHaveLength(3);
    expect(report.detailedLedger[2]).toMatchObject({
      category: "Uncategorized",
      description: "Top up",
      amount: 200_000,
      transactionType: "income",
    });
  });

  it("handles an empty period without dividing by zero", () => {
    const report = buildMonthlyReport({
      currency: "AUD",
      fractionDigits: 2,
      periodLabel: "07-2026",
      wallet: { ...wallet, currency: "AUD", currentBalanceMinor: 0n },
      transactions: [],
    });

    expect(report.totalIncome).toBe(0);
    expect(report.totalExpenses).toBe(0);
    expect(report.categoryBreakdown).toEqual([]);
    expect(report.dailySummary).toEqual([]);
  });
});
