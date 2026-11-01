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
  add column if not exists resolution_started_at timestamptz;

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

alter table public.gameplay_turn_participants enable row level security;
alter table public.gameplay_turn_orders enable row level security;
alter table public.gameplay_npc_orders enable row level security;
alter table public.gameplay_turn_resolutions enable row level security;

revoke all on public.gameplay_turn_participants, public.gameplay_turn_orders,
  public.gameplay_npc_orders, public.gameplay_turn_resolutions
  from anon, authenticated;
grant select, insert, update, delete
  on public.gameplay_turn_participants, public.gameplay_turn_orders,
  public.gameplay_npc_orders, public.gameplay_turn_resolutions
  to service_role;
grant usage, select on sequence
  public.gameplay_turn_orders_id_seq,
  public.gameplay_turn_resolutions_id_seq
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
begin
  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;

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
  if now() >= world.planning_deadline_at then
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

create or replace function public.claim_game_turn_resolution()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  required_count integer;
  submitted_count integer;
begin
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

  if world.turn_phase = 'resolving' then
    if world.resolution_started_at > now() - interval '10 minutes' then
      return jsonb_build_object(
        'claimed', false,
        'turnNumber', world.turn_number + 1,
        'phase', world.turn_phase,
        'deadlineAt', world.planning_deadline_at
      );
    end if;
  elsif required_count = 0
    or (submitted_count < required_count and now() < world.planning_deadline_at) then
    return jsonb_build_object(
      'claimed', false,
      'turnNumber', world.turn_number + 1,
      'phase', world.turn_phase,
      'submittedCount', submitted_count,
      'requiredCount', required_count,
      'deadlineAt', world.planning_deadline_at
    );
  end if;

  update public.world_state
  set turn_phase = 'resolving',
      resolution_started_at = now(),
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'claimed', true,
    'turnNumber', world.turn_number + 1,
    'revision', world.gameplay_revision,
    'deadlineAt', world.planning_deadline_at
  );
end
$$;

create or replace function public.save_npc_game_orders(
  p_turn_number integer,
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
begin
  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;
  if world.turn_phase <> 'resolving'
    or p_turn_number <> world.turn_number + 1 then
    raise exception 'GAME_TURN_CLOSED: NPC orders belong to a different world turn.';
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

create or replace function public.release_game_turn_resolution(
  p_turn_number integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.world_state
  set turn_phase = 'planning',
      resolution_started_at = null,
      updated_at = now()
  where id = 1
    and turn_phase = 'resolving'
    and turn_number + 1 = p_turn_number;
end
$$;

create or replace function public.resolve_game_turn(
  p_turn_number integer,
  p_expected_revision bigint,
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
  decision_row jsonb;
  actor_id integer;
  decision_status text;
  action_data jsonb;
  event_knowledge jsonb := '{}'::jsonb;
  committed_actions jsonb;
  resolution_result jsonb;
  outcome_data jsonb := '[]'::jsonb;
  required_count integer;
  provided_count integer;
  first_user_id uuid;
  first_character_id integer;
  event_id bigint;
  resolution_id bigint;
  request_id uuid;
  order_message text;
begin
  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;
  if world.turn_phase <> 'resolving'
    or p_turn_number <> world.turn_number + 1 then
    raise exception 'GAME_TURN_CLOSED: The world turn is not being resolved.';
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

  if now() >= world.planning_deadline_at then
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
      'reason', decision_row ->> 'reason'
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
    union all
    select npc.character_id as actor_id, npc.action_data -> 0 as action
    from public.gameplay_npc_orders as npc
    where npc.world_state_id = 1
      and npc.turn_number = p_turn_number
      and npc.resolution_status = 'accepted'
  ) as accepted;
  committed_actions := coalesce(committed_actions, '[]'::jsonb);

  select participant.user_id, participant.character_id
  into first_user_id, first_character_id
  from public.gameplay_turn_participants as participant
  where participant.world_state_id = 1
    and participant.turn_number = p_turn_number
  order by participant.character_id
  limit 1;
  if first_user_id is null or first_character_id is null then
    raise exception 'GAME_INVALID_REQUEST: A shared world turn requires at least one player.';
  end if;
  request_id := md5('global-turn-resolution:' || p_turn_number)::uuid;

  resolution_result := public.commit_game_turn(
    first_user_id,
    first_character_id,
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

  insert into public.gameplay_turn_resolutions (
    world_state_id, turn_number, gameplay_revision,
    event_id, canonical_summary, resolution_data
  )
  values (
    1, p_turn_number, (resolution_result ->> 'revision')::bigint,
    event_id, p_canonical_summary, outcome_data
  )
  returning id into resolution_id;

  update public.world_state
  set turn_phase = 'planning',
      planning_deadline_at = now() + interval '48 hours',
      resolution_started_at = null,
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
revoke all on function public.claim_game_turn_resolution() from public, anon, authenticated;
revoke all on function public.save_npc_game_orders(integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.release_game_turn_resolution(integer)
  from public, anon, authenticated;
revoke all on function public.resolve_game_turn(
  integer, bigint, jsonb, text, text, text
) from public, anon, authenticated;

grant execute on function public.submit_game_order(
  uuid, integer, uuid, bigint, text, jsonb
) to service_role;
grant execute on function public.claim_game_turn_resolution() to service_role;
grant execute on function public.save_npc_game_orders(integer, jsonb) to service_role;
grant execute on function public.release_game_turn_resolution(integer) to service_role;
grant execute on function public.resolve_game_turn(
  integer, bigint, jsonb, text, text, text
) to service_role;

commit;
