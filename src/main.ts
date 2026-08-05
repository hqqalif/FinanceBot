import "dotenv/config";
import { Pool } from "pg";
import pino from "pino";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { CommandRouter } from "./domain/commands/CommandRouter.js";
import { LedgerService } from "./domain/ledger/LedgerService.js";
import { PostgresLedgerRepository } from "./infrastructure/postgres/PostgresLedgerRepository.js";
import { GoogleSheetsReportService } from "./infrastructure/google/GoogleSheetsReportService.js";
import { CloudApiProvider } from "./providers/whatsapp/CloudApiProvider.js";

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

const accessToken = process.env.WHATSAPP_CLOUD_API_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
const webhookVerifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
const appSecret = process.env.WHATSAPP_APP_SECRET;

if (!accessToken || !phoneNumberId || !webhookVerifyToken || !appSecret) {
  throw new Error(
    "WHATSAPP_CLOUD_API_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_WEBHOOK_VERIFY_TOKEN and WHATSAPP_APP_SECRET must all be set before starting the bot.",
  );
}

const whatsapp = new CloudApiProvider({ accessToken, phoneNumberId, webhookVerifyToken, appSecret });
const commandRouter = new CommandRouter(ledger, reportService, (to, text) => whatsapp.sendText(to, text));

whatsapp.onTextMessage(async (message) => {
  const response = await commandRouter.handle(message);
  await whatsapp.sendText(message.senderId, response);
});

function readRawBody(request: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

const webhookPath = process.env.WHATSAPP_WEBHOOK_PATH ?? "/webhook";
const port = Number(process.env.PORT ?? 3000);

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (url.pathname !== webhookPath) {
    response.writeHead(404).end();
    return;
  }

  if (request.method === "GET") {
    const result = whatsapp.handleWebhookVerification(url.searchParams);
    response.writeHead(result.status, { "Content-Type": "text/plain" }).end(result.body);
    return;
  }

  if (request.method === "POST") {
    void readRawBody(request)
      .then(async (rawBody) => {
        const signatureHeader = request.headers["x-hub-signature-256"] as string | undefined;
        if (!whatsapp.verifySignature(rawBody, signatureHeader)) {
          logger.warn("Rejected WhatsApp webhook event with invalid signature");
          response.writeHead(401).end();
          return;
        }

        // Acknowledge receipt immediately - Meta retries webhooks that don't
        // get a 200 within a few seconds, which could cause duplicate replies.
        response.writeHead(200).end();
        await whatsapp.handleWebhookEvent(rawBody);
      })
      .catch((error) => {
        logger.error({ err: error }, "Failed to process WhatsApp webhook event");
        if (!response.headersSent) response.writeHead(400).end();
      });
    return;
  }

  response.writeHead(405).end();
});

server.listen(port, () => {
  logger.info({ port, webhookPath }, "FinanceBot started");
});