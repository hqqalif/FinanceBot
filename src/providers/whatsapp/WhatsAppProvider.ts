export type IncomingTextMessage = {
  messageId: string;
  senderId: string;
  text: string;
  receivedAt: Date;
};

export interface WhatsAppProvider {
  onTextMessage(handler: (message: IncomingTextMessage) => Promise<void>): void;
  sendText(recipientId: string, text: string): Promise<void>;
}