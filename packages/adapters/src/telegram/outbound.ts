import { Api } from "grammy";

// Our stored Telegram id is '<chat_id>:<message_id>' (see inbound.ts).
export function parseTelegramMessageId(externalMessageId: string): {
  chatId: string;
  messageId: number;
} {
  const [chatId, messageId] = externalMessageId.split(":");
  if (!chatId || !messageId || !/^-?\d+$/.test(chatId) || !/^\d+$/.test(messageId)) {
    throw new Error("not a Telegram external message id");
  }
  return { chatId, messageId: Number(messageId) };
}

export type DownloadedFile = { bytes: Uint8Array; extension: string | null };

// Sending and downloading through the Telegram Bot API. Never log or rethrow anything that
// contains the token: the file download URL embeds it.
export class TelegramClient {
  private readonly api: Api;
  private readonly token: string;
  private readonly apiRoot: string;

  // apiRoot is overridable so the local end-to-end check can use a fake Telegram.
  constructor(token: string, apiRoot = "https://api.telegram.org") {
    this.token = token;
    this.apiRoot = apiRoot;
    this.api = new Api(token, { apiRoot });
  }

  async reply(chatId: string, text: string, replyToMessageId?: number): Promise<void> {
    await this.api.sendMessage(chatId, text, {
      ...(replyToMessageId !== undefined && {
        reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true },
      }),
    });
  }

  // Telegram guarantees the download link for at least 1 hour; bots can fetch up to 20 MB.
  async download(fileId: string): Promise<DownloadedFile> {
    const file = await this.api.getFile(fileId);
    if (!file.file_path) throw new Error("telegram file has no download path");

    const url = `${this.apiRoot}/file/bot${this.token}/${file.file_path}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new Error("telegram file download failed: network error or timeout");
    }
    if (!res.ok) throw new Error(`telegram file download failed: HTTP ${res.status}`);

    const dot = file.file_path.lastIndexOf(".");
    const extension = dot > -1 ? file.file_path.slice(dot + 1).toLowerCase() : null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), extension };
  }
}
