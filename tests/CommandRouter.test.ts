import { describe, expect, it, vi } from "vitest";

import { CommandRouter } from "../src/domain/commands/CommandRouter.js";
import { InMemoryLedgerRepository } from "../src/domain/ledger/InMemoryLedgerRepository.js";
import { LedgerService } from "../src/domain/ledger/LedgerService.js";
import type { MonthlyReportService } from "../src/domain/reporting/MonthlyReportService.js";

const message = (text: string, messageId = "message-001") => ({
  messageId,
  senderId: "628123@example.whatsapp.net",
  text,
  receivedAt: new Date("2026-07-23T12:00:00Z"),
});

describe("CommandRouter", () => {
  it("records an IDR spending message and reports the balance", async () => {
    const router = new CommandRouter(new LedgerService(new InMemoryLedgerRepository()));

    await expect(router.handle(message("/open 100000 IDR"))).resolves.toBe(
      "Saldo untuk IDR diperbarui.",
    );
    await expect(router.handle(message("Lunch, Food, 45000", "message-002"))).resolves.toBe(
      "Mencatat Lunch di kategori Food.",
    );
    await expect(router.handle(message("/balance", "message-003"))).resolves.toBe("IDR: 55000");
  });

  it("adds funds to an existing wallet", async () => {
    const router = new CommandRouter(new LedgerService(new InMemoryLedgerRepository()));

    await router.handle(message("/open 100000 IDR", "message-001"));
    await expect(router.handle(message("/add 50000 IDR", "message-002"))).resolves.toBe(
      "Saldo IDR berhasil ditambah.",
    );
    await expect(router.handle(message("/balance", "message-003"))).resolves.toBe("IDR: 150000");
  });

  it("does not double-add funds when the same WhatsApp message is replayed", async () => {
    const router = new CommandRouter(new LedgerService(new InMemoryLedgerRepository()));

    await router.handle(message("/open 100000 IDR", "message-001"));
    await router.handle(message("/add 50000 IDR", "message-002"));
    await router.handle(message("/add 50000 IDR", "message-002"));

    await expect(router.handle(message("/balance", "message-003"))).resolves.toBe("IDR: 150000");
  });

  it("returns a useful response for invalid spending input", async () => {
    const router = new CommandRouter(new LedgerService(new InMemoryLedgerRepository()));

    await expect(router.handle(message("Lunch, Food", "message-004"))).resolves.toContain(
      "Template utama catat pengeluaran",
    );
  });

  it("requires a currency when no wallet has been opened yet", async () => {
    const router = new CommandRouter(new LedgerService(new InMemoryLedgerRepository()));

    await expect(router.handle(message("Lunch, Food, 45000", "message-005"))).resolves.toContain(
      "Belum ada saldo.",
    );
  });

  it("requires a currency when multiple wallets exist", async () => {
    const router = new CommandRouter(new LedgerService(new InMemoryLedgerRepository()));

    await router.handle(message("/open 100000 IDR", "message-006"));
    await router.handle(message("/open 100 AUD", "message-007"));

    await expect(router.handle(message("Lunch, Food, 45000", "message-008"))).resolves.toContain(
      "beberapa mata uang",
    );
    await expect(
      router.handle(message("Lunch, Food, 45000, IDR", "message-009")),
    ).resolves.toBe("Mencatat Lunch di kategori Food.");
  });

  describe("/delete wallet flow", () => {
    it("rejects deletion for a currency with no active wallet", async () => {
      const router = new CommandRouter(new LedgerService(new InMemoryLedgerRepository()));

      await expect(router.handle(message("/delete AUD"))).resolves.toContain(
        "tidak punya wallet aktif untuk AUD",
      );
    });

    it("requires exact confirmation before deleting a wallet", async () => {
      const router = new CommandRouter(new LedgerService(new InMemoryLedgerRepository()));

      await router.handle(message("/open 100000 IDR", "message-001"));
      await expect(router.handle(message("/delete IDR", "message-002"))).resolves.toContain(
        "CONFIRM DELETE IDR",
      );

      // Wrong currency confirmation shouldn't delete anything.
      await expect(router.handle(message("CONFIRM DELETE AUD", "message-003"))).resolves.toContain(
        "Tidak ada penghapusan wallet",
      );
      await expect(router.handle(message("/balance", "message-004"))).resolves.toBe("IDR: 100000");

      await expect(router.handle(message("CONFIRM DELETE IDR", "message-005"))).resolves.toContain(
        "Wallet Berhasil Dihapus",
      );
      await expect(router.handle(message("/balance", "message-006"))).resolves.toBe(
        'Belum ada saldo. Kirim "/opening amount (mata uang disingkat, seperti IDR, AUD, SGD)"',
      );
    });
  });

  describe("/report", () => {
    it("tells the user the feature is disabled when no report service is configured", async () => {
      const router = new CommandRouter(new LedgerService(new InMemoryLedgerRepository()));

      await router.handle(message("/open 100000 IDR", "message-001"));
      await expect(router.handle(message("/report", "message-002"))).resolves.toContain(
        "belum aktif",
      );
    });

    it("acknowledges immediately and returns a spreadsheet link", async () => {
      const fakeReportService: MonthlyReportService = {
        generateReport: vi.fn().mockResolvedValue("https://docs.google.com/spreadsheets/d/fake/edit"),
      };
      const notify = vi.fn().mockResolvedValue(undefined);
      const router = new CommandRouter(
        new LedgerService(new InMemoryLedgerRepository()),
        fakeReportService,
        notify,
      );

      await router.handle(message("/open 100000 IDR", "message-001"));
      await router.handle(message("Lunch, Food, 45000, IDR", "message-002"));

      await expect(router.handle(message("/report 07-2026", "message-003"))).resolves.toBe(
        "📊 Laporan IDR bulan 07-2026 sudah siap:\nhttps://docs.google.com/spreadsheets/d/fake/edit",
      );
      expect(notify).toHaveBeenCalledWith(
        "628123@example.whatsapp.net",
        "⏳ Sedang membuat laporan keuangan bulanan kamu...",
      );
      expect(fakeReportService.generateReport).toHaveBeenCalledOnce();
    });
  });
});