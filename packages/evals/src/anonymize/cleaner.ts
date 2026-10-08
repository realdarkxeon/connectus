// Removes personal data from PM chat text before any AI or test file sees it
// (docs/discovery/README.md). Same person -> same label, so "who said what to whom" survives.
// Rule when unsure: replace, and show it in the report. A leaked name cannot be taken back;
// a wrongly replaced word is fixed by editing the lists and running again.

export type PersonEntry = {
  names: string[];
  // For names that are also ordinary words (Алмаз, Болат): match only when capitalized.
  onlyCapitalized?: boolean;
};

export type CleanerConfig = {
  people: PersonEntry[];
  companies?: string[];
  sites?: string[];
  // Capitalized words confirmed as not names; they stop appearing in the suspects list.
  keepWords?: string[];
};

export type Replacement = { label: string; form: string; count: number };
export type Suspect = { word: string; count: number };

export type Cleaner = {
  clean(text: string): string;
  // Registers a sender (words of their display name) and returns their label. If the words
  // match exactly one listed person, the sender is that person ("Прораб Серик" -> Серик) and
  // the other words are not added. Otherwise the sender becomes a new person.
  addPerson(names: string[]): string;
  report(): { replacements: Replacement[]; suspects: Suspect[] };
  // The name -> label key. Personal data: it stays in discovery-data/, never shared.
  mapping(): Record<string, string[]>;
};

// Word edges that work for Cyrillic (\b only knows Latin letters).
const START = String.raw`(?<![\p{L}\p{N}_])`;
const END = String.raw`(?![\p{L}\p{N}_])`;

// Contact details, in this order: wider patterns first, so a card number is not read as a
// phone. A phone is only accepted with exactly 10 digits after the country code, starting
// with 7 (Kazakhstan), which keeps sums like "7 500 000 000" intact.
const CONTACT_RULES: { pattern: RegExp; replace: (match: string) => string }[] = [
  {
    pattern: /https?:\/\/\S+?(?=[.,;:!?)]*(?:\s|$))|(?:t|wa)\.me\/\S+?(?=[.,;:!?)]*(?:\s|$))/gu,
    replace: () => "[LINK]",
  },
  {
    pattern: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu,
    replace: () => "[EMAIL]",
  },
  { pattern: /\bKZ\d{2}(?: ?[A-Z0-9]){16}\b/gu, replace: () => "[IBAN]" },
  { pattern: /(?<!\d)\d{4}(?:[ -]?\d{4}){3}(?!\d)/gu, replace: () => "[CARD]" },
  { pattern: /(?<!\d)\d{12}(?!\d)/gu, replace: () => "[IIN]" },
  {
    pattern: /(?<![\d+])(?:(?:\+7|8)[\s-]*)?\(?7\d{2,3}\)?(?:[\s-]*\d){6,8}(?!\d)/gu,
    replace: (match) => {
      let digits = match.replace(/\D/g, "");
      if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) {
        digits = digits.slice(1);
      }
      return digits.length === 10 && digits[0] === "7" ? "[PHONE]" : match;
    },
  },
  {
    pattern: /(?<![\p{L}\p{N}_@.])@[A-Za-z0-9_]{5,32}(?![A-Za-z0-9_])/gu,
    replace: () => "[USERNAME]",
  },
];

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A name plus its Russian case endings: Айбек -> Айбека, Айбеку, Айбеком, Айбеке;
// Дина -> Дины, Дине, Дину, Диной; Сергей -> Сергея, Сергею, Сергеем.
function wordWithEndings(word: string): string {
  const last = word.at(-1)?.toLowerCase();
  if (last === "а" || last === "я") {
    return `${escapeRegex(word.slice(0, -1))}(?:а|я|ы|и|е|у|ю|ой|ей|ою|ею)`;
  }
  if (last === "й" || last === "ь") {
    return `${escapeRegex(word.slice(0, -1))}(?:й|ь|я|ю|ем|ём|е|и)`;
  }
  return `${escapeRegex(word)}(?:а|у|ом|ым|ем|е|ы|ой|ов)?`;
}

// Multi-word forms ("ЖК Алтын") get endings on the last word only.
function formPattern(form: string, ignoreCase: boolean): RegExp {
  const words = form.trim().split(/\s+/);
  const lastWord = words.pop() ?? "";
  const body = [...words.map(escapeRegex), wordWithEndings(lastWord)].join(String.raw`\s+`);
  return new RegExp(`${START}${body}${END}`, ignoreCase ? "giu" : "gu");
}

type Group = { label: string; forms: string[]; ignoreCase: boolean };

export function createCleaner(config: CleanerConfig): Cleaner {
  const people: Group[] = config.people.map((p, i) => ({
    label: `PERSON_${i + 1}`,
    forms: p.names.filter((n) => n.trim().length >= 2),
    ignoreCase: !p.onlyCapitalized,
  }));
  const others: Group[] = [
    ...(config.companies ?? []).map((c, i) => ({
      label: `COMPANY_${i + 1}`,
      forms: [c],
      ignoreCase: true,
    })),
    ...(config.sites ?? []).map((s, i) => ({
      label: `SITE_${i + 1}`,
      forms: [s],
      ignoreCase: true,
    })),
  ];
  const keepWords = new Set((config.keepWords ?? []).map((w) => w.toLowerCase()));
  const replacements = new Map<string, Replacement>();
  const suspects = new Map<string, number>();

  // Longest form first, so "ЖК Алтын" wins over a person called "Алтын".
  let compiled: { label: string; pattern: RegExp }[] | null = null;
  const rules = () => {
    compiled ??= [...people, ...others]
      .flatMap((g) => g.forms.map((form) => ({ form, group: g })))
      .sort((a, b) => b.form.length - a.form.length)
      .map(({ form, group }) => ({
        label: group.label,
        pattern: formPattern(form, group.ignoreCase),
      }));
    return compiled;
  };

  function count(label: string, form: string) {
    const key = `${label}\u0000${form}`;
    const seen = replacements.get(key);
    if (seen) seen.count += 1;
    else replacements.set(key, { label, form, count: 1 });
  }

  return {
    clean(text) {
      let out = text;
      for (const rule of CONTACT_RULES) out = out.replace(rule.pattern, rule.replace);
      for (const { label, pattern } of rules()) {
        out = out.replace(pattern, (form) => {
          count(label, form);
          return label;
        });
      }
      // "Серик Ахметов" -> "PERSON_1 PERSON_1" -> "PERSON_1"
      out = out.replace(/\b((?:PERSON|COMPANY|SITE)_\d+)(?:\s+\1\b)+/g, "$1");

      for (const [word] of out.matchAll(/(?<![\p{L}\p{N}_])\p{Lu}\p{Ll}{2,}(?![\p{L}\p{N}_])/gu)) {
        if (!keepWords.has(word.toLowerCase())) suspects.set(word, (suspects.get(word) ?? 0) + 1);
      }
      return out;
    },

    addPerson(names) {
      const wanted = names.map((n) => n.trim()).filter((n) => n.length >= 2);
      const lower = wanted.map((n) => n.toLowerCase());
      const owners = people.filter((p) => p.forms.some((f) => lower.includes(f.toLowerCase())));
      if (owners.length === 1 && owners[0]) return owners[0].label;
      const label = `PERSON_${people.length + 1}`;
      people.push({ label, forms: wanted, ignoreCase: true });
      compiled = null;
      return label;
    },

    report() {
      return {
        replacements: [...replacements.values()].map((r) => ({ ...r })),
        suspects: [...suspects]
          .map(([word, n]) => ({ word, count: n }))
          .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word)),
      };
    },

    mapping() {
      return Object.fromEntries([...people, ...others].map((g) => [g.label, [...g.forms]]));
    },
  };
}
