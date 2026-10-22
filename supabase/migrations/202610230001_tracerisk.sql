-- Run once in Supabase SQL Editor. Existing TraceRisk tables/data are not dropped.
begin;
create table if not exists public.tracerisk_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object')
);
create table if not exists public.tracerisk_trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.tracerisk_workspaces(user_id) on delete cascade,
  revision integer not null default 1,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 4000000),
  next_check bigint not null default 0,
  watch_until bigint not null,
  lock_until bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists tracerisk_trips_owner on public.tracerisk_trips(user_id, created_at desc);
create index if not exists tracerisk_trips_due on public.tracerisk_trips(next_check,watch_until);
create table if not exists public.tracerisk_shares (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  trip uuid unique not null references public.tracerisk_trips(id) on delete cascade,
  user_id uuid not null references public.tracerisk_workspaces(user_id) on delete cascade,
  payload jsonb not null check (jsonb_typeof(payload)='object' and octet_length(payload::text) <= 4000000),
  expires bigint not null
);
alter table public.tracerisk_workspaces enable row level security;
alter table public.tracerisk_trips enable row level security;
alter table public.tracerisk_shares enable row level security;
drop policy if exists own_workspace on public.tracerisk_workspaces;
create policy own_workspace on public.tracerisk_workspaces to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists own_trips on public.tracerisk_trips;
create policy own_trips on public.tracerisk_trips to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
drop policy if exists own_shares on public.tracerisk_shares;
create policy own_shares on public.tracerisk_shares to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
-- Writes go through bounded, ownership-checked functions. Tables are never public.
revoke all on public.tracerisk_workspaces, public.tracerisk_trips, public.tracerisk_shares from anon, authenticated;

create or replace function public.tracerisk_decode(t public.tracerisk_trips) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select t.payload || jsonb_build_object('id',t.id,'revision',t.revision,
    'checking',t.lock_until > extract(epoch from now())*1000,
    'watchEnded',t.watch_until < extract(epoch from now())*1000,
    'nextCheckAt',case when t.next_check>0 then to_char(to_timestamp(t.next_check/1000.0) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') else null end);
$$;
revoke all on function public.tracerisk_decode(public.tracerisk_trips) from public, anon, authenticated;

create or replace function public.tracerisk_store(action text, args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  admin boolean := coalesce(auth.role()='service_role',false);
  owner uuid;
  ident uuid;
  row public.tracerisk_trips;
  val jsonb;
  merged jsonb;
  stamp bigint := floor(extract(epoch from clock_timestamp())*1000);
  due_at bigint;
  until_at bigint;
  changed integer;
  share_key text;
begin
  if actor is null and not admin then raise exception 'Sign in required' using errcode='42501'; end if;
  if action='due' then
    if not admin then raise exception 'Scheduler access denied' using errcode='42501'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('workspace',x.user_id,'id',x.id)) from
      (select user_id,id from public.tracerisk_trips where next_check>0 and next_check<=stamp and watch_until>=stamp and lock_until<=stamp order by next_check limit 10) x),'[]'::jsonb);
  end if;
  owner := coalesce(nullif(args->>'workspace','')::uuid,actor);
  if owner is null or (not admin and owner<>actor) then raise exception 'Workspace access denied' using errcode='42501'; end if;
  if action='workspace' then
    insert into public.tracerisk_workspaces(user_id,payload) values(owner,jsonb_build_object('id',owner,'agencyName','My travel desk','contact','','color','#28594a','createdAt',now())) on conflict do nothing;
    return (select payload || jsonb_build_object('id',owner) from public.tracerisk_workspaces where user_id=owner);
  end if;
  if action='updateWorkspace' then
    val:=args->'patch';
    if jsonb_typeof(val)<>'object' or octet_length(val::text)>2000 then raise exception 'Invalid workspace settings' using errcode='22023'; end if;
    update public.tracerisk_workspaces set payload=payload||jsonb_build_object('agencyName',left(coalesce(val->>'agencyName','My travel desk'),80),'contact',left(coalesce(val->>'contact',''),160),'color',case when val->>'color' ~ '^#[a-fA-F0-9]{6}$' then val->>'color' else '#28594a' end) where user_id=owner returning payload into merged;
    return merged || jsonb_build_object('id',owner);
  end if;
  if action='list' then
    return coalesce((select jsonb_agg(public.tracerisk_decode(x) order by x.created_at desc) from public.tracerisk_trips x where user_id=owner),'[]'::jsonb);
  end if;
  if action not in ('get','list') and not admin then raise exception 'Server access required for trip changes' using errcode='42501'; end if;
  if action='create' then
    -- Serialize creates per account so parallel requests cannot bypass the 50-trip cap.
    perform 1 from public.tracerisk_workspaces where user_id=owner for update;
    if not found then raise exception 'Open your workspace first' using errcode='22023'; end if;
    if (select count(*) from public.tracerisk_trips where user_id=owner)>=50 then raise exception 'This account can hold up to 50 trips' using errcode='22023'; end if;
    val:=args->'value';
    if jsonb_typeof(val)<>'object' or jsonb_typeof(val->'stops')<>'array' or jsonb_array_length(val->'stops') not between 1 and 6 then raise exception 'Invalid itinerary' using errcode='22023'; end if;
    ident:=coalesce(nullif(args->>'id','')::uuid,gen_random_uuid());
    until_at:=floor(extract(epoch from (((val->'stops'->-1->>'endDate')::date+time '23:59:59') at time zone 'UTC'))*1000);
    due_at:=case when val->'watch'->>'enabled'='true' then stamp else 0 end;
    insert into public.tracerisk_trips(id,user_id,payload,next_check,watch_until) values(ident,owner,val||jsonb_build_object('id',ident),due_at,until_at) returning * into row;
    return public.tracerisk_decode(row);
  end if;
  ident:=(args->>'id')::uuid;
  select * into row from public.tracerisk_trips where id=ident and user_id=owner for update;
  if not found then
    if action in ('get','remove','revoke','release') then return null; end if;
    raise exception 'Trip not found' using errcode='P0002';
  end if;
  if action='get' then return public.tracerisk_decode(row); end if;
  if action='remove' then delete from public.tracerisk_trips where id=ident and user_id=owner; return 'true'::jsonb; end if;
  if action in ('claim','claimLong') then
    if row.lock_until>stamp then return 'false'::jsonb; end if;
    update public.tracerisk_trips set lock_until=stamp+greatest(180000,least(600000,coalesce((args->>'leaseMs')::bigint,180000))) where id=ident and user_id=owner; return 'true'::jsonb;
  end if;
  if action='release' then update public.tracerisk_trips set lock_until=0 where id=ident and user_id=owner; return 'true'::jsonb; end if;
  if action='update' then
    if row.revision<>(args->>'revision')::integer then raise exception 'The trip changed. Refresh and try again.' using errcode='40001'; end if;
    val:=args->'patch';
    if jsonb_typeof(val)<>'object' then raise exception 'Invalid trip update' using errcode='22023'; end if;
    merged:=(row.payload||val)-'checking'-'revision'-'watchEnded';
    if jsonb_typeof(merged->'stops')<>'array' or jsonb_array_length(merged->'stops') not between 1 and 6 then raise exception 'Invalid itinerary' using errcode='22023'; end if;
    until_at:=floor(extract(epoch from (((merged->'stops'->-1->>'endDate')::date+time '23:59:59') at time zone 'UTC'))*1000);
    due_at:=case when merged->'watch'->>'enabled'='true' then case when val->>'nextCheckAt' is not null then floor(extract(epoch from (val->>'nextCheckAt')::timestamptz)*1000) else stamp+coalesce((merged->'watch'->>'frequencyHours')::bigint,6)*3600000 end else 0 end;
    update public.tracerisk_trips set payload=merged||jsonb_build_object('updatedAt',now()),revision=revision+1,next_check=due_at,watch_until=until_at where id=ident and user_id=owner returning * into row;
    return public.tracerisk_decode(row);
  end if;
  if action='revoke' then delete from public.tracerisk_shares where trip=ident and user_id=owner; return 'true'::jsonb; end if;
  if action='share' then
    share_key:=args->>'keyHash';
    if share_key !~ '^[a-f0-9]{64}$' or row.payload->'latest' is null or row.payload->'latest'='null'::jsonb then raise exception 'Complete a check before sharing' using errcode='22023'; end if;
    delete from public.tracerisk_shares where trip=ident and user_id=owner;
    insert into public.tracerisk_shares values(share_key,ident,owner,args->'snapshot',stamp+604800000);
    return jsonb_build_object('expiresAt',to_timestamp((stamp+604800000)/1000.0));
  end if;
  raise exception 'Unsupported operation' using errcode='22023';
end;
$$;
revoke all on function public.tracerisk_store(text,jsonb) from public, anon;
grant execute on function public.tracerisk_store(text,jsonb) to authenticated, service_role;

create or replace function public.tracerisk_read_share(key_hash text) returns jsonb
language sql security definer stable set search_path = public, pg_temp as $$
  select s.payload||jsonb_build_object('expiresAt',to_timestamp(s.expires/1000.0)) from public.tracerisk_shares s
  where s.key_hash=tracerisk_read_share.key_hash and tracerisk_read_share.key_hash ~ '^[a-f0-9]{64}$' and s.expires>extract(epoch from now())*1000;
$$;
revoke all on function public.tracerisk_read_share(text) from public;
grant execute on function public.tracerisk_read_share(text) to anon, authenticated, service_role;
commit;
