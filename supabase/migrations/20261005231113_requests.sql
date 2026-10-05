-- Requests, the messages that make them up, and the append-only logbook (EVENT).
-- Value lists mirror packages/core (checked by packages/adapters/test/schema-sync.test.ts).

create table public.request (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  site_id uuid,
  pm_id uuid not null,
  type text constraint request_type_valid check (type in (
    'spend_approval', 'schedule_change', 'safety_incident', 'supply_problem',
    'quality_defect', 'design_change', 'staffing', 'info_report'
  )),
  status text not null default 'draft' constraint request_status_valid check (status in (
    'draft', 'structuring', 'clarifying', 'triage', 'merged', 'auto_handled',
    'awaiting_owner', 'in_progress', 'done', 'rejected', 'discarded'
  )),
  urgency smallint check (urgency between 1 and 5),
  amount_kzt bigint, -- integer KZT, hard rule 5
  decide_by timestamptz,
  lane text constraint request_lane_valid check (lane in ('interrupt', 'hot', 'digest', 'auto')),
  card jsonb,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, site_id) references public.site (company_id, id),
  foreign key (company_id, pm_id) references public.person (company_id, id)
);
create index request_status_idx on public.request (company_id, status);
create index request_pm_idx on public.request (company_id, pm_id);
create index request_site_idx on public.request (company_id, site_id);

create table public.message (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  person_id uuid not null,
  request_id uuid,
  channel text not null constraint message_channel_valid
    check (channel in ('telegram', 'whatsapp')),
  external_message_id text not null,
  kind text not null constraint message_kind_valid
    check (kind in ('text', 'voice', 'photo', 'document', 'video', 'other')),
  text text,
  transcript text,
  media_key text,
  received_at timestamptz not null default now(),
  -- The tracking-number rule: Telegram retries can never create a second row (hard rule 2).
  unique (channel, external_message_id),
  foreign key (company_id, person_id) references public.person (company_id, id),
  foreign key (company_id, request_id) references public.request (company_id, id)
);
create index message_request_idx on public.message (company_id, request_id);
create index message_person_idx on public.message (company_id, person_id);

-- The logbook. One row per request state change, written in the same transaction
-- (hard rule 4). No UPDATE, DELETE or TRUNCATE for anyone.
create table public.event (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.company (id),
  request_id uuid not null,
  type text not null,
  payload jsonb not null default '{}',
  at timestamptz not null default now(),
  foreign key (company_id, request_id) references public.request (company_id, id)
);
create index event_request_idx on public.event (company_id, request_id, at);

create trigger event_append_only
  before update or delete on public.event
  for each row execute function private.forbid_mutation();
create trigger event_no_truncate
  before truncate on public.event
  for each statement execute function private.forbid_mutation();

-- Access: clients read only.
alter table public.request enable row level security;
alter table public.message enable row level security;
alter table public.event enable row level security;

revoke all on public.request, public.message, public.event from anon, authenticated;
grant select on public.request, public.message, public.event to authenticated;

-- Owner: whole company. Deputy: assigned sites. PM: own requests.
create policy request_read on public.request
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (
      (select private.jwt_app_role()) = 'owner'
      or (
        (select private.jwt_app_role()) = 'deputy'
        and site_id in (select private.member_site_ids())
      )
      or (
        (select private.jwt_app_role()) = 'pm'
        and pm_id = (select private.jwt_person_id())
      )
    )
  );

-- Messages of visible requests (the subquery is itself filtered by request_read),
-- plus a PM's own messages that are not yet attached to a request.
create policy message_read on public.message
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (
      (select private.jwt_app_role()) = 'owner'
      or request_id in (select r.id from public.request r)
      or person_id = (select private.jwt_person_id())
    )
  );

create policy event_read on public.event
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (
      (select private.jwt_app_role()) = 'owner'
      or request_id in (select r.id from public.request r)
    )
  );
