import { parseSpendingCommand, SpendingCommandError } from "./parseSpendingCommand.js";
import { LedgerValidationError } from "../ledger/LedgerService.js";
import type { LedgerService } from "../ledger/LedgerService.js";
import type { WalletBalance } from "../ledger/LedgerRepository.js";
import { formatAmountMinor } from "../money/formatAmountMinor.js";
import { buildMonthlyReport } from "../reporting/MonthlyReportBuilder.js";
import type { MonthlyReportService } from "../reporting/MonthlyReportService.js";
import type { IncomingTextMessage } from "../../providers/whatsapp/WhatsAppProvider.js";

const OPENING_PATTERN = /^\/open\s+(?<amount>[\d.,]+)\s+(?<currency>[A-Za-z]{3})$/;
const ADD_PATTERN = /^\/add\s+(?<amount>[\d.,]+)\s+(?<currency>[A-Za-z]{3})$/;
const BALANCE_PATTERN = /^\/balance$/;
const HELP_PATTERN = /^\/halo$/;
const DELETE_PATTERN = /^\/delete\s+(?<currency>[A-Za-z]{3})$/;
const CONFIRM_DELETE_PATTERN = /^CONFIRM DELETE\s+(?<currency>[A-Za-z]{3})$/i;
const REPORT_PATTERN = /^\/report(?:\s+(?<period>\d{2}-\d{4}))?(?:\s+(?<currency>[A-Za-z]{3}))?$/;
const PERIOD_LABEL_PATTERN = /^(?<month>\d{2})-(?<year>\d{4})$/;

const ZERO_DECIMAL_CURRENCIES = new Set(["IDR", "JPY", "KRW", "VND", "CLP"]);
const DELETE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;

type PendingWalletDeletion = { currency: string; expiresAt: number };

export class CommandRouter {
  private readonly pendingWalletDeletions = new Map<string, PendingWalletDeletion>();

  public constructor(
    private readonly ledger: LedgerService,
    private readonly reportService?: MonthlyReportService,
    private readonly notify?: (userWhatsAppId: string, text: string) => Promise<void>,
  ) {}

  public async handle(message: IncomingTextMessage): Promise<string> {
    const text = message.text.trim();

    if (HELP_PATTERN.test(text)) return this.helpText();
    if (BALANCE_PATTERN.test(text)) return this.formatBalances(await this.ledger.getBalances(message.senderId));

    const openingMatch = OPENING_PATTERN.exec(text);
    if (openingMatch?.groups) return this.setOpeningBalance(message.senderId, openingMatch.groups);

    const addMatch = ADD_PATTERN.exec(text);
    if (addMatch?.groups) return this.addFunds(message.senderId, addMatch.groups, message.messageId);

    const deleteMatch = DELETE_PATTERN.exec(text);
    if (deleteMatch?.groups) return this.initiateWalletDeletion(message.senderId, deleteMatch.groups);

    const confirmDeleteMatch = CONFIRM_DELETE_PATTERN.exec(text);
    if (confirmDeleteMatch?.groups) return this.confirmWalletDeletion(message.senderId, confirmDeleteMatch.groups);

    const reportMatch = REPORT_PATTERN.exec(text);
    if (reportMatch?.groups) return this.generateMonthlyReport(message.senderId, reportMatch.groups);

    try {
      const balances = await this.ledger.getBalances(message.senderId);
      const spending = parseSpendingCommand(text, {
        resolveCurrency: (explicitCurrency) => this.resolveSpendingCurrency(explicitCurrency, balances),
      });
      const result = await this.ledger.recordExpense({
        userWhatsAppId: message.senderId,
        sourceMessageId: message.messageId,
        walletCurrency: spending.currency,
        description: spending.description,
        categoryName: spending.category,
        amountMinor: spending.amountMinor,
        occurredAt: message.receivedAt,
      });

      return result.created
        ? `Mencatat ${spending.description} di kategori ${spending.category}.`
        : "Data itu sudah tercatat";
    } catch (error) {
      if (error instanceof SpendingCommandError || error instanceof LedgerValidationError) {
        return `${error.message}\n${this.helpText()}`;
      }
      throw error;
    }
  }

  private async setOpeningBalance(
    userWhatsAppId: string,
    groups: Record<string, string>,
  ): Promise<string> {
    const currency = groups.currency.toUpperCase();

    try {
      const amountMinor = parseSpendingCommand(`Opening balance, Setup, ${groups.amount}`, {
        resolveCurrency: () => ({ currency, fractionDigits: this.fractionDigitsFor(currency) }),
      }).amountMinor;
      await this.ledger.setOpeningBalance(userWhatsAppId, currency, amountMinor);
      return `Saldo untuk ${currency} diperbarui.`;
    } catch (error) {
      if (error instanceof SpendingCommandError || error instanceof LedgerValidationError) {
        return `${error.message}\n${this.helpText()}`;
      }
      throw error;
    }
  }

  private async addFunds(
    userWhatsAppId: string,
    groups: Record<string, string>,
    sourceMessageId: string,
  ): Promise<string> {
    const currency = groups.currency.toUpperCase();

    try {
      const amountMinor = parseSpendingCommand(`Add funds, Setup, ${groups.amount}`, {
        resolveCurrency: () => ({ currency, fractionDigits: this.fractionDigitsFor(currency) }),
      }).amountMinor;
      await this.ledger.addFunds(userWhatsAppId, currency, amountMinor, sourceMessageId);
      return `Saldo ${currency} berhasil ditambah.`;
    } catch (error) {
      if (error instanceof SpendingCommandError || error instanceof LedgerValidationError) {
        return `${error.message}\n${this.helpText()}`;
      }
      throw error;
    }
  }

  private async initiateWalletDeletion(
    userWhatsAppId: string,
    groups: Record<string, string>,
  ): Promise<string> {
    const currency = groups.currency.toUpperCase();
    const balances = await this.ledger.getBalances(userWhatsAppId);
    const hasWallet = balances.some((balance) => balance.currency === currency);

    if (!hasWallet) {
      return `❌ Kamu tidak punya wallet aktif untuk ${currency}.`;
    }

    this.pendingWalletDeletions.set(userWhatsAppId, {
      currency,
      expiresAt: Date.now() + DELETE_CONFIRMATION_TTL_MS,
    });

    return (
      `⚠️ *PERINGATAN:* Ini akan menghapus permanen wallet ${currency} kamu beserta SEMUA transaksi terkait.\n` +
      `Balas dengan *"CONFIRM DELETE ${currency}"* untuk melanjutkan.`
    );
  }

  private async confirmWalletDeletion(
    userWhatsAppId: string,
    groups: Record<string, string>,
  ): Promise<string> {
    const currency = groups.currency.toUpperCase();
    const pending = this.pendingWalletDeletions.get(userWhatsAppId);

    if (!pending || pending.currency !== currency || pending.expiresAt < Date.now()) {
      return `Tidak ada penghapusan wallet ${currency} yang menunggu konfirmasi. Kirim "/delete ${currency}" terlebih dahulu.`;
    }

    this.pendingWalletDeletions.delete(userWhatsAppId);

    try {
      await this.ledger.deleteWallet(userWhatsAppId, currency);
      return `🗑️ *Wallet Berhasil Dihapus*\n\nWallet *${currency}* kamu beserta semua catatannya sudah dihapus dari akun.`;
    } catch (error) {
      if (error instanceof LedgerValidationError) {
        return `${error.message}\n${this.helpText()}`;
      }
      throw error;
    }
  }

  private async generateMonthlyReport(
    userWhatsAppId: string,
    groups: Record<string, string>,
  ): Promise<string> {
    if (!this.reportService) {
      return "Fitur laporan bulanan belum aktif. Hubungi admin untuk mengatur kredensial Google.";
    }

    const now = new Date();
    const periodLabel =
      groups.period ?? `${String(now.getUTCMonth() + 1).padStart(2, "0")}-${now.getUTCFullYear()}`;
    const periodMatch = PERIOD_LABEL_PATTERN.exec(periodLabel);

    if (!periodMatch?.groups) {
      return `Format bulan tidak valid. Gunakan MM-YYYY, contoh: 07-2026.\n${this.helpText()}`;
    }

    const month = Number(periodMatch.groups.month);
    const year = Number(periodMatch.groups.year);

    if (month < 1 || month > 12) {
      return `Bulan harus antara 01 dan 12.\n${this.helpText()}`;
    }

    const periodStart = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    try {
      const balances = await this.ledger.getBalances(userWhatsAppId);
      const currency = this.resolveReportCurrency(groups.currency?.toUpperCase(), balances);

      await this.notify?.(userWhatsAppId, "⏳ Sedang membuat laporan keuangan bulanan kamu...");

      const { wallet, transactions } = await this.ledger.getMonthlyReportData(
        userWhatsAppId,
        currency,
        periodStart,
        periodEnd,
      );
      const reportData = buildMonthlyReport({
        currency,
        fractionDigits: this.fractionDigitsFor(currency),
        periodLabel,
        wallet,
        transactions,
      });
      const spreadsheetUrl = await this.reportService.generateReport(reportData);

      return `📊 Laporan ${currency} bulan ${periodLabel} sudah siap:\n${spreadsheetUrl}`;
    } catch (error) {
      if (error instanceof LedgerValidationError) {
        return `${error.message}\n${this.helpText()}`;
      }
      throw error;
    }
  }

  private resolveReportCurrency(explicitCurrency: string | undefined, balances: WalletBalance[]): string {
    if (explicitCurrency) return explicitCurrency;

    if (balances.length === 1) return balances[0].currency;

    if (balances.length === 0) {
      throw new LedgerValidationError(
        'Belum ada saldo. Kirim "/open amount (mata uang disingkat, seperti IDR, AUD, SGD)" dulu.',
      );
    }

    throw new LedgerValidationError(
      "Kamu punya beberapa mata uang. Tentukan mata uang: /report MM-YYYY CURRENCY",
    );
  }

  private resolveSpendingCurrency(
    explicitCurrency: string | undefined,
    balances: WalletBalance[],
  ): { currency: string; fractionDigits: number } {
    if (explicitCurrency) {
      return { currency: explicitCurrency, fractionDigits: this.fractionDigitsFor(explicitCurrency) };
    }

    if (balances.length === 1) {
      const currency = balances[0].currency;
      return { currency, fractionDigits: this.fractionDigitsFor(currency) };
    }

    if (balances.length === 0) {
      throw new SpendingCommandError(
        'Belum ada saldo. Kirim "/opening amount (mata uang disingkat, seperti IDR, AUD, SGD)"',
      );
    }

    throw new SpendingCommandError(
      "Kamu punya beberapa mata uang. Template baru: nama, kategori, harga, mata uang",
    );
  }

  private fractionDigitsFor(currency: string): number {
    return ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
  }

  private formatBalances(balances: WalletBalance[]): string {
    if (balances.length === 0) {
      return 'Belum ada saldo. Kirim "/opening amount (mata uang disingkat, seperti IDR, AUD, SGD)"';
    }

    return balances
      .map(
        (balance) =>
          `${balance.currency}: ${formatAmountMinor(balance.currentBalanceMinor, this.fractionDigitsFor(balance.currency))}`,
      )
      .join("\n");
  }

  private helpText(): string {
    return "Hai, ini adalah command yang bisa digunakan:\n\n" +
        "* *Membuka saldo pertama kali*\n  `/open (jumlah) (mata uang)`\n\n" +
        "* *Menambah saldo*\n  `/add (jumlah) (mata uang)`\n\n" +
        "* *Catat pengeluaran*\n  `nama pengeluaran, kategori, harga, mata uang`\n\n" +
        "* *Cek saldo*\n  `/balance`\n\n" +
        "* *Laporan bulanan (Google Sheets)*\n  `/report [MM-YYYY] [mata uang]`\n\n" +
        "* *Hapus wallet*\n  `/delete (mata uang)` lalu balas `CONFIRM DELETE (mata uang)`";
  }
}
