import type { DownloadedFile, StoredMessage, UnroutedMessage } from "@connectus/adapters";

export function storedMessage(overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    id: "msg-1",
    companyId: "company-a",
    channel: "telegram",
    kind: "voice",
    externalMessageId: "1001:57",
    externalFileId: "VOICE-1",
    mediaKey: null,
    receivedAt: new Date("2026-10-07T04:00:00Z"),
    senderRole: "pm",
    ...overrides,
  };
}

export class FakeMessages {
  messages = new Map<string, StoredMessage>();
  unrouted = new Map<string, UnroutedMessage>();

  async find(id: string) {
    return this.messages.get(id) ?? null;
  }
  async setMediaKey(id: string, mediaKey: string) {
    const m = this.messages.get(id);
    if (m && m.mediaKey === null) m.mediaKey = mediaKey;
  }
  async findUnrouted(id: string) {
    return this.unrouted.get(id) ?? null;
  }
}

export class FakeTelegram {
  replies: { chatId: string; text: string; replyTo: number | undefined }[] = [];
  downloads: string[] = [];
  file: DownloadedFile = { bytes: new Uint8Array([1, 2, 3]), extension: "oga" };

  async reply(chatId: string, text: string, replyTo?: number) {
    this.replies.push({ chatId, text, replyTo });
  }
  async send(chatId: string, text: string) {
    this.replies.push({ chatId, text, replyTo: undefined });
    return 1;
  }
  async download(fileId: string) {
    this.downloads.push(fileId);
    return this.file;
  }
}

export class FakeStorage {
  files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  async put(key: string, bytes: Uint8Array, contentType: string) {
    this.files.set(key, { bytes, contentType });
  }
}
