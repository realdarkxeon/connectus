# Owner interview (about 60 minutes)

Questions are in Russian, as asked. The note under each says what the answer feeds, so you
can drop or reorder questions without losing what we need. Ask for **real recent examples**,
not opinions: "расскажите про последний раз" beats "как обычно бывает".

Record answers in your own notes; if you record audio, ask permission first.

## 0. Opening and consent (5 min)

- Расскажу, что мы делаем: бот, который собирает сообщения от ПМов, превращает их в короткие
  карточки и показывает вам только то, что требует вашего решения.
- Для настройки нам нужны реальные переписки. Имена и телефоны удаляются до того, как текст
  увидит любая программа. Вы согласны? Можно подтвердить письменно?

## 1. Company and sites (10 min)

1. Сколько сейчас объектов? Как они называются между собой (короткие названия)?
   *→ site list, siteHint matching*
2. Кто ПМы, за какой участок работ отвечает каждый, на каких объектах?
   *→ seed data, work packages, which PM spans two sites*
3. Есть ли заместитель, который может решать вместо вас? По каким объектам/вопросам?
   *→ deputy role, Delegate verdict (open decision for M2)*
4. В каком мессенджере пишет каждый ПМ? Голосом или текстом чаще?
   *→ Telegram vs WhatsApp order, speech-to-text priority*

## 2. Today's baseline (10 min)

5. Сколько примерно сообщений от ПМов в день? Сколько времени уходит на них?
   *→ pilot metric "owner minutes per day"*
6. Вспомните вчерашний день: какие вопросы пришли, на какие вы ответили сразу, какие ждали?
   *→ real request examples, time to decision*
7. Бывало ли, что важное утонуло в переписке? Расскажите последний такой случай.
   *→ why lanes matter, what "interrupt" must catch*
8. Бывали споры «вы же сами сказали»? Как их решали?
   *→ audit log, voice reply as original audio*

## 3. What needs you, and what doesn't (15 min)

9. Какие вопросы ПМ должен решать сам, без вас? Есть ли сумма, до которой ПМ решает сам?
   *→ owner rules, auto lane, needs_owner*
10. Какие вопросы вы всегда хотите видеть, даже мелкие?
    *→ needs_owner = yes regardless of amount*
11. Что для вас «срочно»? Приведите пример срочного и пример «подождёт до вечера».
    *→ urgency rubric 1-5 (draft it together at the end)*
12. Когда вас можно дёргать сразу, со звуком? Только безопасность? Остановка работ?
    *→ Interrupt lane definition*
13. В какое время удобно получать сводку несрочных вопросов? (сейчас: 09:00, 13:00, 18:00)
    *→ digest times*
14. Что обязательно должно быть в вопросе, чтобы вы могли ответить сразу?
    (сумма, причина, срок, фото, от кого)
    *→ required fields per type, completeness questions to PM*

## 4. Types of requests (10 min)

15. Посмотрите на список и скажите, чего не хватает и что лишнее:
    закупка/расход, сдвиг сроков, безопасность, поставки, брак/качество, изменение проекта,
    люди/бригады, просто отчёт.
    *→ RequestType list*
16. Какие вопросы повторяются каждую неделю?
    *→ auto rules candidates, duplicates*
17. Как вы обычно отвечаете: да/нет, голосом с пояснением, «перезвони»?
    *→ decision buttons, voice reply flow*

## 5. Pilot and next steps (10 min)

18. Какие 3 объекта взять в пилот: один хаотичный, один спокойный, один где ПМ на двух объектах?
19. С какими ПМами можно поговорить (по одному с каждого объекта)?
20. Можете выгрузить переписку с этими ПМами за последние 1-2 месяца? (инструкция в README)
21. Через 4 недели пилота, что должно произойти, чтобы вы сказали «это работает»?
    *→ pilot success criteria, check against docs/product.md metrics*

## After the interview (you, 15 min)

- Write the site + PM list, the money threshold (if any), and the draft urgency rubric
  while it is fresh.
- Note any request type he mentioned that is not in our list.
- Update docs/roadmap.md Step 1.
