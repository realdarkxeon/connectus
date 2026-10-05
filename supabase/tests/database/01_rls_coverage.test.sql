-- Tripwires for every current and future table in public (hard rule 6).
begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select is(
  array(
    select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    order by 1
  ),
  '{}'::text[],
  'every public table has row level security enabled'
);

select is(
  array(
    select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'company'
      and not exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
      )
    order by 1
  ),
  '{}'::text[],
  'every public table except company has a company_id column'
);

select is(
  array(
    select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate')
    order by 1
  ),
  '{}'::text[],
  'anon has no privileges on any public table'
);

select is(
  array(
    select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate')
    order by 1
  ),
  '{}'::text[],
  'authenticated can only read; all writes go through the server'
);

select * from finish();
rollback;
