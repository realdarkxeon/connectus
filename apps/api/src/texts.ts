// Every text the bot sends to people, in one place. Changing PM-facing wording is a product
// decision: agree it with the owner first.
export const TEXTS = {
  received: "получено",
  notConnected:
    "Здравствуйте! Ваш аккаунт пока не подключён к ConnectUS. " +
    "Сообщение сохранено. Обратитесь к руководителю, чтобы вас добавили.",
} as const;

// The owner's card (MVP S1). Layout approved by Darkhan 2026-10-09; confirm wording with the owner.
export const CARD_TEXTS = {
  types: {
    spend_approval: "💰 Расходы",
    schedule_change: "📅 Сроки",
    safety_incident: "🚨 БЕЗОПАСНОСТЬ",
    supply_problem: "🚚 Поставки",
    quality_defect: "🔧 Качество",
    design_change: "📐 Изменение проекта",
    staffing: "👷 Люди",
    info_report: "ℹ️ Отчёт",
  },
  from: "От",
  also: "Также",
  amount: "Сумма",
  decideBy: "Срок решения",
  notStated: "Не указано",
  missing: {
    amountKzt: "сумма",
    reason: "причина",
    newDate: "новая дата",
    cause: "причина задержки",
    anyoneHurt: "есть ли пострадавшие",
    workStopped: "остановлены ли работы",
  } as Record<string, string>,
  failedHeader: "⚠️ Не удалось разобрать автоматически",
  noText: "(без текста, оригинал ниже)",
} as const;

// Decisions (MVP S2). Approved by Darkhan 2026-10-09; confirm wording with the owner.
export const DECISION_TEXTS = {
  approve: "✅ Одобрить",
  reject: "❌ Отклонить",
  // Status line on the owner's card and the notice on the tapped button.
  approved: "✅ Одобрено",
  rejected: "❌ Отклонено",
  alreadyApproved: "Уже одобрено",
  alreadyRejected: "Уже отклонено",
  noAccess: "Нет доступа",
  // To the PM, as a reply to their message.
  pmApproved: "✅ Владелец одобрил",
  pmRejected: "❌ Владелец отклонил",
  pmRejectedHint: "Если нужно, свяжитесь с владельцем.",
  yourMessage: "ваше сообщение",
} as const;

// The owner answering by replying to a card (MVP S2). Approved by Darkhan 2026-10-09.
export const OWNER_TEXTS = {
  replyHeader: "💬 Ответ владельца:",
  replySent: "📨 Отправлено ПМ",
  hint: "Чтобы ответить ПМ, ответьте (Reply) на его карточку. Команды: /pending /active /history",
} as const;

// Owner commands and their lists (MVP S2). Approved by Darkhan 2026-10-09.
export const LIST_TEXTS = {
  commands: [
    { command: "pending", description: "Ждут решения" },
    { command: "active", description: "В работе" },
    { command: "history", description: "История" },
  ],
  titles: { pending: "Ждут решения", active: "В работе", history: "История" },
  none: "нет",
  shown: "показаны первые",
  until: "до",
  noText: "(без текста)",
  minutes: "мин",
  hours: "ч",
  days: "д",
} as const;

// Team management (MVP S4). Approved by Darkhan 2026-10-09.
export const TEAM_TEXTS = {
  // To the person joining.
  joined: "✅ Вы подключены к ConnectUS. Пишите или говорите голосом — владелец получит карточку.",
  alreadyMember: "Вы уже подключены. Просто пишите или говорите голосом.",
  inviteUsed: "Эта ссылка уже использована. Попросите у владельца новую.",
  inviteExpired: "Срок ссылки истёк. Попросите у владельца новую.",
  inviteInvalid: "Ссылка не найдена. Попросите у владельца новую.",
  // To the owner.
  ownerJoined: (name: string) => `👷 ${name} присоединился.`,
  inviteLink: (url: string) =>
    `Отправьте эту ссылку новому ПМ:\n${url}\n\nОна для одного человека и действует 7 дней.`,
  teamTitle: "Команда",
  noPms: "ПМ пока нет. Пригласите первого:",
  noSite: "без объекта",
  invite: "➕ Пригласить ПМ",
  sites: "🏗 Объекты",
  pmPage: "👷 Открыть",
} as const;
