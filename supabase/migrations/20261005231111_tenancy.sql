-- Companies, sites, people, who works where, and messenger accounts.
-- Every row carries company_id. Children reference parents by (company_id, id), so a row
-- can never point at another company's row.

create table public.company (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  timezone text not null default 'Asia/Almaty',
  created_at timestamptz not null default now()
);

create table public.site (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  name text not null check (length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

create table public.person (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  role text not null constraint person_role_valid check (role in ('owner', 'deputy', 'pm')),
  display_name text not null check (length(display_name) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

-- Which people work on which sites. Used for site auto-pick and deputy scope.
create table public.site_member (
  company_id uuid not null references public.company (id),
  site_id uuid not null,
  person_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (company_id, site_id, person_id),
  foreign key (company_id, site_id) references public.site (company_id, id),
  foreign key (company_id, person_id) references public.person (company_id, id)
);
create index site_member_person_idx on public.site_member (company_id, person_id);

create table public.channel_identity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.company (id),
  person_id uuid not null,
  channel text not null constraint channel_identity_channel_valid
    check (channel in ('telegram', 'whatsapp')),
  external_id text not null,
  created_at timestamptz not null default now(),
  unique (channel, external_id),
  foreign key (company_id, person_id) references public.person (company_id, id)
);
create index channel_identity_person_idx on public.channel_identity (company_id, person_id);

-- Sites the current person is assigned to. Security definer so policies on site and
-- request can read site_member without recursing through its own RLS.
create function private.member_site_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.site_id
  from public.site_member sm
  where sm.company_id = private.jwt_company_id()
    and sm.person_id = private.jwt_person_id()
$$;
revoke execute on function private.member_site_ids() from public;
grant execute on function private.member_site_ids() to authenticated;

-- Access: clients read only; all writes go through the server.
alter table public.company enable row level security;
alter table public.site enable row level security;
alter table public.person enable row level security;
alter table public.site_member enable row level security;
alter table public.channel_identity enable row level security;

revoke all on public.company, public.site, public.person, public.site_member,
  public.channel_identity from anon, authenticated;
grant select on public.company, public.site, public.person, public.site_member,
  public.channel_identity to authenticated;

create policy company_read on public.company
  for select to authenticated
  using (id = (select private.jwt_company_id()));

create policy site_read on public.site
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (
      (select private.jwt_app_role()) = 'owner'
      or id in (select private.member_site_ids())
    )
  );

create policy person_read on public.person
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (
      (select private.jwt_app_role()) = 'owner'
      or id = (select private.jwt_person_id())
    )
  );

create policy site_member_read on public.site_member
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (
      (select private.jwt_app_role()) = 'owner'
      or person_id = (select private.jwt_person_id())
    )
  );

create policy channel_identity_read on public.channel_identity
  for select to authenticated
  using (
    company_id = (select private.jwt_company_id())
    and (
      (select private.jwt_app_role()) = 'owner'
      or person_id = (select private.jwt_person_id())
    )
  );
