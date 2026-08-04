import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type SignalDataSet,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import pino from "pino";

import type { IncomingTextMessage, WhatsAppProvider } from "./WhatsAppProvider.js";

// `useMultiFileAuthState` stores every auth key in its own JSON file and commits a
// batch of changes with a single `Promise.all(...)`. WhatsApp's initial history sync
// can hand Baileys thousands of LID-PN mappings in one transaction, which tries to
// open thousands of file handles at once and crashes with "EMFILE: too many open
// files". That failed commit makes Baileys restart the app-state sync from scratch
// on every reconnect (the repeating "resyncing regular from v0" / "failed to sync
// regular ... giving up" / "TypeError: fetch failed" log lines). Chunking reads and
// writes keeps the number of concurrently open files bounded so the commit succeeds.
const MAX_CONCURRENT_AUTH_FILE_OPS = 32;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function limitAuthStoreConcurrency(keys: SignalKeyStore): SignalKeyStore {
  return {
    get: async (type, ids) => {
      if (ids.length <= MAX_CONCURRENT_AUTH_FILE_OPS) {
        return keys.get(type, ids);
      }
      const result: Record<string, SignalDataTypeMap[typeof type]> = {};
      for (const idsChunk of chunk(ids, MAX_CONCURRENT_AUTH_FILE_OPS)) {
        Object.assign(result, await keys.get(type, idsChunk));
      }
      return result;
    },
    set: async (data) => {
      const raw = data as Record<string, Record<string, unknown> | null | undefined>;
      const entries: Array<{ category: string; id: string; value: unknown }> = [];
      for (const category of Object.keys(raw)) {
        const values = raw[category];
        if (!values) continue;
        for (const id of Object.keys(values)) {
          entries.push({ category, id, value: values[id] });
        }
      }
      if (entries.length <= MAX_CONCURRENT_AUTH_FILE_OPS) {
        await keys.set(data);
        return;
      }
      for (const entryChunk of chunk(entries, MAX_CONCURRENT_AUTH_FILE_OPS)) {
        const chunkData: Record<string, Record<string, unknown>> = {};
        for (const { category, id, value } of entryChunk) {
          (chunkData[category] ??= {})[id] = value;
        }
        await keys.set(chunkData as SignalDataSet);
      }
    },
  };
}

export class BaileysProvider implements WhatsAppProvider {
  private readonly logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  private socket: WASocket | undefined;
  private textHandler: ((message: IncomingTextMessage) => Promise<void>) | undefined;

  public constructor(private readonly authDirectory: string) {}

  public onTextMessage(handler: (message: IncomingTextMessage) => Promise<void>): void {
    this.textHandler = handler;
  }

  public async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDirectory);
    state.keys = limitAuthStoreConcurrency(state.keys);
    const { version } = await fetchLatestBaileysVersion();
    const socket = makeWASocket({
      auth: state,
      browser: Browsers.windows("FinanceBot"),
      logger: this.logger,
      version,
    });
    this.socket = socket;

    socket.ev.on("creds.update", saveCreds);
    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const message of messages) {
        const messageId = message.key.id;
        const senderId = message.key.remoteJid;
        const text = message.message?.conversation ?? message.message?.extendedTextMessage?.text;

        if (!messageId || !senderId || !text || message.key.fromMe || senderId === "status@broadcast") {
          continue;
        }

        try {
          await this.textHandler?.({
            messageId,
            senderId,
            text,
            receivedAt: new Date(),
          });
        } catch (error) {
          this.logger.error({ err: error, messageId }, "Unable to handle WhatsApp text message");
          await this.sendText(senderId, "Terjadi kesalahan, mohon laporkan ke nomor +6289667851611");
        }
      }
    });

    socket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        qrcode.generate(qr, { small: true });
        this.logger.info("Scan the QR code with WhatsApp to link FinanceBot.");
    }
      if (connection !== "close") return;

      const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
        ?.output?.statusCode;
      if (statusCode === DisconnectReason.loggedOut) {
        this.logger.error("WhatsApp logged out. Remove data/baileys-auth and link the account again.");
        return;
      }

      this.logger.warn({ statusCode }, "WhatsApp disconnected; reconnecting");
      void this.start();
    });
  }

  public async sendText(recipientId: string, text: string): Promise<void> {
    if (!this.socket) throw new Error("WhatsApp socket is not connected.");
    await this.socket.sendMessage(recipientId, { text });
  }
}