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

export type Button = { text: string; data: string };
export type SendOptions = {
  // Rows of inline buttons under the message.
  buttons?: Button[][];
  // Makes part of the text a link (offset and length in UTF-16 units, as Telegram counts).
  link?: { offset: number; length: number; url: string };
  replyTo?: number;
  // Opens the reply box under this message, so the owner's answer is a reply to it.
  forceReply?: boolean;
};

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

  // Sends a message and returns its id, needed later to edit it or match replies to it.
  async send(chatId: string, text: string, options: SendOptions = {}): Promise<number> {
    const { buttons, link, replyTo, forceReply } = options;
    const sent = await this.api.sendMessage(chatId, text, {
      ...(forceReply && { reply_markup: { force_reply: true } }),
      ...(buttons && {
        reply_markup: {
          inline_keyboard: buttons.map((row) =>
            row.map((b) => ({ text: b.text, callback_data: b.data })),
          ),
        },
      }),
      ...(link && {
        entities: [{ type: "text_link", offset: link.offset, length: link.length, url: link.url }],
      }),
      ...(replyTo !== undefined && {
        reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
      }),
    });
    return sent.message_id;
  }

  // The bot's own @username, for t.me invite links. Asked once, then remembered.
  private username: string | undefined;
  async botUsername(): Promise<string> {
    this.username ??= (await this.api.getMe()).username;
    return this.username;
  }

  // A link that opens a chat with this user, or null if none would work. A username link
  // (t.me) opens for anyone. Without a username, tg://user?id links open only if the user's
  // privacy allows it (has_private_forwards unset). Works for anyone who wrote to the bot.
  async profileUrl(userId: string): Promise<string | null> {
    const chat = await this.api.getChat(userId);
    if (chat.type !== "private") return null;
    if (chat.username) return `https://t.me/${chat.username}`;
    return chat.has_private_forwards ? null : `tg://user?id=${userId}`;
  }

  // Replaces a message's text and buttons (no buttons: they disappear).
  async edit(chatId: string, messageId: number, text: string, buttons?: Button[][]): Promise<void> {
    await this.api.editMessageText(chatId, messageId, text, {
      reply_markup: {
        inline_keyboard: (buttons ?? []).map((row) =>
          row.map((b) => ({ text: b.text, callback_data: b.data })),
        ),
      },
    });
  }

  // The command menu shown in one chat only (owners see their commands, PMs see none).
  async setChatCommands(
    chatId: string,
    commands: readonly { command: string; description: string }[],
  ): Promise<void> {
    await this.api.setMyCommands([...commands], {
      scope: { type: "chat", chat_id: Number(chatId) },
    });
  }

  // Stops the loading spinner on a tapped button and shows a short notice.
  async answerButton(callbackQueryId: string, text: string): Promise<void> {
    await this.api.answerCallbackQuery(callbackQueryId, { text });
  }

  // Copies a message (voice, photo, file) from one chat to another, without a "forwarded"
  // link. The owner gets the PM's original exactly as sent.
  async copy(toChatId: string, fromChatId: string, messageId: number): Promise<number> {
    const copied = await this.api.copyMessage(toChatId, fromChatId, messageId);
    return copied.message_id;
  }

  // Deletes the bot's own messages in a chat. Telegram allows it only within 48 hours of
  // sending, at most 100 ids per call.
  async deleteMessages(chatId: string, messageIds: number[]): Promise<void> {
    for (let i = 0; i < messageIds.length; i += 100) {
      await this.api.deleteMessages(chatId, messageIds.slice(i, i + 100));
    }
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
