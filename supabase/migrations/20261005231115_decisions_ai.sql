-- Owner decisions, decision-engine runs, owner rules, and the AI call ledger.
-- Costs are exact decimals in USD (numeric, never float).

create table public.decision (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  request_id uuid not null,
  owner_id uuid not null,
  verdict text not null constraint decision_verdict_valid
    check (verdict in ('approve', 'reject', 'ask_more', 'delegate')),
  instruction text,
  voice_key text, -- original audio, delivered as-is (hard rule 11)
  decided_at timestamptz not null default now(),
  foreign key (company_id, request_id) references public.request (company_id, id),
  foreign key (company_id, owner_id) references public.person (company_id, id)
);
create index decision_request_idx on public.decision (company_id, request_id);
create index decision_owner_idx on public.decision (company_id, owner_id);

create table public.triage_run (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  request_id uuid not null,
  engine text not null,
  outputs jsonb not null,
  latency_ms integer not null check (latency_ms >= 0),
  cost_usd numeric(14, 8) not null default 0 check (cost_usd >= 0),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (company_id, request_id) references public.request (company_id, id)
);
create index triage_run_request_idx on public.triage_run (company_id, request_id);

create table public.owner_rule (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  source_text text not null,
  rule jsonb not null,
  active boolean not null default false,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index owner_rule_company_idx on public.owner_rule (company_id);

create table public.ai_call (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  request_id uuid,
  provider text not null,
  model text not null,
  purpose text not null,
  latency_ms integer not null check (latency_ms >= 0),
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  cost_usd numeric(14, 8) not null default 0 check (cost_usd >= 0),
  ok boolean not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, request_id) references public.request (company_id, id)
);
create index ai_call_company_idx on public.ai_call (company_id, created_at);
create index ai_call_request_idx on public.ai_call (company_id, request_id);

-- Access: clients read only.
alter table public.decision enable row level security;
alter table public.triage_run enable row level security;
alter table public.owner_rule enable row level security;
alter table public.ai_call enable row level security;

revoke all on public.decision, public.triage_run, public.owner_rule, public.ai_call
  from anon, authenticated;
grant select on public.decision, public.triage_run, public.owner_rule, public.ai_call
  to authenticated;

-- Decisions follow request visibility, so a PM sees the decisions on their own requests.
create policy decision_read on public.decision
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (
      (select private.jwt_app_role()) = 'owner'
      or request_id in (select r.id from public.request r)
    )
  );

-- Engine scores, rules and AI costs: owner only.
create policy triage_run_read on public.triage_run
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (select private.jwt_app_role()) = 'owner'
  );

create policy owner_rule_read on public.owner_rule
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (select private.jwt_app_role()) = 'owner'
  );

create policy ai_call_read on public.ai_call
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (select private.jwt_app_role()) = 'owner'
  );
