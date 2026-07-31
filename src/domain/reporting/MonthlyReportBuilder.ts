import { minorToMajorNumber } from "../money/formatAmountMinor.js";
import type { LedgerTransaction, WalletBalance } from "../ledger/LedgerRepository.js";

export type CategoryBreakdownRow = {
  category: string;
  totalAmount: number;
  percentOfTotal: number;
};

export type DailySummaryRow = {
  date: string;
  totalSpent: number;
  topCategory: string;
  count: number;
};

export type DetailedLedgerRow = {
  date: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  transactionType: LedgerTransaction["transactionType"];
};

export type MonthlyReportData = {
  currency: string;
  fractionDigits: number;
  periodLabel: string;
  totalIncome: number;
  totalExpenses: number;
  netForPeriod: number;
  currentWalletBalance: number;
  categoryBreakdown: CategoryBreakdownRow[];
  dailySummary: DailySummaryRow[];
  detailedLedger: DetailedLedgerRow[];
};

export type BuildMonthlyReportInput = {
  currency: string;
  fractionDigits: number;
  periodLabel: string;
  wallet: WalletBalance;
  transactions: LedgerTransaction[];
};

const UNCATEGORIZED = "Uncategorized";

/**
 * Pure aggregation over ledger transactions for a single wallet/period - no
 * I/O. Kept separate from GoogleSheetsReportService so the numbers can be
 * unit-tested without any network/Google API dependency. Amounts are plain
 * JS numbers of major units (not minor-unit bigints/strings) so the
 * spreadsheet can chart/sort/format them natively.
 */
export function buildMonthlyReport(input: BuildMonthlyReportInput): MonthlyReportData {
  const { currency, fractionDigits, periodLabel, wallet, transactions } = input;
  const toMajor = (amountMinor: bigint) => minorToMajorNumber(amountMinor, fractionDigits);

  const expenses = transactions.filter((transaction) => transaction.transactionType === "expense");
  const income = transactions.filter((transaction) => transaction.transactionType === "income");

  const totalIncomeMinor = income.reduce((total, transaction) => total + transaction.amountMinor, 0n);
  const totalExpensesMinor = expenses.reduce((total, transaction) => total + transaction.amountMinor, 0n);

  return {
    currency,
    fractionDigits,
    periodLabel,
    totalIncome: toMajor(totalIncomeMinor),
    totalExpenses: toMajor(totalExpensesMinor),
    netForPeriod: toMajor(totalIncomeMinor - totalExpensesMinor),
    currentWalletBalance: toMajor(wallet.currentBalanceMinor),
    categoryBreakdown: buildCategoryBreakdown(expenses, totalExpensesMinor, toMajor),
    dailySummary: buildDailySummary(expenses, toMajor),
    detailedLedger: buildDetailedLedger(transactions, currency, toMajor),
  };
}

function buildCategoryBreakdown(
  expenses: LedgerTransaction[],
  totalExpensesMinor: bigint,
  toMajor: (amountMinor: bigint) => number,
): CategoryBreakdownRow[] {
  const totalsByCategory = new Map<string, bigint>();

  for (const transaction of expenses) {
    const category = transaction.categoryName ?? UNCATEGORIZED;
    totalsByCategory.set(category, (totalsByCategory.get(category) ?? 0n) + transaction.amountMinor);
  }

  return [...totalsByCategory.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([category, totalMinor]) => ({
      category,
      totalAmount: toMajor(totalMinor),
      percentOfTotal: totalExpensesMinor === 0n ? 0 : (Number(totalMinor) / Number(totalExpensesMinor)) * 100,
    }));
}

function buildDailySummary(
  expenses: LedgerTransaction[],
  toMajor: (amountMinor: bigint) => number,
): DailySummaryRow[] {
  const byDate = new Map<string, { totalMinor: bigint; count: number; categoryTotals: Map<string, bigint> }>();

  for (const transaction of expenses) {
    const date = transaction.occurredAt.toISOString().slice(0, 10);
    const entry = byDate.get(date) ?? { totalMinor: 0n, count: 0, categoryTotals: new Map<string, bigint>() };
    entry.totalMinor += transaction.amountMinor;
    entry.count += 1;

    const category = transaction.categoryName ?? UNCATEGORIZED;
    entry.categoryTotals.set(category, (entry.categoryTotals.get(category) ?? 0n) + transaction.amountMinor);

    byDate.set(date, entry);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => {
      const topCategory = [...entry.categoryTotals.entries()].sort((a, b) =>
        b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0,
      )[0]?.[0];

      return {
        date,
        totalSpent: toMajor(entry.totalMinor),
        topCategory: topCategory ?? UNCATEGORIZED,
        count: entry.count,
      };
    });
}

function buildDetailedLedger(
  transactions: LedgerTransaction[],
  currency: string,
  toMajor: (amountMinor: bigint) => number,
): DetailedLedgerRow[] {
  return transactions.map((transaction) => ({
    date: transaction.occurredAt.toISOString().slice(0, 10),
    category: transaction.categoryName ?? "-",
    description: transaction.description,
    amount: toMajor(transaction.amountMinor),
    currency,
    transactionType: transaction.transactionType,
  }));
}
