-- Helpers used by RLS policies and triggers. They live in a private schema that the
-- Data API does not expose.
--
-- Identity ("the badge") comes from JWT claims in app_metadata, which users cannot edit:
--   app_metadata.company_id  uuid
--   app_metadata.person_id   uuid
--   app_metadata.app_role    owner | deputy | pm
-- Our server connects with a role that bypasses RLS; these policies govern client reads.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.jwt_company_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'company_id', '')::uuid
$$;

create function private.jwt_person_id()
returns uuid
language sql
stable
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'person_id', '')::uuid
$$;

create function private.jwt_app_role()
returns text
language sql
stable
set search_path = ''
as $$
  select auth.jwt() -> 'app_metadata' ->> 'app_role'
$$;

revoke execute on function private.jwt_company_id(), private.jwt_person_id(),
  private.jwt_app_role() from public;
grant execute on function private.jwt_company_id(), private.jwt_person_id(),
  private.jwt_app_role() to authenticated;

-- Trigger function for append-only tables (hard rule 4). It fires for every role,
-- including postgres and service_role.
create function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;
