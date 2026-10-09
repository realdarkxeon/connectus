-- MVP S2: the owner answers a PM by replying to the PM's card in Telegram.
--
-- Which message a message replies to, in the same '<chat_id>:<message_id>' form as
-- external_message_id. Null for a message that is not a reply. Not searched by, so no index.
alter table public.message add column reply_to_external_message_id text;

-- Finding the request behind an owner's reply: the owner_notified EVENT records where each
-- card was delivered ({"cards": [{"chatId": ..., "messageId": ...}]}), and the lookup is a
-- containment search on that payload. Partial, so only those entries are indexed.
create index event_owner_card_idx on public.event using gin (payload jsonb_path_ops)
  where type = 'owner_notified';
