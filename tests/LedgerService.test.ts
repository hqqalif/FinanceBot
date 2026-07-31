import { describe, expect, it } from "vitest";

import { InMemoryLedgerRepository } from "../src/domain/ledger/InMemoryLedgerRepository.js";
import { LedgerService } from "../src/domain/ledger/LedgerService.js";

describe("LedgerService", () => {
  it("keeps balances separate by currency and ignores duplicate WhatsApp messages", async () => {
    const repository = new InMemoryLedgerRepository();
    repository.setOpeningBalance("628123@example.whatsapp.net", "IDR", 1_000_000n);
    repository.setOpeningBalance("628123@example.whatsapp.net", "USD", 500_00n);
    const service = new LedgerService(repository);

    const expense = {
      userWhatsAppId: "628123@example.whatsapp.net",
      sourceMessageId: "message-001",
      walletCurrency: "IDR",
      description: "Lunch",
      categoryName: "Food",
      amountMinor: 45_000n,
      occurredAt: new Date("2026-07-23T12:00:00Z"),
    };

    expect(await service.recordExpense(expense)).toMatchObject({ created: true });
    expect(await service.recordExpense(expense)).toMatchObject({ created: false });

    expect(await service.getBalances("628123@example.whatsapp.net")).toEqual([
      {
        walletId: "628123@example.whatsapp.net:IDR",
        currency: "IDR",
        openingBalanceMinor: 1_000_000n,
        expenseTotalMinor: 45_000n,
        currentBalanceMinor: 955_000n,
      },
      {
        walletId: "628123@example.whatsapp.net:USD",
        currency: "USD",
        openingBalanceMinor: 50_000n,
        expenseTotalMinor: 0n,
        currentBalanceMinor: 50_000n,
      },
    ]);
  });

  it("rejects invalid expense amounts and currencies", async () => {
    const service = new LedgerService(new InMemoryLedgerRepository());
    const input = {
      userWhatsAppId: "628123@example.whatsapp.net",
      sourceMessageId: "message-002",
      walletCurrency: "idr",
      description: "Lunch",
      categoryName: "Food",
      amountMinor: 0n,
      occurredAt: new Date(),
    };

    await expect(service.recordExpense(input)).rejects.toThrow("Expense amount");
    await expect(service.recordExpense({ ...input, amountMinor: 1n })).rejects.toThrow("ISO 4217");
  });

  it("deletes a wallet and its transactions, and rejects deleting a wallet that doesn't exist", async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const userWhatsAppId = "628123@example.whatsapp.net";

    await service.setOpeningBalance(userWhatsAppId, "IDR", 100_000n);
    await service.recordExpense({
      userWhatsAppId,
      sourceMessageId: "message-001",
      walletCurrency: "IDR",
      description: "Lunch",
      categoryName: "Food",
      amountMinor: 45_000n,
      occurredAt: new Date("2026-07-23T12:00:00Z"),
    });

    await service.deleteWallet(userWhatsAppId, "IDR");

    expect(await service.getBalances(userWhatsAppId)).toEqual([]);
    await expect(service.deleteWallet(userWhatsAppId, "IDR")).rejects.toThrow("No IDR wallet");
  });

  it("returns transactions within range for the monthly report and rejects an unknown wallet", async () => {
    const repository = new InMemoryLedgerRepository();
    const service = new LedgerService(repository);
    const userWhatsAppId = "628123@example.whatsapp.net";

    await service.addFunds(userWhatsAppId, "IDR", 200_000n, "message-001");
    await service.recordExpense({
      userWhatsAppId,
      sourceMessageId: "message-002",
      walletCurrency: "IDR",
      description: "Lunch",
      categoryName: "Food",
      amountMinor: 45_000n,
      occurredAt: new Date("2026-07-15T12:00:00Z"),
    });
    await service.recordExpense({
      userWhatsAppId,
      sourceMessageId: "message-003",
      walletCurrency: "IDR",
      description: "Next month",
      categoryName: "Food",
      amountMinor: 10_000n,
      occurredAt: new Date("2026-08-01T00:00:00Z"),
    });

    const { wallet, transactions } = await service.getMonthlyReportData(
      userWhatsAppId,
      "IDR",
      new Date("2026-07-01T00:00:00Z"),
      new Date("2026-07-31T23:59:59Z"),
    );

    expect(wallet.currentBalanceMinor).toBe(145_000n);
    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.transactionType).sort()).toEqual(["expense", "income"]);

    await expect(
      service.getMonthlyReportData(userWhatsAppId, "USD", new Date(), new Date()),
    ).rejects.toThrow("No USD wallet");
  });
});