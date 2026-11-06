-- Run after gameplay-engine.sql and the world/travel migrations.
-- Player and NPC orders are collected against one unchanged world snapshot.
-- Resolution advances the shared world clock exactly once per global turn.

begin;

do $$
begin
  if to_regclass('public.gameplay_turns') is null
    or to_regclass('public.game_muster_orders') is null then
    raise exception
      'Run gameplay-engine.sql and world-state-schema.sql before global-turn-cycle.sql.';
  end if;
end
$$;

alter table public.world_state
  add column if not exists turn_phase text not null default 'planning'
    check (turn_phase in ('planning', 'resolving')),
  add column if not exists planning_deadline_at timestamptz not null
    default (now() + interval '48 hours'),
  add column if not exists resolution_started_at timestamptz,
  add column if not exists resolution_lease_token uuid,
  add column if not exists resolution_lease_owner text,
  add column if not exists resolution_lease_expires_at timestamptz,
  add column if not exists resolution_checkpoint jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'world_state_resolution_lease_complete_check'
      and conrelid = 'public.world_state'::regclass
  ) then
    alter table public.world_state
      add constraint world_state_resolution_lease_complete_check
      check (
        (resolution_lease_token is null
          and resolution_lease_owner is null
          and resolution_lease_expires_at is null)
        or
        (resolution_lease_token is not null
          and resolution_lease_owner is not null
          and resolution_lease_expires_at is not null)
      );
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'world_state_resolution_checkpoint_object_check'
      and conrelid = 'public.world_state'::regclass
  ) then
    alter table public.world_state
      add constraint world_state_resolution_checkpoint_object_check
      check (
        resolution_checkpoint is null
        or jsonb_typeof(resolution_checkpoint) = 'object'
      );
  end if;
end
$$;

create table if not exists public.playable_character_knowledge (
  character_id smallint not null
    references public.playable_characters(id) on delete cascade,
  fact_key text not null check (length(trim(fact_key)) > 0),
  knowledge_state text not null check (
    knowledge_state in ('knows', 'learned', 'suspects', 'misbelieves', 'forgotten')
  ),
  private_fact text,
  basis text,
  updated_at timestamptz not null default now(),
  primary key (character_id, fact_key)
);

alter table public.playable_character_knowledge
  add column if not exists knowledge_state text,
  add column if not exists private_fact text,
  add column if not exists basis text,
  add column if not exists updated_at timestamptz not null default now();

-- Existing knowledge tables may contain legacy states. Preserve those values:
-- the prompt projection only emits the five states it understands.
alter table public.playable_character_knowledge enable row level security;
revoke all on public.playable_character_knowledge from anon, authenticated;
grant select, insert, update, delete
  on public.playable_character_knowledge to service_role;

create table if not exists public.gameplay_turn_participants (
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  turn_number integer not null check (turn_number > 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  character_id integer not null
    references public.playable_characters(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (world_state_id, turn_number, user_id),
  unique (world_state_id, turn_number, character_id),
  unique (world_state_id, turn_number, user_id, character_id)
);

create table if not exists public.gameplay_turn_orders (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  turn_number integer not null check (turn_number > 0),
  user_id uuid not null,
  character_id integer not null,
  player_request text not null check (
    length(trim(player_request)) > 0 and length(player_request) <= 6000
  ),
  action_data jsonb not null check (
    jsonb_typeof(action_data) = 'array' and jsonb_array_length(action_data) = 1
  ),
  resolution_status text not null default 'pending'
    check (resolution_status in ('pending', 'accepted', 'rejected', 'pass')),
  resolution_note text,
  created_at timestamptz not null default now(),
  unique (world_state_id, turn_number, user_id),
  unique (world_state_id, turn_number, character_id),
  foreign key (world_state_id, turn_number, user_id, character_id)
    references public.gameplay_turn_participants(
      world_state_id, turn_number, user_id, character_id
    ) on delete cascade
);

create index if not exists gameplay_turn_orders_turn_status_idx
  on public.gameplay_turn_orders (world_state_id, turn_number, resolution_status);

create table if not exists public.gameplay_npc_orders (
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  turn_number integer not null check (turn_number > 0),
  character_id integer not null
    references public.playable_characters(id) on delete restrict,
  action_data jsonb check (
    action_data is null or (
      jsonb_typeof(action_data) = 'array' and jsonb_array_length(action_data) = 1
    )
  ),
  resolution_status text not null default 'pending'
    check (resolution_status in ('pending', 'proposed', 'accepted', 'rejected', 'pass')),
  resolution_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (world_state_id, turn_number, character_id)
);

create table if not exists public.gameplay_turn_resolutions (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  turn_number integer not null check (turn_number > 0),
  gameplay_revision bigint not null check (gameplay_revision > 0),
  event_id bigint not null references public.game_events(id) on delete restrict,
  canonical_summary text not null,
  resolution_data jsonb not null check (jsonb_typeof(resolution_data) = 'array'),
  resolved_at timestamptz not null default now(),
  unique (world_state_id, turn_number),
  unique (world_state_id, gameplay_revision)
);

create table if not exists public.gameplay_order_outcomes (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  turn_number integer not null check (turn_number > 0),
  actor_character_id integer not null
    references public.playable_characters(id) on delete restrict,
  original_order jsonb not null check (jsonb_typeof(original_order) = 'object'),
  decision_status text not null
    check (decision_status in ('accepted', 'rejected', 'pass')),
  execution_status text not null
    check (execution_status in (
      'not_attempted', 'attempted', 'executed', 'partially_executed', 'failed'
    )),
  adjudication_reason text not null,
  outcome_summary text not null,
  state_changes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(state_changes) = 'array'),
  character_knowledge jsonb not null default '{}'::jsonb
    check (jsonb_typeof(character_knowledge) = 'object'),
  event_id bigint not null references public.game_events(id) on delete restrict,
  resolved_at timestamptz not null default now(),
  unique (world_state_id, turn_number, actor_character_id)
);

create table if not exists public.gameplay_order_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);

alter table public.gameplay_turn_participants enable row level security;
alter table public.gameplay_turn_orders enable row level security;
alter table public.gameplay_npc_orders enable row level security;
alter table public.gameplay_turn_resolutions enable row level security;
alter table public.gameplay_order_outcomes enable row level security;
alter table public.gameplay_order_rate_limits enable row level security;

revoke all on public.gameplay_order_outcomes from public, anon, authenticated;
revoke all on public.gameplay_turn_participants, public.gameplay_turn_orders,
  public.gameplay_npc_orders, public.gameplay_turn_resolutions,
  public.gameplay_order_outcomes,
  public.gameplay_order_rate_limits
  from anon, authenticated;
grant select, insert, update, delete
  on public.gameplay_turn_participants, public.gameplay_turn_orders,
  public.gameplay_npc_orders, public.gameplay_turn_resolutions,
  public.gameplay_order_outcomes,
  public.gameplay_order_rate_limits
  to service_role;
grant usage, select on sequence
  public.gameplay_turn_orders_id_seq,
  public.gameplay_turn_resolutions_id_seq,
  public.gameplay_order_outcomes_id_seq
  to service_role;

insert into public.gameplay_turn_participants (
  world_state_id, turn_number, user_id, character_id
)
select 1, state.turn_number + 1, assignment.user_id, assignment.character_id
from public.world_state as state
cross join public.user_character_assignments as assignment
where state.id = 1
on conflict do nothing;

insert into public.gameplay_npc_orders (
  world_state_id, turn_number, character_id
)
select 1, state.turn_number + 1, character.id
from public.world_state as state
cross join public.playable_characters as character
where state.id = 1
  and not exists (
    select 1 from public.user_character_assignments as assignment
    where assignment.character_id = character.id
  )
on conflict do nothing;

create or replace function public.preflight_game_order(
  p_user_id uuid,
  p_request_id uuid,
  p_player_request text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  actor_id integer;
  rate_window_started_at timestamptz;
  request_count integer;
  check_time timestamptz;
  request_limit constant integer := 5;
  window_duration constant interval := interval '10 minutes';
begin
  if p_user_id is null or p_request_id is null
    or length(trim(coalesce(p_player_request, ''))) = 0
    or length(p_player_request) > 6000 then
    raise exception 'GAME_INVALID_REQUEST: User, request ID, and a 1-6000 character order are required.';
  end if;

  select assignment.character_id into actor_id
  from public.user_character_assignments as assignment
  where assignment.user_id = p_user_id;
  if not found then
    raise exception 'GAME_NOT_ASSIGNED: The player has no assigned character.';
  end if;

  select * into world
  from public.world_state
  where id = 1
  for share;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;
  check_time := clock_timestamp();
  if world.turn_phase <> 'planning' or check_time >= world.planning_deadline_at then
    raise exception 'GAME_TURN_CLOSED: The planning window is closed.';
  end if;
  if exists (
    select 1 from public.gameplay_turn_resolutions as resolution
    where resolution.world_state_id = 1
      and resolution.turn_number = world.turn_number + 1
  ) then
    raise exception 'GAME_TURN_CLOSED: This world turn has already been resolved.';
  end if;
  if not exists (
    select 1 from public.gameplay_turn_participants as participant
    where participant.world_state_id = 1
      and participant.turn_number = world.turn_number + 1
      and participant.user_id = p_user_id
      and participant.character_id = actor_id
  ) then
    raise exception 'GAME_NOT_ASSIGNED: The character is not a participant in this world turn.';
  end if;
  if exists (
    select 1 from public.gameplay_turn_orders as order_row
    where order_row.world_state_id = 1
      and order_row.turn_number = world.turn_number + 1
      and (order_row.user_id = p_user_id or order_row.request_id = p_request_id)
  ) then
    raise exception 'GAME_ALREADY_SUBMITTED: This player already submitted an order for the world turn.';
  end if;

  insert into public.gameplay_order_rate_limits (
    user_id, window_started_at, request_count
  )
  values (p_user_id, now(), 0)
  on conflict (user_id) do nothing;

  select limiter.window_started_at, limiter.request_count
  into rate_window_started_at, request_count
  from public.gameplay_order_rate_limits as limiter
  where limiter.user_id = p_user_id
  for update;

  if rate_window_started_at <= now() - window_duration then
    rate_window_started_at := now();
    request_count := 0;
  end if;
  if request_count >= request_limit then
    raise exception 'GAME_RATE_LIMIT: Too many order attempts. Try again in a few minutes.';
  end if;

  update public.gameplay_order_rate_limits
  set window_started_at = rate_window_started_at,
      request_count = request_count + 1,
      updated_at = now()
  where user_id = p_user_id;

  return jsonb_build_object(
    'characterId', actor_id,
    'turnNumber', world.turn_number + 1,
    'revision', world.gameplay_revision,
    'deadlineAt', world.planning_deadline_at,
    'rateLimit', request_limit,
    'rateWindowSeconds', extract(epoch from window_duration)::integer
  );
end
$$;

create or replace function public.submit_game_order(
  p_user_id uuid,
  p_character_id integer,
  p_request_id uuid,
  p_expected_revision bigint,
  p_player_request text,
  p_action_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  participant public.gameplay_turn_participants%rowtype;
  existing_order public.gameplay_turn_orders%rowtype;
  submitted_count integer;
  required_count integer;
  check_time timestamptz;
begin
  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;
  check_time := clock_timestamp();

  select * into existing_order
  from public.gameplay_turn_orders
  where request_id = p_request_id;
  if found then
    if existing_order.user_id <> p_user_id
      or existing_order.character_id <> p_character_id
      or existing_order.player_request <> p_player_request then
      raise exception 'GAME_INVALID_REQUEST: Request ID was already used.';
    end if;
    select count(*) into required_count
    from public.gameplay_turn_participants
    where world_state_id = existing_order.world_state_id
      and turn_number = existing_order.turn_number;
    select count(*) into submitted_count
    from public.gameplay_turn_orders
    where world_state_id = existing_order.world_state_id
      and turn_number = existing_order.turn_number;
    return jsonb_build_object(
      'turnNumber', existing_order.turn_number,
      'resolutionStatus', existing_order.resolution_status,
      'submittedAt', existing_order.created_at,
      'submittedCount', submitted_count,
      'requiredCount', required_count,
      'deadlineAt', world.planning_deadline_at,
      'revision', world.gameplay_revision,
      'idempotent', true
    );
  end if;

  if world.turn_phase <> 'planning' then
    raise exception 'GAME_TURN_CLOSED: The world turn is being resolved.';
  end if;
  if check_time >= world.planning_deadline_at then
    raise exception 'GAME_DEADLINE: The order deadline has passed.';
  end if;
  if p_expected_revision is null
    or world.gameplay_revision <> p_expected_revision then
    raise exception 'GAME_STALE_STATE: The world changed during the planning phase.';
  end if;
  if p_user_id is null or p_character_id is null or p_request_id is null
    or length(trim(coalesce(p_player_request, ''))) = 0
    or length(p_player_request) > 6000
    or jsonb_typeof(p_action_data) is distinct from 'array'
    or jsonb_array_length(p_action_data) <> 1
    or jsonb_typeof(p_action_data -> 0) <> 'object'
    or coalesce((p_action_data -> 0 ->> 'actorCharacterId')::integer, 0) <> p_character_id then
    raise exception 'GAME_INVALID_REQUEST: A player order must contain exactly one action for its assigned character.';
  end if;

  select * into participant
  from public.gameplay_turn_participants
  where world_state_id = 1
    and turn_number = world.turn_number + 1
    and user_id = p_user_id
    and character_id = p_character_id;
  if not found then
    raise exception 'GAME_NOT_ASSIGNED: The character is not a participant in this world turn.';
  end if;
  if not exists (
    select 1 from public.user_character_assignments as assignment
    where assignment.user_id = p_user_id
      and assignment.character_id = p_character_id
  ) then
    raise exception 'GAME_NOT_ASSIGNED: The character is no longer assigned to this player.';
  end if;
  if exists (
    select 1 from public.gameplay_turn_orders as order_row
    where order_row.world_state_id = 1
      and order_row.turn_number = world.turn_number + 1
      and order_row.user_id = p_user_id
  ) then
    raise exception 'GAME_ALREADY_SUBMITTED: This player already submitted an order for the world turn.';
  end if;

  insert into public.gameplay_turn_orders (
    request_id, world_state_id, turn_number, user_id, character_id,
    player_request, action_data
  )
  values (
    p_request_id, 1, world.turn_number + 1, p_user_id, p_character_id,
    p_player_request, p_action_data
  );

  select count(*) into required_count
  from public.gameplay_turn_participants
  where world_state_id = 1 and turn_number = world.turn_number + 1;
  select count(*) into submitted_count
  from public.gameplay_turn_orders
  where world_state_id = 1 and turn_number = world.turn_number + 1;

  return jsonb_build_object(
    'turnNumber', world.turn_number + 1,
    'resolutionStatus', 'pending',
    'submittedAt', now(),
    'submittedCount', submitted_count,
    'requiredCount', required_count,
    'deadlineAt', world.planning_deadline_at,
    'idempotent', false
  );
end
$$;

drop function if exists public.claim_game_turn_resolution();
drop function if exists public.save_npc_game_orders(integer, jsonb);
drop function if exists public.release_game_turn_resolution(integer);
drop function if exists public.resolve_game_turn(
  integer, bigint, jsonb, text, text, text
);
drop function if exists public.claim_game_turn_resolution(text, integer);
drop function if exists public.renew_game_turn_resolution(integer, uuid, text, integer);
drop function if exists public.save_npc_game_orders(integer, uuid, text, jsonb);
drop function if exists public.save_game_turn_checkpoint(integer, uuid, text, jsonb);
drop function if exists public.release_game_turn_resolution(integer, uuid, text);
drop function if exists public.resolve_game_turn(
  integer, bigint, uuid, text, jsonb, text, text, text
);

create function public.claim_game_turn_resolution(
  p_lease_owner text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  required_count integer;
  submitted_count integer;
  lease_token uuid;
  lease_now timestamptz;
begin
  if length(trim(coalesce(p_lease_owner, ''))) = 0
    or length(p_lease_owner) > 160
    or p_lease_seconds is null
    or p_lease_seconds < 30
    or p_lease_seconds > 300 then
    raise exception 'GAME_INVALID_REQUEST: A lease owner and duration from 30 to 300 seconds are required.';
  end if;

  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;

  select count(*) into required_count
  from public.gameplay_turn_participants
  where world_state_id = 1 and turn_number = world.turn_number + 1;
  select count(*) into submitted_count
  from public.gameplay_turn_orders
  where world_state_id = 1 and turn_number = world.turn_number + 1;
  lease_now := clock_timestamp();

  if world.turn_phase = 'resolving' then
    if world.resolution_lease_expires_at is not null
      and world.resolution_lease_expires_at > lease_now then
      return jsonb_build_object(
        'claimed', false,
        'turnNumber', world.turn_number + 1,
        'phase', world.turn_phase,
        'deadlineAt', world.planning_deadline_at,
        'leaseExpiresAt', world.resolution_lease_expires_at
      );
    end if;
  elsif required_count = 0
    or (submitted_count < required_count and lease_now < world.planning_deadline_at) then
    return jsonb_build_object(
      'claimed', false,
      'turnNumber', world.turn_number + 1,
      'phase', world.turn_phase,
      'submittedCount', submitted_count,
      'requiredCount', required_count,
      'deadlineAt', world.planning_deadline_at
    );
  end if;

  lease_token := gen_random_uuid();
  update public.world_state
  set turn_phase = 'resolving',
      resolution_started_at = lease_now,
      resolution_lease_token = lease_token,
      resolution_lease_owner = p_lease_owner,
      resolution_lease_expires_at = lease_now + make_interval(secs => p_lease_seconds),
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'claimed', true,
    'turnNumber', world.turn_number + 1,
    'revision', world.gameplay_revision,
    'deadlineAt', world.planning_deadline_at,
    'leaseToken', lease_token,
    'leaseOwner', p_lease_owner,
    'leaseExpiresAt', lease_now + make_interval(secs => p_lease_seconds),
    'checkpoint', world.resolution_checkpoint
  );
end
$$;

create function public.renew_game_turn_resolution(
  p_turn_number integer,
  p_lease_token uuid,
  p_lease_owner text,
  p_lease_seconds integer default 120
)
returns timestamptz
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  new_expiry timestamptz;
  lease_now timestamptz;
begin
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 300 then
    raise exception 'GAME_INVALID_REQUEST: Lease duration must be from 30 to 300 seconds.';
  end if;

  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;
  lease_now := clock_timestamp();
  if world.turn_phase <> 'resolving'
    or world.turn_number + 1 <> p_turn_number
    or world.resolution_lease_token is distinct from p_lease_token
    or world.resolution_lease_owner is distinct from p_lease_owner
    or world.resolution_lease_expires_at is null
    or world.resolution_lease_expires_at <= lease_now then
    raise exception 'GAME_LEASE_LOST: The resolution lease is expired or belongs to another worker.';
  end if;

  update public.world_state
  set resolution_lease_expires_at = lease_now + make_interval(secs => p_lease_seconds),
      resolution_started_at = lease_now,
      updated_at = now()
  where id = 1
  returning resolution_lease_expires_at into new_expiry;

  if new_expiry is null then
    raise exception 'GAME_LEASE_LOST: The resolution lease is expired or belongs to another worker.';
  end if;
  return new_expiry;
end
$$;

create function public.save_npc_game_orders(
  p_turn_number integer,
  p_lease_token uuid,
  p_lease_owner text,
  p_orders jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  order_row jsonb;
  actor_id integer;
  v_action_data jsonb;
  saved_count integer := 0;
  existing_action jsonb;
  lease_now timestamptz;
begin
  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;
  lease_now := clock_timestamp();
  if world.turn_phase <> 'resolving'
    or p_turn_number <> world.turn_number + 1
    or world.resolution_lease_token is distinct from p_lease_token
    or world.resolution_lease_owner is distinct from p_lease_owner
    or world.resolution_lease_expires_at is null
    or world.resolution_lease_expires_at <= lease_now then
    raise exception 'GAME_LEASE_LOST: The NPC-order worker does not hold the active resolution lease.';
  end if;
  if jsonb_typeof(p_orders) is distinct from 'array' then
    raise exception 'GAME_INVALID_REQUEST: NPC orders must be a JSON array.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_orders) as item(value)
    group by (item.value ->> 'actorCharacterId')::integer
    having count(*) > 1
  ) then
    raise exception 'GAME_INVALID_REQUEST: An AI character received duplicate proposed orders.';
  end if;

  for order_row in select value from jsonb_array_elements(p_orders)
  loop
    actor_id := (order_row ->> 'actorCharacterId')::integer;
    v_action_data := order_row -> 'actionData';
    if actor_id is null
      or jsonb_typeof(v_action_data) is distinct from 'array'
      or jsonb_array_length(v_action_data) <> 1
      or jsonb_typeof(v_action_data -> 0) <> 'object'
      or coalesce((v_action_data -> 0 ->> 'actorCharacterId')::integer, 0) <> actor_id then
      raise exception 'GAME_INVALID_REQUEST: An NPC order must contain exactly one action for its actor.';
    end if;
    select npc.action_data into existing_action
    from public.gameplay_npc_orders as npc
    where npc.world_state_id = 1
      and npc.turn_number = p_turn_number
      and npc.character_id = actor_id
    for update;
    if not found then
      raise exception 'GAME_INVALID_REQUEST: NPC character % is not assigned to the AI for this turn.', actor_id;
    end if;
    if existing_action is null then
      update public.gameplay_npc_orders
      set action_data = v_action_data,
          resolution_status = 'proposed',
          updated_at = now()
      where world_state_id = 1
        and turn_number = p_turn_number
        and character_id = actor_id;
      saved_count := saved_count + 1;
    elsif existing_action <> v_action_data then
      raise exception 'GAME_INVALID_REQUEST: An NPC order was already recorded for character %.', actor_id;
    end if;
  end loop;

  return saved_count;
end
$$;

create function public.save_game_turn_checkpoint(
  p_turn_number integer,
  p_lease_token uuid,
  p_lease_owner text,
  p_checkpoint jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  lease_now timestamptz;
begin
  if jsonb_typeof(p_checkpoint) is distinct from 'object' then
    raise exception 'GAME_INVALID_REQUEST: The resolution checkpoint must be a JSON object.';
  end if;
  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;
  lease_now := clock_timestamp();
  if world.turn_phase <> 'resolving'
    or world.turn_number + 1 <> p_turn_number
    or world.resolution_lease_token is distinct from p_lease_token
    or world.resolution_lease_owner is distinct from p_lease_owner
    or world.resolution_lease_expires_at is null
    or world.resolution_lease_expires_at <= lease_now then
    raise exception 'GAME_LEASE_LOST: The resolution checkpoint worker does not hold the active lease.';
  end if;
  update public.world_state
  set resolution_checkpoint = p_checkpoint,
      updated_at = now()
  where id = 1;
end
$$;

create function public.release_game_turn_resolution(
  p_turn_number integer,
  p_lease_token uuid,
  p_lease_owner text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  lease_now timestamptz;
begin
  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;
  lease_now := clock_timestamp();
  if world.turn_phase <> 'resolving'
    or world.turn_number + 1 <> p_turn_number
    or world.resolution_lease_token is distinct from p_lease_token
    or world.resolution_lease_owner is distinct from p_lease_owner
    or world.resolution_lease_expires_at is null
    or world.resolution_lease_expires_at <= lease_now then
    raise exception 'GAME_LEASE_LOST: The worker cannot release a lease it no longer owns.';
  end if;
  update public.world_state
  set resolution_started_at = null,
      resolution_lease_token = null,
      resolution_lease_owner = null,
      resolution_lease_expires_at = null,
      updated_at = now()
  where id = 1;
end
$$;

create function public.resolve_game_turn(
  p_turn_number integer,
  p_expected_revision bigint,
  p_lease_token uuid,
  p_lease_owner text,
  p_decisions jsonb,
  p_event_title text,
  p_event_type text,
  p_canonical_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  existing_resolution public.gameplay_turn_resolutions%rowtype;
  decision_row jsonb;
  actor_id integer;
  decision_status text;
  action_data jsonb;
  event_knowledge jsonb := '{}'::jsonb;
  committed_actions jsonb;
  resolution_result jsonb;
  outcome_data jsonb := '[]'::jsonb;
  outcome_row jsonb;
  original_action jsonb;
  event_state_changes jsonb;
  actor_state_changes jsonb;
  outcome_summary text;
  resolved_summary text;
  execution_status text;
  action_executed boolean;
  actor_house_id bigint;
  resolved_outcome_data jsonb := '[]'::jsonb;
  political_outcome record;
  required_count integer;
  provided_count integer;
  event_id bigint;
  resolution_id bigint;
  request_id uuid;
  order_message text;
  lease_now timestamptz;
begin
  select * into existing_resolution
  from public.gameplay_turn_resolutions
  where world_state_id = 1
    and turn_number = p_turn_number;
  if found then
    return jsonb_build_object(
      'status', 'resolved',
      'resolvedTurn', existing_resolution.turn_number,
      'revision', existing_resolution.gameplay_revision,
      'eventId', existing_resolution.event_id,
      'resolutionId', existing_resolution.id,
      'idempotent', true
    );
  end if;

  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;
  lease_now := clock_timestamp();
  if world.turn_phase <> 'resolving'
    or p_turn_number <> world.turn_number + 1
    or world.resolution_lease_token is distinct from p_lease_token
    or world.resolution_lease_owner is distinct from p_lease_owner
    or world.resolution_lease_expires_at is null
    or world.resolution_lease_expires_at <= lease_now then
    raise exception 'GAME_LEASE_LOST: The worker does not hold the active lease for this turn.';
  end if;
  if p_expected_revision is null
    or world.gameplay_revision <> p_expected_revision then
    raise exception 'GAME_STALE_STATE: The world changed before resolution.';
  end if;
  if length(trim(coalesce(p_event_title, ''))) = 0 or length(p_event_title) > 160
    or length(trim(coalesce(p_canonical_summary, ''))) = 0
    or length(p_canonical_summary) > 4000
    or p_event_type is null
    or p_event_type not in (
      'political', 'military', 'personal', 'movement', 'information',
      'promise', 'decision', 'other'
    ) then
    raise exception 'GAME_INVALID_REQUEST: The generated world-turn summary is invalid.';
  end if;
  if jsonb_typeof(p_decisions) is distinct from 'array' then
    raise exception 'GAME_INVALID_REQUEST: World-turn decisions must be a JSON array.';
  end if;

  if lease_now >= world.planning_deadline_at then
    insert into public.gameplay_turn_orders (
      request_id, world_state_id, turn_number, user_id, character_id,
      player_request, action_data, resolution_status, resolution_note
    )
    select
      md5('global-turn-pass:' || participant.turn_number || ':' || participant.user_id)::uuid,
      participant.world_state_id,
      participant.turn_number,
      participant.user_id,
      participant.character_id,
      'No order was submitted before the planning deadline; automatic pass.',
      jsonb_build_array(jsonb_build_object(
        'type', 'wait',
        'actorCharacterId', participant.character_id,
        'reason', 'No order was submitted before the planning deadline.'
      )),
      'pass',
      'Automatic pass after the planning deadline.'
    from public.gameplay_turn_participants as participant
    where participant.world_state_id = 1
      and participant.turn_number = p_turn_number
      and not exists (
        select 1 from public.gameplay_turn_orders as existing
        where existing.world_state_id = participant.world_state_id
          and existing.turn_number = participant.turn_number
          and existing.user_id = participant.user_id
      )
    on conflict do nothing;
  end if;

  if exists (
    select 1 from public.gameplay_turn_participants as participant
    where participant.world_state_id = 1
      and participant.turn_number = p_turn_number
      and not exists (
        select 1 from public.gameplay_turn_orders as order_row
        where order_row.world_state_id = participant.world_state_id
          and order_row.turn_number = participant.turn_number
          and order_row.user_id = participant.user_id
      )
  ) then
    raise exception 'GAME_INVALID_REQUEST: The planning deadline has not passed and player orders are incomplete.';
  end if;
  if exists (
    select 1 from public.gameplay_npc_orders as npc
    where npc.world_state_id = 1
      and npc.turn_number = p_turn_number
      and (npc.action_data is null or npc.resolution_status <> 'proposed')
  ) then
    raise exception 'GAME_INVALID_REQUEST: NPC decisions are not complete.';
  end if;

  select
    (select count(*) from public.gameplay_turn_participants
      where world_state_id = 1 and turn_number = p_turn_number)
    +
    (select count(*) from public.gameplay_npc_orders
      where world_state_id = 1 and turn_number = p_turn_number)
  into required_count;
  provided_count := jsonb_array_length(p_decisions);
  if provided_count <> required_count then
    raise exception 'GAME_INVALID_REQUEST: The master resolution must decide every player and NPC order exactly once.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_decisions) as item(value)
    group by (item.value ->> 'actorCharacterId')::integer
    having count(*) > 1
  ) then
    raise exception 'GAME_INVALID_REQUEST: A character received duplicate master decisions.';
  end if;
  if exists (
    select 1 from public.gameplay_turn_participants as participant
    where participant.world_state_id = 1
      and participant.turn_number = p_turn_number
      and not exists (
        select 1 from jsonb_array_elements(p_decisions) as item(value)
        where (item.value ->> 'actorCharacterId')::integer = participant.character_id
      )
  ) or exists (
    select 1 from public.gameplay_npc_orders as npc
    where npc.world_state_id = 1
      and npc.turn_number = p_turn_number
      and not exists (
        select 1 from jsonb_array_elements(p_decisions) as item(value)
        where (item.value ->> 'actorCharacterId')::integer = npc.character_id
      )
  ) then
    raise exception 'GAME_INVALID_REQUEST: The master resolution omitted an order.';
  end if;

  for decision_row in select value from jsonb_array_elements(p_decisions)
  loop
    actor_id := (decision_row ->> 'actorCharacterId')::integer;
    decision_status := decision_row ->> 'decision';
    if decision_status not in ('accept', 'reject')
      or length(trim(coalesce(decision_row ->> 'reason', ''))) = 0
      or length(decision_row ->> 'reason') > 1000 then
      raise exception 'GAME_INVALID_REQUEST: A master decision has an invalid status or reason.';
    end if;

    select order_row.action_data into action_data
    from public.gameplay_turn_orders as order_row
    where order_row.world_state_id = 1
      and order_row.turn_number = p_turn_number
      and order_row.character_id = actor_id;
    if not found then
      select npc.action_data into action_data
      from public.gameplay_npc_orders as npc
      where npc.world_state_id = 1
        and npc.turn_number = p_turn_number
        and npc.character_id = actor_id;
    end if;
    if action_data is null then
      raise exception 'GAME_INVALID_REQUEST: No submitted order exists for character %.', actor_id;
    end if;

    if action_data -> 0 ->> 'type' = 'wait' then
      decision_status := 'pass';
      order_message := 'The character passed for this global turn.';
    elsif decision_status = 'accept' then
      order_message := 'The character order was accepted for this global turn.';
    else
      order_message := 'The character order was not accepted for this global turn.';
    end if;

    update public.gameplay_turn_orders
    set resolution_status = decision_status,
        resolution_note = decision_row ->> 'reason'
    where world_state_id = 1
      and turn_number = p_turn_number
      and character_id = actor_id;
    update public.gameplay_npc_orders
    set resolution_status = decision_status,
        resolution_note = decision_row ->> 'reason',
        updated_at = now()
    where world_state_id = 1
      and turn_number = p_turn_number
      and character_id = actor_id;
    event_knowledge := event_knowledge || jsonb_build_object(actor_id::text, order_message);
    outcome_data := outcome_data || jsonb_build_array(jsonb_build_object(
      'actorCharacterId', actor_id,
      'decision', decision_status,
      'reason', decision_row ->> 'reason',
      'action', action_data -> 0
    ));
    action_data := null;
  end loop;

  select jsonb_agg(accepted.action order by accepted.actor_id)
  into committed_actions
  from (
    select order_row.character_id as actor_id, order_row.action_data -> 0 as action
    from public.gameplay_turn_orders as order_row
    where order_row.world_state_id = 1
      and order_row.turn_number = p_turn_number
      and order_row.resolution_status = 'accepted'
      and order_row.action_data -> 0 ->> 'type' <> 'political_action'
    union all
    select npc.character_id as actor_id, npc.action_data -> 0 as action
    from public.gameplay_npc_orders as npc
    where npc.world_state_id = 1
      and npc.turn_number = p_turn_number
      and npc.resolution_status = 'accepted'
      and npc.action_data -> 0 ->> 'type' <> 'political_action'
  ) as accepted;
  committed_actions := coalesce(committed_actions, '[]'::jsonb);

  if not exists (
    select 1
    from public.gameplay_turn_participants as participant
    where participant.world_state_id = 1
      and participant.turn_number = p_turn_number
  ) then
    raise exception 'GAME_INVALID_REQUEST: A shared world turn requires at least one player.';
  end if;
  request_id := md5('global-turn-resolution:' || p_turn_number)::uuid;

  resolution_result := public.commit_game_turn(
    null,
    null,
    request_id,
    p_expected_revision,
    'Shared global world turn ' || p_turn_number || ' resolution.',
    p_canonical_summary,
    p_event_title,
    p_event_type,
    p_canonical_summary,
    event_knowledge,
    committed_actions
  );
  event_id := (resolution_result ->> 'eventId')::bigint;
  select event.state_changes into event_state_changes
  from public.game_events as event
  where event.id = event_id;
  if event_state_changes is null then
    raise exception 'GAME_RESOLUTION_FAILED: The committed event has no authoritative state changes.';
  end if;

  insert into public.gameplay_turn_resolutions (
    world_state_id, turn_number, gameplay_revision,
    event_id, canonical_summary, resolution_data
  )
  values (
    1, p_turn_number, (resolution_result ->> 'revision')::bigint,
    event_id, p_canonical_summary, outcome_data
  )
  returning id into resolution_id;

  for outcome_row in
    select item.value from jsonb_array_elements(outcome_data) as item(value)
  loop
    actor_id := (outcome_row ->> 'actorCharacterId')::integer;
    original_action := outcome_row -> 'action';
    decision_status := outcome_row ->> 'decision';
    actor_state_changes := '[]'::jsonb;
    action_executed := false;

    if decision_status = 'pass' then
      execution_status := 'not_attempted';
      outcome_summary := 'No action was taken during this world turn.';
      select coalesce(jsonb_agg(change.value order by change.ordinality), '[]'::jsonb)
      into actor_state_changes
      from jsonb_array_elements(event_state_changes)
        with ordinality as change(value, ordinality)
      where change.value #>> '{target,type}' = 'character'
        and change.value #>> '{target,id}' = actor_id::text;
    elsif decision_status = 'rejected' then
      execution_status := 'failed';
      outcome_summary := 'The order was not carried out during this world turn.';
      select coalesce(jsonb_agg(change.value order by change.ordinality), '[]'::jsonb)
      into actor_state_changes
      from jsonb_array_elements(event_state_changes)
        with ordinality as change(value, ordinality)
      where change.value #>> '{target,type}' = 'character'
        and change.value #>> '{target,id}' = actor_id::text;
    elsif original_action ->> 'type' = 'political_action' then
      select political.execution_status, political.consequence
      into political_outcome
      from public.political_action_outcomes as political
      where political.world_state_id = 1
        and political.turn_number = p_turn_number
        and political.actor_character_id = actor_id;

      if found then
        execution_status := political_outcome.execution_status;
        action_executed := political_outcome.execution_status = 'executed';
        outcome_summary := political_outcome.consequence;
        actor_state_changes := jsonb_build_array(jsonb_build_object(
          'changeType', 'political_action_outcome',
          'description', political_outcome.consequence,
          'structuredChange', jsonb_build_object(
            'executionStatus', political_outcome.execution_status,
            'authorityStatus', political_outcome.authority_status
          )
        ));
      else
        execution_status := 'attempted';
        outcome_summary :=
          'The order was accepted as an attempt; no political outcome was recorded.';
      end if;
    else
      select coalesce(character.current_house_id, character.starting_house_id)
      into actor_house_id
      from public.playable_characters as character
      where character.id = actor_id;

      select coalesce(jsonb_agg(change.value order by change.ordinality), '[]'::jsonb)
      into actor_state_changes
      from jsonb_array_elements(event_state_changes)
        with ordinality as change(value, ordinality)
      where (
        change.value #>> '{target,type}' = 'character'
        and change.value #>> '{target,id}' = actor_id::text
      ) or (
        original_action ->> 'type' = 'muster'
        and change.value ->> 'changeType' = 'military_muster_ordered'
        and change.value #>> '{target,id}' = actor_house_id::text
        and change.value #>> '{structuredChange,region_id}' = original_action ->> 'regionId'
        and change.value #>> '{structuredChange,force_size}' = original_action ->> 'forceSize'
      ) or (
        original_action ->> 'type' = 'muster'
        and change.value ->> 'changeType' = 'muster_completed'
        and change.value #>> '{target,id}' = actor_house_id::text
        and change.value #>> '{structuredChange,force_size}' = original_action ->> 'forceSize'
        and exists (
          select 1
          from public.game_muster_orders as muster
          where muster.id =
            (change.value #>> '{structuredChange,muster_order_id}')::bigint
            and muster.requested_by_character_id = actor_id
            and muster.region_id = (original_action ->> 'regionId')::smallint
        )
      ) or (
        original_action ->> 'type' = 'diplomacy_propose'
        and change.value ->> 'changeType' = 'diplomacy_proposed'
        and change.value #>> '{structuredChange,relation_type}' = original_action ->> 'relationType'
        and change.value #>> '{structuredChange,house_a_id}' = actor_house_id::text
        and change.value #>> '{structuredChange,house_b_id}' = original_action ->> 'targetHouseId'
      ) or (
        original_action ->> 'type' = 'diplomacy_resolve'
        and change.value ->> 'changeType' = 'diplomacy_resolved'
        and change.value #>> '{target,id}' = original_action ->> 'diplomacyRecordId'
      ) or (
        original_action ->> 'type' = 'war_declare'
        and change.value ->> 'changeType' = 'war_declared'
        and change.value #>> '{structuredChange,house_a_id}' = actor_house_id::text
        and change.value #>> '{structuredChange,house_b_id}' = original_action ->> 'targetHouseId'
      ) or (
        original_action ->> 'type' = 'war_join'
        and change.value ->> 'changeType' = 'war_joined'
        and change.value #>> '{target,id}' = original_action ->> 'warId'
        and change.value #>> '{structuredChange,house_id}' = actor_house_id::text
      );

      select coalesce(
        nullif(string_agg(change.value ->> 'description', ' '), ''),
        'The order was accepted as an attempt, but no resulting state change was recorded.'
      )
      into outcome_summary
      from jsonb_array_elements(actor_state_changes) as change(value);
      action_executed := case original_action ->> 'type'
        when 'move' then exists (
          select 1 from jsonb_array_elements(actor_state_changes) as change(value)
          where change.value ->> 'changeType' = 'travel_departure'
            and change.value #>> '{target,id}' = actor_id::text
        )
        when 'muster' then exists (
          select 1 from jsonb_array_elements(actor_state_changes) as change(value)
          where change.value ->> 'changeType' = 'military_muster_ordered'
            and change.value #>> '{structuredChange,region_id}' = original_action ->> 'regionId'
            and change.value #>> '{structuredChange,force_size}' = original_action ->> 'forceSize'
        )
        when 'diplomacy_propose' then exists (
          select 1 from jsonb_array_elements(actor_state_changes) as change(value)
          where change.value ->> 'changeType' = 'diplomacy_proposed'
            and change.value #>> '{structuredChange,relation_type}' = original_action ->> 'relationType'
            and change.value #>> '{structuredChange,house_b_id}' = original_action ->> 'targetHouseId'
        )
        when 'diplomacy_resolve' then exists (
          select 1 from jsonb_array_elements(actor_state_changes) as change(value)
          where change.value ->> 'changeType' = 'diplomacy_resolved'
            and change.value #>> '{target,id}' = original_action ->> 'diplomacyRecordId'
        )
        when 'war_declare' then exists (
          select 1 from jsonb_array_elements(actor_state_changes) as change(value)
          where change.value ->> 'changeType' = 'war_declared'
            and change.value #>> '{structuredChange,house_b_id}' = original_action ->> 'targetHouseId'
        )
        when 'war_join' then exists (
          select 1 from jsonb_array_elements(actor_state_changes) as change(value)
          where change.value ->> 'changeType' = 'war_joined'
            and change.value #>> '{target,id}' = original_action ->> 'warId'
        )
        else false
      end;
      execution_status := case when action_executed then 'executed' else 'attempted' end;
    end if;

    insert into public.gameplay_order_outcomes (
      world_state_id, turn_number, actor_character_id, original_order,
      decision_status, execution_status, adjudication_reason,
      outcome_summary, state_changes, character_knowledge, event_id
    )
    values (
      1, p_turn_number, actor_id, original_action,
      decision_status, execution_status,
      outcome_row ->> 'reason', outcome_summary, actor_state_changes,
      jsonb_build_object(
        'summary', outcome_summary,
        'stateChanges', actor_state_changes
      ),
      event_id
    );

    resolved_outcome_data := resolved_outcome_data || jsonb_build_array(
      jsonb_build_object(
        'actorCharacterId', actor_id,
        'decision', decision_status,
        'reason', outcome_row ->> 'reason',
        'action', original_action,
        'executionStatus', execution_status,
        'outcomeSummary', outcome_summary,
        'stateChanges', actor_state_changes
      )
    );

    update public.game_events
    set character_knowledge = jsonb_set(
      character_knowledge,
      array[actor_id::text],
      to_jsonb(outcome_summary),
      true
    )
    where id = event_id;
  end loop;

  update public.gameplay_turn_resolutions
  set resolution_data = resolved_outcome_data
  where id = resolution_id;

  select left(
    'Shared world turn ' || p_turn_number || ' resolved. ' ||
    coalesce(
      string_agg(
        character.display_name || ': ' || outcome.outcome_summary,
        ' ' order by outcome.actor_character_id
      ),
      'No character actions were recorded.'
    ),
    4000
  )
  into resolved_summary
  from public.gameplay_order_outcomes as outcome
  join public.playable_characters as character
    on character.id = outcome.actor_character_id
  where outcome.world_state_id = 1
    and outcome.turn_number = p_turn_number;

  update public.gameplay_turn_resolutions
  set canonical_summary = resolved_summary
  where id = resolution_id;
  update public.game_events
  set canonical_summary = resolved_summary
  where id = event_id;

  update public.world_state
  set turn_phase = 'planning',
      planning_deadline_at = now() + interval '48 hours',
      resolution_started_at = null,
      resolution_lease_token = null,
      resolution_lease_owner = null,
      resolution_lease_expires_at = null,
      resolution_checkpoint = null,
      updated_at = now()
  where id = 1
  returning * into world;

  insert into public.gameplay_turn_participants (
    world_state_id, turn_number, user_id, character_id
  )
  select 1, world.turn_number + 1, assignment.user_id, assignment.character_id
  from public.user_character_assignments as assignment
  on conflict do nothing;

  insert into public.gameplay_npc_orders (
    world_state_id, turn_number, character_id
  )
  select 1, world.turn_number + 1, character.id
  from public.playable_characters as character
  where not exists (
    select 1 from public.user_character_assignments as assignment
    where assignment.character_id = character.id
  )
  on conflict do nothing;

  return jsonb_build_object(
    'status', 'resolved',
    'resolvedTurn', p_turn_number,
    'nextTurn', world.turn_number + 1,
    'revision', world.gameplay_revision,
    'eventId', event_id,
    'resolutionId', resolution_id,
    'deadlineAt', world.planning_deadline_at
  );
end
$$;

revoke all on function public.submit_game_order(
  uuid, integer, uuid, bigint, text, jsonb
) from public, anon, authenticated;
revoke all on function public.preflight_game_order(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_game_turn_resolution(text, integer)
  from public, anon, authenticated;
revoke all on function public.renew_game_turn_resolution(integer, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.save_npc_game_orders(integer, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_game_turn_checkpoint(integer, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.release_game_turn_resolution(integer, uuid, text)
  from public, anon, authenticated;
revoke all on function public.resolve_game_turn(
  integer, bigint, uuid, text, jsonb, text, text, text
) from public, anon, authenticated;

grant execute on function public.submit_game_order(
  uuid, integer, uuid, bigint, text, jsonb
) to service_role;
grant execute on function public.preflight_game_order(uuid, uuid, text)
  to service_role;
grant execute on function public.claim_game_turn_resolution(text, integer)
  to service_role;
grant execute on function public.renew_game_turn_resolution(integer, uuid, text, integer)
  to service_role;
grant execute on function public.save_npc_game_orders(integer, uuid, text, jsonb)
  to service_role;
grant execute on function public.save_game_turn_checkpoint(integer, uuid, text, jsonb)
  to service_role;
grant execute on function public.release_game_turn_resolution(integer, uuid, text)
  to service_role;
grant execute on function public.resolve_game_turn(
  integer, bigint, uuid, text, jsonb, text, text, text
) to service_role;

commit;
