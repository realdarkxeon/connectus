-- MVP S4: the owner manages his team from Telegram (invites, sites, names, work packages).

-- What the PM does on site ("монолит", "фасад"), set by the owner; shown on every card.
alter table public.person add column work_package text
  constraint person_work_package_length check (length(work_package) between 1 and 100);

-- One-person, time-limited invite links (t.me/<bot>?start=<token>). Only the SHA-256 of the
-- token is stored, so a copy of this table cannot be used to join a company. Single use:
-- used_at/used_by are set when a PM joins with it.
create table public.invite (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  token_hash text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid,
  unique (company_id, id),
  foreign key (company_id, created_by) references public.person (company_id, id),
  foreign key (company_id, used_by) references public.person (company_id, id),
  constraint invite_used_together check ((used_at is null) = (used_by is null))
);
create index invite_company_idx on public.invite (company_id, created_at);

-- Questions the bot asked the owner ("Напишите название объекта"). The owner's answer comes
-- as a Telegram reply to that question message; this row says what the answer is for.
-- subject_id: the person or site the answer is about (null for a new site).
create table public.bot_prompt (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  chat_id text not null,
  message_id integer not null,
  kind text not null constraint bot_prompt_kind_valid
    check (kind in ('site_name', 'pm_name', 'work_package')),
  subject_id uuid,
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  unique (chat_id, message_id)
);
create index bot_prompt_company_idx on public.bot_prompt (company_id, created_at);

-- Server only: invites are keys and prompts are internal plumbing. RLS on, no policies, no
-- client privileges (the server connection bypasses RLS).
alter table public.invite enable row level security;
alter table public.bot_prompt enable row level security;
revoke all on public.invite, public.bot_prompt from anon, authenticated;
