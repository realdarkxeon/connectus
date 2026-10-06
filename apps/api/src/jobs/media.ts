import {
  contentTypeFor,
  type DownloadedFile,
  type MediaJob,
  type StoredMessage,
} from "@connectus/adapters";

export type MediaDeps = {
  messages: {
    find(id: string): Promise<StoredMessage | null>;
    setMediaKey(id: string, mediaKey: string): Promise<void>;
  };
  telegram: { download(fileId: string): Promise<DownloadedFile> };
  storage: { put(key: string, bytes: Uint8Array, contentType: string): Promise<void> };
};

// Copies the Telegram file into our private bucket right away: Telegram's download link
// lives about an hour, and the audit log needs the original for years.
export async function handleMedia(job: MediaJob, deps: MediaDeps): Promise<void> {
  const message = await deps.messages.find(job.messageId);
  if (!message) throw new Error(`message ${job.messageId} not found`);
  if (!message.externalFileId || message.mediaKey) return;

  const file = await deps.telegram.download(message.externalFileId);
  const key = mediaKey(message, file.extension);
  await deps.storage.put(key, file.bytes, contentTypeFor(file.extension));
  await deps.messages.setMediaKey(message.id, key);
}

// <company>/<yyyy>/<mm>/<message id>.<ext>, by UTC receive date.
function mediaKey(message: StoredMessage, extension: string | null): string {
  const yyyy = message.receivedAt.getUTCFullYear();
  const mm = String(message.receivedAt.getUTCMonth() + 1).padStart(2, "0");
  return `${message.companyId}/${yyyy}/${mm}/${message.id}.${extension ?? "bin"}`;
}
