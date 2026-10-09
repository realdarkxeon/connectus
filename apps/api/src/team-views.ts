import type { Button, PmPage, SiteSummary, TeamMember } from "@connectus/adapters";
import { encodeTeamButton, type TeamAction } from "./buttons.ts";
import { TEAM_TEXTS } from "./texts.ts";

// The owner's team screens (MVP S4): plain text plus buttons, built from repo data.
type View = { text: string; buttons: Button[][] };

const PER_ROW = 5;
const button = (text: string, action: TeamAction): Button => ({
  text,
  data: encodeTeamButton(action),
});
function numbered(actions: TeamAction[]): Button[][] {
  const rows: Button[][] = [];
  for (let i = 0; i < actions.length; i += PER_ROW) {
    rows.push(actions.slice(i, i + PER_ROW).map((a, j) => button(String(i + j + 1), a)));
  }
  return rows;
}

export function teamView(team: TeamMember[]): View {
  const top = [
    button(TEAM_TEXTS.invite, { kind: "invite" }),
    button(TEAM_TEXTS.sites, { kind: "sites" }),
  ];
  if (team.length === 0) return { text: TEAM_TEXTS.noPms, buttons: [top] };
  const lines = team.map((p, i) => {
    const parts = [p.name, p.workPackage, p.sites.length ? p.sites.join(", ") : TEAM_TEXTS.noSite];
    return `${i + 1}. ${parts.filter(Boolean).join(" · ")}`;
  });
  return {
    text: [`${TEAM_TEXTS.teamTitle}: ${team.length} ПМ`, "", ...lines].join("\n"),
    buttons: [top, ...numbered(team.map((p) => ({ kind: "pm", personId: p.personId })))],
  };
}

export function pmView(page: PmPage, timeZone: string): View {
  const title = [
    `👷 ${page.name}`,
    page.workPackage,
    page.connected ? null : TEAM_TEXTS.notConnected,
  ]
    .filter(Boolean)
    .join(" · ");
  const assigned = page.sites.filter((s) => s.assigned).map((s) => s.name);
  const since = new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(page.joinedAt);
  const text = [
    title,
    `${TEAM_TEXTS.sitesLabel}: ${assigned.length ? assigned.join(", ") : TEAM_TEXTS.noSite}`,
    `${TEAM_TEXTS.since} ${since}`,
  ].join("\n");
  const back = [button(TEAM_TEXTS.toTeam, { kind: "team" })];
  if (!page.connected) return { text, buttons: [back] };
  const personId = page.personId;
  return {
    text,
    buttons: [
      [
        button(TEAM_TEXTS.pmSites, { kind: "pm_sites", personId }),
        button(TEAM_TEXTS.pmName, { kind: "pm_name", personId }),
        button(TEAM_TEXTS.pmWork, { kind: "pm_work", personId }),
      ],
      [button(TEAM_TEXTS.pmOff, { kind: "pm_off", personId })],
      back,
    ],
  };
}

export function pmSitesView(page: PmPage): View {
  const back = [button(TEAM_TEXTS.back, { kind: "pm", personId: page.personId })];
  if (page.sites.length === 0) {
    return {
      text: TEAM_TEXTS.noSitesYet,
      buttons: [[button(TEAM_TEXTS.addSite, { kind: "site_add" })], back],
    };
  }
  return {
    text: TEAM_TEXTS.pickSites(page.name),
    buttons: [
      ...page.sites.map((s) => [
        button(`${s.assigned ? "✅" : "⬜"} ${s.name}`, {
          kind: "pm_site_toggle",
          personId: page.personId,
          siteId: s.siteId,
        }),
      ]),
      back,
    ],
  };
}

export function sitesView(sites: SiteSummary[]): View {
  const top = [
    button(TEAM_TEXTS.addSite, { kind: "site_add" }),
    button(TEAM_TEXTS.toTeam, { kind: "team" }),
  ];
  if (sites.length === 0) return { text: TEAM_TEXTS.noSites, buttons: [top] };
  const lines = sites.map(
    (s, i) =>
      `${i + 1}. ${s.name} · ${s.pmNames.length ? s.pmNames.join(", ") : TEAM_TEXTS.nobody}`,
  );
  return {
    text: [`${TEAM_TEXTS.sitesTitle}: ${sites.length}`, "", ...lines].join("\n"),
    buttons: [top, ...numbered(sites.map((s) => ({ kind: "site", siteId: s.siteId })))],
  };
}

export function siteView(site: SiteSummary): View {
  return {
    text: [
      `🏗 ${site.name}`,
      `${TEAM_TEXTS.sitePms}: ${site.pmNames.length ? site.pmNames.join(", ") : TEAM_TEXTS.nobody}`,
    ].join("\n"),
    buttons: [[button(TEAM_TEXTS.toSites, { kind: "sites" })]],
  };
}
