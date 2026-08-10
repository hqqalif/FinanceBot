import crypto from "node:crypto";
import pino from "pino";

import type { IncomingTextMessage, WhatsAppProvider } from "./WhatsAppProvider.js";

const DEFAULT_GRAPH_API_VERSION = "v21.0";

type CloudApiTextMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
};

type CloudApiWebhookPayload = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        messages?: CloudApiTextMessage[];
      };
    }>;
  }>;
};

export type CloudApiProviderOptions = {
  accessToken: string;
  phoneNumberId: string;
  webhookVerifyToken: string;
  /** Meta App Secret, used to verify the `X-Hub-Signature-256` header on incoming webhooks. */
  appSecret: string;
  graphApiVersion?: string;
};

/**
 * WhatsAppProvider implementation backed by Meta's official WhatsApp Cloud API.
 *
 * Unlike Baileys (a persistent socket connection), the Cloud API is entirely
 * HTTP-based: outgoing messages are sent via REST calls to the Graph API, and
 * incoming messages arrive as webhook POST requests that Meta sends to a
 * publicly reachable HTTPS endpoint we expose. See `main.ts` for the HTTP
 * server that forwards webhook requests into `handleWebhookVerification` /
 * `handleWebhookEvent`.
 */
export class CloudApiProvider implements WhatsAppProvider {
  private readonly logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
  private readonly graphApiVersion: string;
  private textHandler: ((message: IncomingTextMessage) => Promise<void>) | undefined;

  public constructor(private readonly options: CloudApiProviderOptions) {
    this.graphApiVersion = options.graphApiVersion ?? DEFAULT_GRAPH_API_VERSION;
  }

  public onTextMessage(handler: (message: IncomingTextMessage) => Promise<void>): void {
    this.textHandler = handler;
  }

  public async sendText(recipientId: string, text: string): Promise<void> {
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${this.options.phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientId,
        type: "text",
        text: { body: text },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "<unreadable body>");
      this.logger.error({ status: response.status, body }, "Failed to send WhatsApp Cloud API message");
      throw new Error(`WhatsApp Cloud API send failed with status ${response.status}`);
    }
  }

  /**
   * Handles Meta's one-time GET verification request when the webhook is
   * registered/updated in the App Dashboard.
   * https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
   */
  public handleWebhookVerification(query: URLSearchParams): { status: number; body: string } {
    const mode = query.get("hub.mode");
    const token = query.get("hub.verify_token");
    const challenge = query.get("hub.challenge");

    if (mode === "subscribe" && token === this.options.webhookVerifyToken && challenge) {
      return { status: 200, body: challenge };
    }

    this.logger.warn("Rejected WhatsApp webhook verification request");
    return { status: 403, body: "Forbidden" };
  }

  /**
   * Handles incoming webhook POST events (new messages, delivery/read
   * statuses, etc.). Only text messages are forwarded to the registered
   * handler; other event types (status updates, media, reactions, ...) are
   * ignored for now.
   *
   * `rawBody` MUST be the unparsed request body bytes - the HMAC signature
   * is computed over the exact bytes Meta sent, not a re-serialized JSON copy.
   */
  public async handleWebhookEvent(rawBody: Buffer): Promise<void> {
    let payload: CloudApiWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch (error) {
      this.logger.error({ err: error }, "Failed to parse WhatsApp webhook payload");
      return;
    }

    if (payload.object !== "whatsapp_business_account") return;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;

        for (const message of change.value?.messages ?? []) {
          if (message.type !== "text" || !message.text?.body) continue;

          try {
            await this.textHandler?.({
              messageId: message.id,
              senderId: message.from,
              text: message.text.body,
              receivedAt: new Date(Number(message.timestamp) * 1000),
            });
          } catch (error) {
            this.logger.error({ err: error, messageId: message.id }, "Unable to handle WhatsApp text message");
            await this.sendText(
              message.from,
              "Terjadi kesalahan saat memproses pesanmu. Coba lagi nanti atau hubungi admin.",
            );
          }
        }
      }
    }
  }

  /**
   * Verifies the `X-Hub-Signature-256` header Meta attaches to every
   * webhook POST request, proving the request genuinely came from Meta and
   * wasn't spoofed/tampered with in transit.
   */
  public verifySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader?.startsWith("sha256=")) return false;

    const expectedSignature = crypto
      .createHmac("sha256", this.options.appSecret)
      .update(rawBody)
      .digest("hex");
    const providedSignature = signatureHeader.slice("sha256=".length);

    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const providedBuffer = Buffer.from(providedSignature, "hex");
    if (expectedBuffer.length !== providedBuffer.length) return false;

    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  }
}
