import type {
  Button,
  ButtonJob,
  Person,
  PmPage,
  PromptKind,
  SendOptions,
  SiteSummary,
  TeamMember,
} from "@connectus/adapters";
import { encodeTeamButton, type TeamAction } from "../buttons.ts";
import { pmSitesView, pmView, sitesView, siteView, teamView } from "../team-views.ts";
import { DECISION_TEXTS, TEAM_TEXTS } from "../texts.ts";

export type TeamDeps = {
  team: {
    createInvite(companyId: string, createdBy: string): Promise<string>;
    listTeam(companyId: string): Promise<TeamMember[]>;
    pmDetails(companyId: string, personId: string): Promise<PmPage | null>;
    toggleSite(companyId: string, personId: string, siteId: string): Promise<boolean | null>;
    disconnectPm(companyId: string, personId: string): Promise<boolean>;
    listSites(companyId: string): Promise<SiteSummary[]>;
    createPrompt(
      companyId: string,
      chatId: string,
      messageId: number,
      kind: PromptKind,
      subjectId: string | null,
    ): Promise<void>;
    companyTimezone(companyId: string): Promise<string>;
  };
  telegram: {
    send(chatId: string, text: string, options?: SendOptions): Promise<number>;
    edit(chatId: string, messageId: number, text: string, buttons?: Button[][]): Promise<void>;
    answerButton(callbackQueryId: string, text: string): Promise<void>;
    botUsername(): Promise<string>;
  };
};

// A team-management button (MVP S4). Only the company's owner may use them, and every id
// is checked against his company by the repo. Moving between screens edits the same
// message; an invite link and the bot's questions are new messages.
export async function handleTeamButton(
  job: ButtonJob,
  action: TeamAction,
  person: Person | null,
  deps: TeamDeps,
): Promise<void> {
  if (person?.role !== "owner") {
    await answer(deps, job, DECISION_TEXTS.noAccess);
    return;
  }
  const co = person.companyId;
  const show = (view: { text: string; buttons: Button[][] }) =>
    editIgnoringUnchanged(deps, job, view.text, view.buttons);
  const ask = async (text: string, kind: PromptKind, subjectId: string | null) => {
    const messageId = await deps.telegram.send(job.chatId, text, { forceReply: true });
    await deps.team.createPrompt(co, job.chatId, messageId, kind, subjectId);
  };
  const pmOr403 = async (personId: string) => {
    const page = await deps.team.pmDetails(co, personId);
    if (!page) await answer(deps, job, DECISION_TEXTS.noAccess);
    return page;
  };

  switch (action.kind) {
    case "invite": {
      const token = await deps.team.createInvite(co, person.personId);
      const url = `https://t.me/${await deps.telegram.botUsername()}?start=${token}`;
      await deps.telegram.send(job.chatId, TEAM_TEXTS.inviteLink(url));
      break;
    }
    case "team":
      await show(teamView(await deps.team.listTeam(co)));
      break;
    case "sites":
      await show(sitesView(await deps.team.listSites(co)));
      break;
    case "site": {
      const site = (await deps.team.listSites(co)).find((s) => s.siteId === action.siteId);
      if (!site) return answer(deps, job, DECISION_TEXTS.noAccess);
      await show(siteView(site));
      break;
    }
    case "site_add":
      await ask(TEAM_TEXTS.askSite, "site_name", null);
      break;
    case "pm": {
      const page = await pmOr403(action.personId);
      if (!page) return;
      await show(pmView(page, await deps.team.companyTimezone(co)));
      break;
    }
    case "pm_sites": {
      const page = await pmOr403(action.personId);
      if (!page) return;
      await show(pmSitesView(page));
      break;
    }
    case "pm_site_toggle": {
      const now = await deps.team.toggleSite(co, action.personId, action.siteId);
      if (now === null) return answer(deps, job, DECISION_TEXTS.noAccess);
      const page = await deps.team.pmDetails(co, action.personId);
      if (page) await show(pmSitesView(page));
      break;
    }
    case "pm_name": {
      const page = await pmOr403(action.personId);
      if (!page) return;
      await ask(TEAM_TEXTS.askName(page.name), "pm_name", page.personId);
      break;
    }
    case "pm_work": {
      const page = await pmOr403(action.personId);
      if (!page) return;
      await ask(TEAM_TEXTS.askWork(page.name), "work_package", page.personId);
      break;
    }
    case "pm_off": {
      const page = await pmOr403(action.personId);
      if (!page) return;
      const personId = page.personId;
      await show({
        text: TEAM_TEXTS.confirmOff(page.name),
        buttons: [
          [
            { text: TEAM_TEXTS.offYes, data: encodeTeamButton({ kind: "pm_off_yes", personId }) },
            { text: TEAM_TEXTS.cancel, data: encodeTeamButton({ kind: "pm", personId }) },
          ],
        ],
      });
      break;
    }
    case "pm_off_yes": {
      const page = await pmOr403(action.personId);
      if (!page) return;
      if (page.connected) await deps.team.disconnectPm(co, action.personId);
      await show({ text: TEAM_TEXTS.offDone(page.name), buttons: [] });
      break;
    }
  }
  await answer(deps, job, "");
}

// A tap can be answered once and only for a short while; never fail the job over it.
async function answer(deps: TeamDeps, job: ButtonJob, text: string): Promise<void> {
  try {
    await deps.telegram.answerButton(job.callbackQueryId, text);
  } catch (error) {
    if ((error as { error_code?: number }).error_code !== 400) throw error;
  }
}

// Redrawing a screen with the same content is a Telegram 400 ("message is not modified").
async function editIgnoringUnchanged(
  deps: TeamDeps,
  job: ButtonJob,
  text: string,
  buttons: Button[][],
): Promise<void> {
  try {
    await deps.telegram.edit(job.chatId, job.messageId, text, buttons);
  } catch (error) {
    if ((error as { error_code?: number }).error_code !== 400) throw error;
  }
}
