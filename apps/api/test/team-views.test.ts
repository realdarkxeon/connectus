import type { PmPage, SiteSummary, TeamMember } from "@connectus/adapters";
import { describe, expect, it } from "vitest";
import { decodeTeamButton } from "../src/buttons.ts";
import { pmSitesView, pmView, sitesView, siteView, teamView } from "../src/team-views.ts";

const SERIK = "5a9e0000-0000-4000-8000-0000000000b1";
const AIBEK = "5a9e0000-0000-4000-8000-0000000000b2";
const ALTYN = "5a9e0000-0000-4000-8000-0000000000c1";
const SAMAL = "5a9e0000-0000-4000-8000-0000000000c2";
const joined = new Date("2026-10-09T05:00:00Z");

const member = (o: Partial<TeamMember>): TeamMember => ({
  personId: SERIK,
  name: "Серик",
  workPackage: null,
  sites: [],
  joinedAt: joined,
  ...o,
});
const decodeAll = (buttons: { data: string }[][]) =>
  buttons.flat().map((b) => decodeTeamButton(b.data));

describe("teamView", () => {
  it("lists PMs with work package and sites, and invite / sites / number buttons", () => {
    const { text, buttons } = teamView([
      member({
        personId: AIBEK,
        name: "Айбек",
        workPackage: "фасад",
        sites: ["ЖК Самал", "ЖК Алтын"],
      }),
      member({ workPackage: "монолит", sites: ["ЖК Алтын"] }),
      member({ personId: "5a9e0000-0000-4000-8000-0000000000b3", name: "Дина" }),
    ]);
    expect(text).toBe(
      [
        "Команда: 3 ПМ",
        "",
        "1. Айбек · фасад · ЖК Самал, ЖК Алтын",
        "2. Серик · монолит · ЖК Алтын",
        "3. Дина · без объекта",
      ].join("\n"),
    );
    expect(buttons[0]?.map((b) => b.text)).toEqual(["➕ Пригласить ПМ", "🏗 Объекты"]);
    expect(decodeAll(buttons).slice(2)).toEqual([
      { kind: "pm", personId: AIBEK },
      { kind: "pm", personId: SERIK },
      { kind: "pm", personId: "5a9e0000-0000-4000-8000-0000000000b3" },
    ]);
  });

  it("invites the first PM when the team is empty", () => {
    const { text, buttons } = teamView([]);
    expect(text).toBe("ПМ пока нет. Пригласите первого:");
    expect(decodeAll(buttons)).toEqual([{ kind: "invite" }, { kind: "sites" }]);
  });
});

const page = (o: Partial<PmPage> = {}): PmPage => ({
  personId: SERIK,
  name: "Серик",
  workPackage: "монолит",
  connected: true,
  joinedAt: joined,
  sites: [
    { siteId: ALTYN, name: "ЖК Алтын", assigned: true },
    { siteId: SAMAL, name: "ЖК Самал", assigned: false },
  ],
  ...o,
});

describe("pmView", () => {
  it("shows the PM and the actions", () => {
    const { text, buttons } = pmView(page(), "Asia/Almaty");
    expect(text).toBe(
      ["👷 Серик · монолит", "Объекты: ЖК Алтын", "С нами с 09.10.2026"].join("\n"),
    );
    expect(decodeAll(buttons)).toEqual([
      { kind: "pm_sites", personId: SERIK },
      { kind: "pm_name", personId: SERIK },
      { kind: "pm_work", personId: SERIK },
      { kind: "pm_off", personId: SERIK },
      { kind: "team" },
    ]);
  });

  it("shows a disconnected PM without actions", () => {
    const { text, buttons } = pmView(page({ connected: false }), "Asia/Almaty");
    expect(text.split("\n")[0]).toBe("👷 Серик · монолит · отключён");
    expect(decodeAll(buttons)).toEqual([{ kind: "team" }]);
  });
});

describe("pmSitesView", () => {
  it("shows every site as a ✅/⬜ toggle", () => {
    const { text, buttons } = pmSitesView(page());
    expect(text).toBe("Объекты для Серик. Нажмите, чтобы назначить или снять:");
    expect(buttons.map((row) => row.map((b) => b.text))).toEqual([
      ["✅ ЖК Алтын"],
      ["⬜ ЖК Самал"],
      ["« Назад"],
    ]);
    expect(decodeAll(buttons)[1]).toEqual({
      kind: "pm_site_toggle",
      personId: SERIK,
      siteId: SAMAL,
    });
  });

  it("offers to add a site when there are none", () => {
    const { text, buttons } = pmSitesView(page({ sites: [] }));
    expect(text).toBe("Объектов пока нет. Добавьте первый:");
    expect(decodeAll(buttons)).toEqual([{ kind: "site_add" }, { kind: "pm", personId: SERIK }]);
  });
});

describe("sitesView and siteView", () => {
  const sites: SiteSummary[] = [
    { siteId: ALTYN, name: "ЖК Алтын", pmNames: ["Айбек", "Серик"] },
    { siteId: SAMAL, name: "ЖК Самал", pmNames: [] },
  ];

  it("lists sites with their PMs", () => {
    const { text, buttons } = sitesView(sites);
    expect(text).toBe(
      ["Объекты: 2", "", "1. ЖК Алтын · Айбек, Серик", "2. ЖК Самал · нет ПМ"].join("\n"),
    );
    expect(decodeAll(buttons)).toEqual([
      { kind: "site_add" },
      { kind: "team" },
      { kind: "site", siteId: ALTYN },
      { kind: "site", siteId: SAMAL },
    ]);
  });

  it("says when there are no sites", () => {
    expect(sitesView([]).text).toBe("Объектов пока нет.");
  });

  it("shows one site", () => {
    const { text, buttons } = siteView({ siteId: ALTYN, name: "ЖК Алтын", pmNames: ["Серик"] });
    expect(text).toBe(["🏗 ЖК Алтын", "ПМ: Серик"].join("\n"));
    expect(decodeAll(buttons)).toEqual([{ kind: "sites" }]);
  });
});
