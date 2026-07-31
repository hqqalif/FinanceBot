import "dotenv/config";
import { Pool } from "pg";
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import { CommandRouter } from "./domain/commands/CommandRouter.js";
import { LedgerService } from "./domain/ledger/LedgerService.js";
import { PostgresLedgerRepository } from "./infrastructure/postgres/PostgresLedgerRepository.js";
import { GoogleSheetsReportService } from "./infrastructure/google/GoogleSheetsReportService.js";
import { BaileysProvider } from "./providers/whatsapp/BaileysProvider.js";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set before starting the bot.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});
pool.on("error", (err) => logger.error({ err }, "Unexpected idle client error"));
const ledger = new LedgerService(new PostgresLedgerRepository(pool));

// /report only works once a Google service account key is configured via
// GOOGLE_APPLICATION_CREDENTIALS (see README). Without it, /report replies
// with a friendly "not configured" message instead of crashing.
const googleCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const googleDriveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

const tokenExists = fs.existsSync(path.join(process.cwd(), "token.json"));

const reportService = tokenExists
  ? new GoogleSheetsReportService(process.env.GOOGLE_DRIVE_FOLDER_ID)
  : undefined;

if (!reportService) {
  logger.warn("token.json not found — run 'npx tsx generate-token.ts' to enable the /report command.");
}

const whatsapp = new BaileysProvider(process.env.BAILEYS_AUTH_DIRECTORY ?? "data/baileys-auth");
const commandRouter = new CommandRouter(ledger, reportService, (to, text) => whatsapp.sendText(to, text));

whatsapp.onTextMessage(async (message) => {
  const response = await commandRouter.handle(message);
  await whatsapp.sendText(message.senderId, response);
});

await whatsapp.start();

logger.info("FinanceBot started");