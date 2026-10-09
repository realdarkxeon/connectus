# PM interview (about 30 minutes, one per pilot site)

PMs are the daily users. If the bot slows them down, they go back to calling the owner and
the pilot fails. Ask about **their last real week**, not what they think in general.
If possible, do it on site, where they actually send messages.

## 0. Opening and consent (5 min)

- Владелец хочет, чтобы ваши вопросы решались быстрее и не терялись. Мы делаем бота: вы пишете
  или говорите как обычно, он оформляет это для владельца и возвращает вам ответ.
- Нам нужна ваша переписка с владельцем, чтобы настроить бота. Имена и телефоны удаляются.
  Вы согласны? Голосовые берём, только если отдельно разрешите.

## 1. How you work now (10 min)

1. Вспомните последний вопрос, который вы задали владельцу. Как отправили, когда получили ответ?
   *→ real example, time to decision baseline*
2. Сколько раз в день вы пишете или звоните владельцу?
3. Голосом или текстом? Почему? Отправляете фото, документы?
   *→ media mix, speech-to-text priority*
4. Что происходит, пока вы ждёте ответа? Стоит работа?
   *→ blocks_today, workStopped*
5. Бывало, что ответ потерялся или его потом поняли по-другому?
   *→ written proof of approvals (PM benefit)*

## 2. What a good request looks like (10 min)

6. Когда вы просите деньги на закупку, что вы пишете? Покажите в телефоне, если можно.
   *→ extraction examples, how money is written ("380 тыс", "1,2 млн")*
7. Какие слова и сокращения у вас на объекте? (захватка, армопояс, М300, ...)
   *→ jargon list for speech-to-text and extraction*
8. Если бот задаст вам уточняющий вопрос («какая сумма?»), это нормально или раздражает?
   Сколько вопросов максимум?
   *→ completeness loop, questions under 15 words*
9. Что вы решаете сами, не спрашивая владельца?
   *→ needs_owner, compare with the owner's answer*
9a. Бывает, что в одном сообщении вы пишете о двух-трёх разных проблемах? Покажите пример.
   *→ one card with "Также" vs splitting into several cards (docs/decisions.md)*

## 3. The bot (5 min)

10. В каком мессенджере вам удобнее? Есть ли интернет на объекте весь день?
11. Как вы покажете, что работа сделана? Фото подходит?
    *→ Done requires a photo*
12. Что бы вас точно раздражало в таком боте?

## After the interview (you, 10 min)

- Add new jargon words to a list (they go into docs/ai.md, Speech-to-text section).
- Note how this PM writes money and dates: that becomes practice and golden examples.
- Note where the PM's view differs from the owner's ("I decide this myself" vs "always ask me").
