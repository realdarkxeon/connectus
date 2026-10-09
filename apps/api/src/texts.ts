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
} as const;
