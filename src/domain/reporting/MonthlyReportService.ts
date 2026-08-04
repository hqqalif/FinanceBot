import type { MonthlyReportData } from "./MonthlyReportBuilder.js";

/**
 * Abstraction over "turn aggregated report data into a shareable document
 * and return its URL". CommandRouter depends on this interface, not on
 * GoogleSheetsReportService directly, so it stays testable without any
 * Google API / network calls.
 *
 * `reports` may contain more than one month (e.g. a "07-2026 - 08-2026"
 * range request). Implementations are expected to reuse a single persisted
 * spreadsheet per (user, currency) - created once - and add/update one sheet
 * tab per month, rather than creating a brand new spreadsheet every call.
 */
export interface MonthlyReportService {
  generateReport(userWhatsAppId: string, reports: MonthlyReportData[]): Promise<string>;
}
