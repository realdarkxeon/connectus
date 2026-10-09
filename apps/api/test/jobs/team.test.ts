import type {
  Button,
  Person,
  PmPage,
  SendOptions,
  SiteSummary,
  TeamMember,
} from "@connectus/adapters";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeTeamButton, type TeamAction } from "../../src/buttons.ts";
import { handleTeamButton, type TeamDeps } from "../../src/jobs/team.ts";

const CO = "co-1";
const SERIK = "5a9e0000-0000-4000-8000-0000000000b1";
const ALTYN = "5a9e0000-0000-4000-8000-0000000000c1";
const owner: Person = { personId: "owner-1", companyId: CO, role: "owner" };

class FakeTeam {
  invites: string[] = [];
  prompts: { chatId: string; messageId: number; kind: string; subjectId: string | null }[] = [];
  assigned = new Set<string>();
  disconnected: string[] = [];
  async createInvite(companyId: string, createdBy: string) {
    this.invites.push(`${companyId}/${createdBy}`);
    return "i_AbCdEfGhIjKlMnOpQrStUv";
  }
  async listTeam(): Promise<TeamMember[]> {
    return [];
  }
  async pmDetails(companyId: string, personId: string): Promise<PmPage | null> {
    if (companyId !== CO || personId !== SERIK) return null;
    return {
      personId,
      name: "Серик",
      workPackage: null,
      connected: !this.disconnected.includes(personId),
      joinedAt: new Date("2026-10-09T05:00:00Z"),
      sites: [{ siteId: ALTYN, name: "ЖК Алтын", assigned: this.assigned.has(ALTYN) }],
    };
  }
  async toggleSite(companyId: string, personId: string, siteId: string) {
    if (companyId !== CO || personId !== SERIK) return null;
    if (this.assigned.delete(siteId)) return false;
    this.assigned.add(siteId);
    return true;
  }
  async disconnectPm(companyId: string, personId: string) {
    if (companyId !== CO) return false;
    this.disconnected.push(personId);
    return true;
  }
  async listSites(): Promise<SiteSummary[]> {
    return [];
  }
  async createPrompt(
    _co: string,
    chatId: string,
    messageId: number,
    kind: string,
    subjectId: string | null,
  ) {
    this.prompts.push({ chatId, messageId, kind, subjectId });
  }
  async companyTimezone() {
    return "Asia/Almaty";
  }
}

class FakeTelegram {
  sent: { chatId: string; text: string; options: SendOptions }[] = [];
  edits: { messageId: number; text: string; buttons: Button[][] | undefined }[] = [];
  answers: string[] = [];
  async send(chatId: string, text: string, options: SendOptions = {}) {
    this.sent.push({ chatId, text, options });
    return 4242;
  }
  async edit(_chatId: string, messageId: number, text: string, buttons?: Button[][]) {
    this.edits.push({ messageId, text, buttons });
  }
  async answerButton(_id: string, text: string) {
    this.answers.push(text);
  }
  async botUsername() {
    return "connectus_staging_bot";
  }
}

let team: FakeTeam;
let telegram: FakeTelegram;
beforeEach(() => {
  team = new FakeTeam();
  telegram = new FakeTelegram();
});
const deps = (): TeamDeps => ({ team, telegram });
const job = (action: TeamAction) => ({
  callbackQueryId: "CBQ",
  fromUserId: "1233584354",
  chatId: "1233584354",
  messageId: 900,
  data: encodeTeamButton(action),
});

describe("team buttons", () => {
  it("refuses anyone who is not an owner", async () => {
    await handleTeamButton(
      job({ kind: "invite" }),
      { kind: "invite" },
      { ...owner, role: "pm" },
      deps(),
    );
    expect(telegram.answers).toEqual(["Нет доступа"]);
    expect(team.invites).toEqual([]);
  });

  it("creates an invite and sends the link as a new message to forward", async () => {
    await handleTeamButton(job({ kind: "invite" }), { kind: "invite" }, owner, deps());
    expect(team.invites).toEqual(["co-1/owner-1"]);
    expect(telegram.sent[0]?.text).toContain(
      "https://t.me/connectus_staging_bot?start=i_AbCdEfGhIjKlMnOpQrStUv",
    );
    expect(telegram.sent[0]?.text).toContain("действует 7 дней");
  });

  it("navigates by editing the same message", async () => {
    await handleTeamButton(
      job({ kind: "pm", personId: SERIK }),
      { kind: "pm", personId: SERIK },
      owner,
      deps(),
    );
    expect(telegram.sent).toEqual([]);
    expect(telegram.edits[0]?.messageId).toBe(900);
    expect(telegram.edits[0]?.text).toContain("👷 Серик");
  });

  it("refuses another company's PM", async () => {
    const action = { kind: "pm", personId: SERIK } as const;
    await handleTeamButton(job(action), action, { ...owner, companyId: "co-2" }, deps());
    expect(telegram.answers).toEqual(["Нет доступа"]);
    expect(telegram.edits).toEqual([]);
  });

  it("toggles a site and redraws the toggles in place", async () => {
    const action = { kind: "pm_site_toggle", personId: SERIK, siteId: ALTYN } as const;
    await handleTeamButton(job(action), action, owner, deps());
    expect(team.assigned.has(ALTYN)).toBe(true);
    expect(telegram.edits[0]?.buttons?.[0]?.[0]?.text).toBe("✅ ЖК Алтын");
  });

  it("asks for a new name and remembers the question", async () => {
    const action = { kind: "pm_name", personId: SERIK } as const;
    await handleTeamButton(job(action), action, owner, deps());
    expect(telegram.sent[0]).toMatchObject({
      text: "Новое имя для Серик:",
      options: { forceReply: true },
    });
    expect(team.prompts).toEqual([
      { chatId: "1233584354", messageId: 4242, kind: "pm_name", subjectId: SERIK },
    ]);
  });

  it("asks before disconnecting, then disconnects", async () => {
    const off = { kind: "pm_off", personId: SERIK } as const;
    await handleTeamButton(job(off), off, owner, deps());
    expect(telegram.edits[0]?.text).toContain("Отключить Серик?");
    expect(team.disconnected).toEqual([]);
    const yes = { kind: "pm_off_yes", personId: SERIK } as const;
    await handleTeamButton(job(yes), yes, owner, deps());
    expect(team.disconnected).toEqual([SERIK]);
    expect(telegram.edits[1]?.text).toContain("🚫 Серик отключён");
  });

  it("asks for a new site's name", async () => {
    await handleTeamButton(job({ kind: "site_add" }), { kind: "site_add" }, owner, deps());
    expect(telegram.sent[0]?.text).toBe("Название нового объекта:");
    expect(team.prompts[0]).toMatchObject({ kind: "site_name", subjectId: null });
  });
});
