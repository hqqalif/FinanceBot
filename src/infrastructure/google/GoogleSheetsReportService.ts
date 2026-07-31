import { google, type sheets_v4 } from "googleapis";
import fs from "node:fs/promises";
import path from "node:path";

import type { MonthlyReportService } from "../../domain/reporting/MonthlyReportService.js";
import type { MonthlyReportData } from "../../domain/reporting/MonthlyReportBuilder.js";

/**
 * Builds a Google Sheets monthly report using OAuth 2.0 User Credentials.
 * Generates standalone spreadsheets directly inside your personal Google Drive.
 */
export class GoogleSheetsReportService implements MonthlyReportService {
  private readonly targetFolderId?: string;

  constructor(targetFolderId?: string) {
    this.targetFolderId = targetFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID;
  }

  /**
   * Helper to load OAuth credentials and saved user token
   */
  private async getAuthClient() {
    const oauthPath = path.join(process.cwd(), "oauth-credentials.json");
    const tokenPath = path.join(process.cwd(), "token.json");

    const oauthKeys = JSON.parse(await fs.readFile(oauthPath, "utf8"));
    const tokens = JSON.parse(await fs.readFile(tokenPath, "utf8"));

    const { client_id, client_secret } = oauthKeys.installed || oauthKeys.web;

    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
    oAuth2Client.setCredentials(tokens);

    return oAuth2Client;
  }

  public async generateReport(report: MonthlyReportData): Promise<string> {
    const authClient = await this.getAuthClient();
    const sheets = google.sheets({ version: "v4", auth: authClient as never });
    const drive = google.drive({ version: "v3", auth: authClient as never });

    const title = `FinanceBot Report - ${report.currency} - ${report.periodLabel}`;

    const createRequestBody: Record<string, unknown> = {
      name: title,
      mimeType: "application/vnd.google-apps.spreadsheet",
    };

    if (this.targetFolderId) {
      createRequestBody.parents = [this.targetFolderId];
    }

    const createResponse = await drive.files.create({
      requestBody: createRequestBody,
      fields: "id",
    });

    const spreadsheetId = createResponse.data.id;
    if (!spreadsheetId) {
      throw new Error("Google Drive API did not return a spreadsheet id.");
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          { updateSheetProperties: { properties: { sheetId: 0, title: "Report" }, fields: "title" } },
        ],
      },
    });

    const { rows, layout } = buildRows(report);

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Report!A1",
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });

    const formattingRequests = buildFormattingRequests(0, layout, report);

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: formattingRequests,
      },
    });

    await drive.permissions.create({
      fileId: spreadsheetId,
      requestBody: { role: "reader", type: "anyone" },
    });

    return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  }
}

function buildRows(report: MonthlyReportData) {
  const rows: unknown[][] = [];
  const layout: any = {};

  // 1. Title
  rows.push([`FinanceBot Report - ${report.currency} - ${report.periodLabel}`]);
  layout.titleRow = 0;

  // 2. Detail Transaksi
  layout.txHeader = rows.length;
  rows.push(["Detail Transaksi"]);
  rows.push(["Tanggal", "Kategori", "Deskripsi", "Jumlah", "Mata Uang", "Tipe"]);
  layout.txDataStart = rows.length;
  for (const row of report.detailedLedger) {
    rows.push([row.date, row.category, row.description, row.amount, row.currency, row.transactionType]);
  }
  layout.txDataEnd = rows.length;
  rows.push([]);

  // 3. Rangkuman Pengeluaran Harian
  layout.dailyHeader = rows.length;
  rows.push(["Rangkuman Pengeluaran Harian"]);
  rows.push(["Tanggal", "Pengeluaran", "Kategori Tertinggi", "Frekuensi"]);
  layout.dailyDataStart = rows.length;
  for (const row of report.dailySummary) {
    rows.push([row.date, row.totalSpent, row.topCategory, row.count]);
  }
  layout.dailyDataEnd = rows.length;
  rows.push([]);

  // 4. Rincian Kategori
  layout.catHeader = rows.length;
  rows.push(["Rincian Kategori"]);
  rows.push(["Kategori", "Jumlah Mutasi", "% dari Total"]);
  layout.catDataStart = rows.length;
  for (const row of report.categoryBreakdown) {
    rows.push([row.category, row.totalAmount, Number(row.percentOfTotal.toFixed(1))]);
  }
  layout.catDataEnd = rows.length;
  rows.push([]);

  // 5. Rangkuman Saldo
  layout.saldoHeader = rows.length;
  rows.push(["Rangkuman Saldo"]);
  layout.saldoDataStart = rows.length;
  rows.push(["Total Pemasukan", report.totalIncome]);
  rows.push(["Total Pengeluaran", report.totalExpenses]);
  rows.push(["Saldo Saat Ini", report.currentWalletBalance]);
  layout.saldoDataEnd = rows.length;

  return { rows, layout };
}

function buildFormattingRequests(sheetId: number, layout: any, report: MonthlyReportData): sheets_v4.Schema$Request[] {
  const requests: sheets_v4.Schema$Request[] = [];

  const greenBg = { red: 0.71, green: 0.84, blue: 0.65 };
  const grayBg = { red: 0.85, green: 0.85, blue: 0.85 };
  const blackBorder = { style: "SOLID", color: { red: 0, green: 0, blue: 0 } };

  // Helper for applying borders and centering
  const formatTable = (startRow: number, endRow: number, numCols: number) => {
    requests.push({
      updateBorders: {
        range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: 0, endColumnIndex: numCols },
        top: blackBorder, bottom: blackBorder, left: blackBorder, right: blackBorder, innerHorizontal: blackBorder, innerVertical: blackBorder
      }
    });
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: startRow, endRowIndex: endRow, startColumnIndex: 0, endColumnIndex: numCols },
        cell: { userEnteredFormat: { horizontalAlignment: "CENTER", verticalAlignment: "MIDDLE" } },
        fields: "userEnteredFormat(horizontalAlignment,verticalAlignment)"
      }
    });
  };

  // Helper for cell merging
  const mergeCells = (row: number, numCols: number) => {
    requests.push({
      mergeCells: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: numCols },
        mergeType: "MERGE_ALL"
      }
    });
  };

  // Helper for background & bold styling
  const styleRow = (row: number, numCols: number, bgColor: any) => {
    requests.push({
      repeatCell: {
        range: { sheetId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: numCols },
        cell: { userEnteredFormat: { backgroundColor: bgColor, textFormat: { bold: true } } },
        fields: "userEnteredFormat(backgroundColor,textFormat.bold)"
      }
    });
  };

  // 1. Column Width Modifications (100px for Column A and Column C)
  requests.push(
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, // Column A
        properties: { pixelSize: 150 },
        fields: "pixelSize"
      }
    },
    {
      updateDimensionProperties: {
        range: { sheetId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, // Column C
        properties: { pixelSize: 150 },
        fields: "pixelSize"
      }
    }
  );

  // 2. Title Row Formatting (Green)
  mergeCells(layout.titleRow, 6);
  styleRow(layout.titleRow, 6, greenBg);

  // 3. Table Formats (Borders & Centering)
  formatTable(layout.titleRow, layout.txDataEnd, 6);
  formatTable(layout.dailyHeader, layout.dailyDataEnd, 4);
  formatTable(layout.catHeader, layout.catDataEnd, 3);
  formatTable(layout.saldoHeader, layout.saldoDataEnd, 2);

  // 4. Sub-headers Merging
  mergeCells(layout.txHeader, 6);
  mergeCells(layout.dailyHeader, 4);
  mergeCells(layout.catHeader, 3);
  mergeCells(layout.saldoHeader, 2);

  // 5. Sub-headers Backgrounds (Gray) & Bold
  styleRow(layout.txHeader, 6, grayBg);
  styleRow(layout.txHeader + 1, 6, grayBg);
  
  styleRow(layout.dailyHeader, 4, grayBg);
  styleRow(layout.dailyHeader + 1, 4, grayBg);
  
  styleRow(layout.catHeader, 3, grayBg);
  styleRow(layout.catHeader + 1, 3, grayBg);
  
  styleRow(layout.saldoHeader, 2, grayBg);

  // 6. Pie Chart (3D)
  requests.push({
    addChart: {
      chart: {
        position: { overlayPosition: { anchorCell: { sheetId, rowIndex: 1, columnIndex: 7 }, widthPixels: 400, heightPixels: 210 } },
        spec: {
          title: `${report.currency} Pengeluaran Berdasarkan Kategori`,
          pieChart: {
            legendPosition: "RIGHT_LEGEND",
            threeDimensional: true,
            domain: {
              sourceRange: {
                sources: [{ sheetId, startRowIndex: layout.catDataStart, endRowIndex: layout.catDataEnd, startColumnIndex: 0, endColumnIndex: 1 }]
              }
            },
            series: {
              sourceRange: {
                sources: [{ sheetId, startRowIndex: layout.catDataStart, endRowIndex: layout.catDataEnd, startColumnIndex: 1, endColumnIndex: 2 }]
              }
            }
          }
        }
      }
    }
  });

  // 7. Column Chart (Data Labels)
  requests.push({
    addChart: {
      chart: {
        position: { overlayPosition: { anchorCell: { sheetId, rowIndex: 13, columnIndex: 7 }, widthPixels: 400, heightPixels: 210 } },
        spec: {
          title: `${report.currency} Pengeluaran Harian`,
          basicChart: {
            chartType: "COLUMN",
            legendPosition: "NO_LEGEND", 
            domains: [{
              domain: {
                sourceRange: {
                  sources: [{ sheetId, startRowIndex: layout.dailyDataStart, endRowIndex: layout.dailyDataEnd, startColumnIndex: 0, endColumnIndex: 1 }]
                }
              }
            }],
            series: [{
              series: {
                sourceRange: {
                  sources: [{ sheetId, startRowIndex: layout.dailyDataStart, endRowIndex: layout.dailyDataEnd, startColumnIndex: 1, endColumnIndex: 2 }]
                }
              },
              dataLabel: {
                type: "DATA",
                textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 } }
              }
            }]
          }
        }
      }
    }
  });

  return requests;
}