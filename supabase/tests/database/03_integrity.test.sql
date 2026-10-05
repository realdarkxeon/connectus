-- Rules the database enforces even for the server's master key.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.company (id, name) values
  ('a0000000-0000-0000-0000-000000000000', 'A-Build'),
  ('b0000000-0000-0000-0000-000000000000', 'B-Stroy');
insert into public.site (id, company_id, name) values
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000000', 'B1');
insert into public.person (id, company_id, role, display_name) values
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'pm', 'Aibek');
insert into public.request (id, company_id, pm_id) values
  ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001');
insert into public.message (company_id, person_id, channel, external_message_id, kind) values
  ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'telegram', '1001', 'voice');
insert into public.event (company_id, request_id, type) values
  ('a0000000-0000-0000-0000-000000000000', 'a3000000-0000-0000-0000-000000000001', 'window_closed');

-- The logbook is locked.
select throws_ok($$ update public.event set type = 'owner_approved' $$, '42501', null,
  'a logbook entry cannot be edited, even by the server');
select throws_ok($$ delete from public.event $$, '42501', null,
  'a logbook entry cannot be deleted, even by the server');
select throws_ok($$ truncate public.event cascade $$, '42501', null,
  'the logbook cannot be truncated');

-- The tracking-number rule.
select throws_ok(
  $$ insert into public.message (company_id, person_id, channel, external_message_id, kind) values
     ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'telegram', '1001', 'voice') $$,
  '23505', null, 'a duplicate Telegram message is rejected'
);
select throws_ok(
  $$ insert into public.channel_identity (company_id, person_id, channel, external_id) values
     ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'telegram', 'tg-1'),
     ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'telegram', 'tg-1') $$,
  '23505', null, 'one Telegram account cannot belong to two people'
);

-- Telegram message ids repeat across chats, so the stored id is '<chat_id>:<message_id>'.
select lives_ok(
  $$ insert into public.message (company_id, person_id, channel, external_message_id, kind) values
     ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'telegram', '555:57', 'text'),
     ('a0000000-0000-0000-0000-000000000000', 'a2000000-0000-0000-0000-000000000001', 'telegram', '777:57', 'text') $$,
  'the same message number in two different chats is two messages'
);
select throws_ok(
  $$ insert into private.unrouted_message (channel, external_message_id, external_user_id, kind) values
     ('telegram', '999:1', '999', 'text'), ('telegram', '999:1', '999', 'text') $$,
  '23505', null, 'a duplicate message from an unknown sender is rejected'
);

-- The company-stamp rule on links.
select throws_ok(
  $$ insert into public.request (company_id, site_id, pm_id) values
     ('a0000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001') $$,
  '23503', null, 'a company A request cannot point at a company B site'
);

-- Allowed values only.
select throws_ok(
  $$ update public.request set status = 'flying' $$, '23514', null, 'unknown status is rejected');
select throws_ok(
  $$ update public.request set type = 'gossip' $$, '23514', null, 'unknown request type is rejected');
select throws_ok(
  $$ update public.request set urgency = 6 $$, '23514', null, 'urgency must be 1 to 5');

select * from finish();
rollback;
