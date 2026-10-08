import { describe, expect, it } from "vitest";
import { createCleaner } from "../src/anonymize/cleaner.ts";
import { cleanChat, displayNameWords, readTelegramExport } from "../src/anonymize/telegram.ts";
import { fakeExport } from "./fixtures/telegram-export.ts";

describe("readTelegramExport", () => {
  it("reads messages, skips service entries, joins text pieces", () => {
    const messages = readTelegramExport(fakeExport);
    expect(messages.map((m) => m.id)).toEqual([2, 3, 4, 5]);
    expect(messages[1]?.text).toBe("Номер +7 701 555 12 34, просит 380 тыс, пишите @aibek_snab");
  });

  it("keeps time in UTC from the unix timestamp", () => {
    expect(readTelegramExport(fakeExport)[0]?.at).toBe("2026-10-08T05:00:00.000Z");
  });

  it("names the media kind and keeps reply and forward facts", () => {
    const [, reply, voice, photo] = readTelegramExport(fakeExport);
    expect(reply?.replyTo).toBe(2);
    expect(voice?.media).toBe("voice");
    expect(voice?.forwarded).toBe(true);
    expect(photo?.media).toBe("photo");
  });

  it("rejects a file that is not a Telegram export", () => {
    expect(() => readTelegramExport({ chats: [] })).toThrow();
  });
});

describe("cleanChat", () => {
  const cleaner = () => createCleaner({ people: [{ names: ["Серик", "Ахметов"] }] });

  it("gives one sender one label even when their display name changes", () => {
    const out = cleanChat(readTelegramExport(fakeExport), cleaner());
    expect(out.map((m) => m.from)).toEqual(["PERSON_1", "PERSON_1", "PERSON_2", "PERSON_1"]);
  });

  it("catches a sender's name in messages sent before theirs", () => {
    const out = cleanChat(readTelegramExport(fakeExport), cleaner());
    expect(out[0]?.text).toBe("Бетон М300 не привезли, PERSON_2 звонил");
  });

  it("leaves no name, id or forwarded-from name in the output", () => {
    const out = JSON.stringify(cleanChat(readTelegramExport(fakeExport), cleaner()));
    for (const leak of ["Серик", "Ахметов", "Айбек", "Сапаров", "Нурлан", "user111", "aibek"]) {
      expect(out).not.toContain(leak);
    }
    expect(out).toContain("380 тыс");
  });

  it("splits a display name into usable words", () => {
    expect(displayNameWords("Серик Ахметов 🏗 С.")).toEqual(["Серик", "Ахметов"]);
  });
});
