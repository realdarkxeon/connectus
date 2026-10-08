import { describe, expect, it } from "vitest";
import { createCleaner } from "../src/anonymize/cleaner.ts";

function clean(text: string, people: { names: string[]; onlyCapitalized?: boolean }[] = []) {
  return createCleaner({ people }).clean(text);
}

describe("cleaner: contact details", () => {
  it.each([
    ["+7 701 555 12 34", "[PHONE]"],
    ["8 (701) 555-12-34", "[PHONE]"],
    ["87015551234", "[PHONE]"],
    ["+77015551234", "[PHONE]"],
    ["701 555 12 34", "[PHONE]"],
    ["8 7172 55 12 34", "[PHONE]"],
  ])("replaces the phone %s", (phone, expected) => {
    expect(clean(`звони ${phone} после обеда`)).toBe(`звони ${expected} после обеда`);
  });

  it("replaces email, username and links", () => {
    expect(clean("пиши serik.a@mail.kz или @serik_pm, фото тут https://t.me/c/123/45")).toBe(
      "пиши [EMAIL] или [USERNAME], фото тут [LINK]",
    );
  });

  it("replaces an IIN, a bank card and an IBAN", () => {
    expect(clean("ИИН 850101300123")).toBe("ИИН [IIN]");
    expect(clean("карта 4400 4301 2345 6789")).toBe("карта [CARD]");
    expect(clean("счёт KZ86125KZT5004100100")).toBe("счёт [IBAN]");
  });
});

describe("cleaner: money and building words are kept", () => {
  it.each([
    "просит 380 тыс предоплату",
    "итого 1 200 000 тенге",
    "смета 7 500 000 000",
    "договор на 750 000 000",
    "лимит 770 500 000 тенге",
    "аванс 8 500 000 тг",
    "380000",
    "бетон М300, захватка 3, армопояс 2 этаж",
    "до 15.10.2026 к 18:00",
  ])("leaves %s untouched", (text) => {
    expect(clean(text)).toBe(text);
  });
});

describe("cleaner: names", () => {
  const people = [
    { names: ["Серик", "Ахметов"] },
    { names: ["Айбек"] },
    { names: ["Дина"] },
    { names: ["Алмаз"], onlyCapitalized: true },
  ];

  it("gives the same person the same label every time", () => {
    expect(clean("Айбек сказал Серику, Айбек привезёт", people)).toBe(
      "PERSON_2 сказал PERSON_1, PERSON_2 привезёт",
    );
  });

  it("catches Russian case endings", () => {
    expect(clean("звонил Айбеку, нет Айбека, с Айбеком, об Айбеке", people)).toBe(
      "звонил PERSON_2, нет PERSON_2, с PERSON_2, об PERSON_2",
    );
    expect(clean("у Дины, Дине сказал, с Диной", people)).toBe(
      "у PERSON_3, PERSON_3 сказал, с PERSON_3",
    );
    expect(clean("передал Ахметову", people)).toBe("передал PERSON_1");
  });

  it("matches names typed in lower case", () => {
    expect(clean("айбек не отвечает", people)).toBe("PERSON_2 не отвечает");
  });

  it("matches whole words only", () => {
    expect(clean("динамика хорошая, Айбекович пришёл", people)).toBe(
      "динамика хорошая, Айбекович пришёл",
    );
  });

  it("merges a first name and surname into one label", () => {
    expect(clean("Серик Ахметов на объекте", people)).toBe("PERSON_1 на объекте");
  });

  it("replaces a name that is also a word only when capitalized", () => {
    expect(clean("Алмаз режет алмазом", people)).toBe("PERSON_4 режет алмазом");
  });

  it("labels companies and sites", () => {
    const cleaner = createCleaner({
      people: [],
      companies: ["КазМеталл"],
      sites: ["ЖК Алтын"],
    });
    expect(cleaner.clean("КазМеталл везёт на ЖК Алтын")).toBe("COMPANY_1 везёт на SITE_1");
  });
});

describe("cleaner: reports for human review", () => {
  it("counts each replaced form, so wrong replacements are visible", () => {
    const cleaner = createCleaner({ people: [{ names: ["Айбек"] }] });
    cleaner.clean("Айбеку позвони");
    cleaner.clean("Айбеку напиши, Айбек ждёт");
    expect(cleaner.report().replacements).toEqual([
      { label: "PERSON_1", form: "Айбеку", count: 2 },
      { label: "PERSON_1", form: "Айбек", count: 1 },
    ]);
  });

  it("lists capitalized words it did not replace as suspects", () => {
    const cleaner = createCleaner({ people: [], keepWords: ["бетон"] });
    cleaner.clean("Бетон привёз Нурлан. Нурлан ждёт, М300 ок");
    expect(cleaner.report().suspects).toEqual([{ word: "Нурлан", count: 2 }]);
  });

  it("adds a sender and returns their label", () => {
    const cleaner = createCleaner({ people: [{ names: ["Айбек"] }] });
    expect(cleaner.addPerson(["Серик", "Ахметов"])).toBe("PERSON_2");
    expect(cleaner.addPerson(["Айбек"])).toBe("PERSON_1");
    expect(cleaner.clean("Серик")).toBe("PERSON_2");
  });

  it("joins a sender to the one listed person they match, ignoring extra words", () => {
    const cleaner = createCleaner({ people: [{ names: ["Серик", "Ахметов"] }] });
    expect(cleaner.addPerson(["Прораб", "Серик"])).toBe("PERSON_1");
    expect(cleaner.clean("прораб на месте")).toBe("прораб на месте");
  });

  it("keeps the label key separate from the cleaned text", () => {
    const cleaner = createCleaner({ people: [{ names: ["Айбек"] }] });
    expect(cleaner.mapping()).toEqual({ PERSON_1: ["Айбек"] });
  });
});
