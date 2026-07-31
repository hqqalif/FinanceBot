import type { MonthlyReportData } from "./MonthlyReportBuilder.js";

/**
 * Abstraction over "turn aggregated report data into a shareable document
 * and return its URL". CommandRouter depends on this interface, not on
 * GoogleSheetsReportService directly, so it stays testable without any
 * Google API / network calls.
 */
export interface MonthlyReportService {
  generateReport(report: MonthlyReportData): Promise<string>;
}
