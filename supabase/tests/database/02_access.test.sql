-- Who sees what (docs/architecture.md, Security). Fixtures:
-- Company A: owner, deputy (site A2), PM Aibek (site A1), PM Serik (site A2)
-- Company B: owner, one PM, one site
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into public.company (id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'A-Build'),
  ('b0000000-0000-0000-0000-000000000000', 'B-Stroy');
insert into public.site (id, company_id, name) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'A1'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'A2'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000000', 'B1');
insert into public.person (id, company_id, role, display_name) values
  ('a2000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-000000000000', 'owner', 'Owner A'),
  ('a2000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-000000000000', 'deputy', 'Deputy A'),
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'pm', 'Aibek'),
  ('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'pm', 'Serik'),
  ('b2000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-000000000000', 'owner', 'Owner B'),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000000', 'pm', 'PM B');
insert into public.site_member (company_id, site_id, person_id) values
  ('a0000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-00000000000d'),
  ('b0000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001');
insert into public.channel_identity (company_id, person_id, channel, external_id) values
  ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'telegram', 'tg-aibek'),
  ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000002', 'telegram', 'tg-serik'),
  ('b0000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000001', 'telegram', 'tg-pmb');
insert into public.request (id, company_id, site_id, pm_id, status) values
  ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'awaiting_owner'),
  ('a3000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000002', 'triage'),
  ('b3000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'in_progress');
insert into public.message (company_id, person_id, request_id, channel, external_message_id, kind) values
  ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'telegram', 'm1', 'voice'),
  ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', null, 'telegram', 'm2', 'text'),
  ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000002', 'telegram', 'm3', 'photo'),
  ('b0000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000001', 'telegram', 'm4', 'text');
insert into public.event (company_id, request_id, type) values
  ('a0000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000001', 'routed_to_owner'),
  ('a0000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000002', 'card_complete'),
  ('b0000000-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-000000000001', 'owner_approved');
insert into public.decision (company_id, request_id, owner_id, verdict) values
  ('a0000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', 'ask_more'),
  ('b0000000-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-00000000000a', 'approve');
insert into public.triage_run (company_id, request_id, engine, outputs, latency_ms) values
  ('a0000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000001', 'claude', '{}', 900),
  ('b0000000-0000-0000-0000-000000000000', 'b3000000-0000-0000-0000-000000000001', 'claude', '{}', 900);
insert into public.owner_rule (company_id, source_text, rule) values
  ('a0000000-0000-0000-0000-000000000000', 'материалы до 200 000 ₸ ПМ решает сам', '{}'),
  ('b0000000-0000-0000-0000-000000000000', 'rule B', '{}');
insert into public.ai_call (company_id, provider, model, purpose, latency_ms, cost_usd, ok) values
  ('a0000000-0000-0000-0000-000000000000', 'anthropic', 'claude-haiku-4-5-20251001', 'extract', 800, 0.000375, true),
  ('b0000000-0000-0000-0000-000000000000', 'anthropic', 'claude-haiku-4-5-20251001', 'extract', 800, 0.000375, true);

-- Put on a badge: switch to the authenticated role with the given JWT claims.
create function pg_temp.login_as(company uuid, person uuid, app_role text)
returns void
language sql
as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object(
           'sub', person, 'role', 'authenticated',
           'app_metadata', json_build_object(
             'company_id', company, 'person_id', person, 'app_role', app_role)
         )::text, true);
$$;

-- Owner A: everything in company A, nothing from B.
select pg_temp.login_as('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-00000000000a', 'owner');
select is((select count(*) from public.company), 1::bigint, 'owner A sees only company A');
select is((select count(*) from public.site), 2::bigint, 'owner A sees both A sites');
select is((select count(*) from public.person), 4::bigint, 'owner A sees all A people');
select is((select count(*) from public.site_member), 3::bigint, 'owner A sees all A memberships');
select is((select count(*) from public.channel_identity), 2::bigint, 'owner A sees A messenger accounts');
select is((select count(*) from public.request), 2::bigint, 'owner A sees both A requests');
select is((select count(*) from public.message), 3::bigint, 'owner A sees all A messages');
select is((select count(*) from public.event), 2::bigint, 'owner A sees the A logbook');
select is((select count(*) from public.decision), 1::bigint, 'owner A sees A decisions');
select is((select count(*) from public.triage_run), 1::bigint, 'owner A sees A triage runs');
select is((select count(*) from public.owner_rule), 1::bigint, 'owner A sees A rules');
select is((select count(*) from public.ai_call), 1::bigint, 'owner A sees A AI costs');
select is(
  (select count(*) from public.request where company_id = 'b0000000-0000-0000-0000-000000000000'),
  0::bigint, 'owner A cannot see B requests even when asking for them by company'
);

-- PM Aibek: own requests and their trail only.
select pg_temp.login_as('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'pm');
select is(array(select id::text from public.request), array['a3000000-0000-0000-0000-000000000001'], 'Aibek sees only his request');
select is((select count(*) from public.message), 2::bigint, 'Aibek sees his request messages and his unattached message');
select is((select count(*) from public.event), 1::bigint, 'Aibek sees the logbook of his request');
select is((select count(*) from public.decision), 1::bigint, 'Aibek sees the decision on his request');
select is((select count(*) from public.person), 1::bigint, 'Aibek sees only himself among people');
select is((select count(*) from public.site), 1::bigint, 'Aibek sees only his site');
select is((select count(*) from public.triage_run), 0::bigint, 'a PM cannot see triage runs');
select is((select count(*) from public.owner_rule), 0::bigint, 'a PM cannot see owner rules');
select is((select count(*) from public.ai_call), 0::bigint, 'a PM cannot see AI costs');

-- PM Serik: cannot see Aibek's request.
select pg_temp.login_as('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000002', 'pm');
select is(
  (select count(*) from public.request where id = 'a3000000-0000-0000-0000-000000000001'),
  0::bigint, 'Serik cannot see Aibek''s request'
);
select is((select count(*) from public.decision), 0::bigint, 'Serik cannot see the decision on Aibek''s request');

-- Deputy A: assigned site A2 only.
select pg_temp.login_as('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-00000000000d', 'deputy');
select is(array(select id::text from public.request), array['a3000000-0000-0000-0000-000000000002'], 'deputy sees only requests on assigned sites');
select is(array(select id::text from public.site), array['a1000000-0000-0000-0000-000000000002'], 'deputy sees only assigned sites');
select is((select count(*) from public.message), 1::bigint, 'deputy sees messages of visible requests');
select is((select count(*) from public.ai_call), 0::bigint, 'a deputy cannot see AI costs');

-- Owner B: sees B only.
select pg_temp.login_as('b0000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-00000000000a', 'owner');
select is(array(select id::text from public.request), array['b3000000-0000-0000-0000-000000000001'], 'owner B sees only B requests');
select is((select count(*) from public.ai_call), 1::bigint, 'owner B sees only B AI costs');

-- A badge from company A naming a company B person still sees nothing of B.
select pg_temp.login_as('a0000000-0000-0000-0000-000000000000', 'b2000000-0000-0000-0000-000000000001', 'pm');
select is((select count(*) from public.request), 0::bigint, 'a mismatched badge sees no requests');

-- Logged in without a company claim: sees nothing.
select set_config('request.jwt.claims', '{"sub":"x","role":"authenticated"}', true);
select is((select count(*) from public.request), 0::bigint, 'a badge without company sees no requests');
select is((select count(*) from public.company), 0::bigint, 'a badge without company sees no company');

-- Clients cannot write, even the owner.
select pg_temp.login_as('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-00000000000a', 'owner');
select throws_ok(
  $$ insert into public.request (company_id, pm_id) values
     ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'owner cannot insert requests directly'
);
select throws_ok(
  $$ update public.request set status = 'done' $$,
  '42501', null, 'owner cannot update requests directly'
);
select throws_ok($$ delete from public.message $$, '42501', null, 'owner cannot delete messages');

-- Not logged in at all.
select set_config('role', 'anon', true);
select throws_ok($$ select count(*) from public.request $$, '42501', null, 'anon cannot read requests');

select * from finish();
rollback;
