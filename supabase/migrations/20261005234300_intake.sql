-- Step 3 intake: Telegram file ids, the waiting room for unknown senders, and the
-- private media bucket.
--
-- external_message_id convention (all channels): an id unique across the whole channel.
-- Telegram message_id is unique only within one chat, so we store '<chat_id>:<message_id>'.

-- Telegram's file id, kept until the file is copied into our Storage (media_key).
alter table public.message add column external_file_id text;

-- The waiting room. Messages from accounts that belong to no company yet.
-- Exception to hard rule 6: these rows have no company by definition. The table lives
-- in the private schema (not exposed by the Data API), has RLS on with no policies,
-- and no client role has any privilege on it. Only the server reads or writes it.
create table private.unrouted_message (
  id uuid primary key default gen_random_uuid(),
  channel text not null constraint unrouted_message_channel_valid
    check (channel in ('telegram', 'whatsapp')),
  external_message_id text not null,
  external_user_id text not null,
  sender_name text,
  kind text not null constraint unrouted_message_kind_valid
    check (kind in ('text', 'voice', 'photo', 'document', 'video', 'other')),
  text text,
  external_file_id text,
  received_at timestamptz not null default now(),
  -- Set when the sender is registered and this message is attached to their account.
  routed_message_id uuid references public.message (id),
  unique (channel, external_message_id)
);
create index unrouted_message_user_idx on private.unrouted_message (channel, external_user_id);

alter table private.unrouted_message enable row level security;
revoke all on private.unrouted_message from public, anon, authenticated;

-- Voice notes, photos and documents. Private: reachable only through short-lived
-- signed URLs created by the server. 20 MB matches Telegram's bot download limit.
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 20971520)
on conflict (id) do nothing;
