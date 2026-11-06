-- Run after event-log.sql, world-state-schema.sql, opening-state-seed.sql,
-- and travel-system-00-schema.sql through travel-system-07-seed.sql.
-- This migration is safe to rerun.

begin;

do $$
begin
  if to_regclass('public.travel_journeys') is null
    or to_regclass('public.travel_route_options') is null
    or to_regclass('public.game_events') is null
    or to_regclass('public.world_state') is null then
    raise exception
      'Run the world-state and complete travel-system migrations before gameplay-engine.sql.';
  end if;
end
$$;

alter table public.world_state
  add column if not exists opening_date_description text,
  add column if not exists turn_number integer not null default 0
    check (turn_number >= 0),
  add column if not exists elapsed_days integer not null default 0
    check (elapsed_days >= 0),
  add column if not exists gameplay_revision bigint not null default 0
    check (gameplay_revision >= 0);

update public.world_state
set opening_date_description = date_description
where opening_date_description is null;

alter table public.travel_journeys
  add column if not exists elapsed_days integer not null default 0
    check (elapsed_days >= 0),
  add column if not exists estimated_duration_days integer
    check (estimated_duration_days is null or estimated_duration_days > 0);

create table if not exists public.game_muster_orders (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  house_id bigint not null references public.houses(id) on delete restrict,
  region_id smallint not null
    references public.world_regions(id) on delete restrict,
  requested_by_character_id integer not null
    references public.playable_characters(id) on delete restrict,
  force_size integer not null check (force_size > 0),
  required_days integer not null check (required_days > 0),
  elapsed_days integer not null default 0 check (elapsed_days >= 0),
  status text not null default 'mustering'
    check (status in ('mustering', 'ready', 'cancelled')),
  created_turn integer not null check (created_turn > 0),
  source_event_id bigint references public.game_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists game_muster_orders_region_status_idx
  on public.game_muster_orders (region_id, status);

create table if not exists public.gameplay_turns (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  turn_number integer not null check (turn_number > 0),
  gameplay_revision bigint not null check (gameplay_revision > 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  character_id integer not null
    references public.playable_characters(id) on delete restrict,
  player_request text not null,
  narration text not null,
  action_data jsonb not null check (jsonb_typeof(action_data) = 'array'),
  event_id bigint not null references public.game_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (world_state_id, turn_number)
);

alter table public.game_muster_orders enable row level security;
alter table public.gameplay_turns enable row level security;

revoke all on public.game_muster_orders, public.gameplay_turns
  from anon, authenticated;
grant select, insert, update, delete
  on public.game_muster_orders, public.gameplay_turns to service_role;
grant usage, select on sequence
  public.game_muster_orders_id_seq, public.gameplay_turns_id_seq to service_role;

create or replace function public.commit_game_turn(
  p_user_id uuid,
  p_character_id integer,
  p_request_id uuid,
  p_expected_revision bigint,
  p_player_request text,
  p_narration text,
  p_event_title text,
  p_event_type text,
  p_event_summary text,
  p_character_knowledge jsonb,
  p_actions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  world public.world_state%rowtype;
  existing_turn public.gameplay_turns%rowtype;
  assigned_character_id integer;
  actor_user_id uuid;
  actor public.playable_characters%rowtype;
  actor_house_id bigint;
  target_house_id bigint;
  route public.travel_route_options%rowtype;
  v_journey_id bigint;
  v_diplomacy_id bigint;
  v_war_id bigint;
  muster_order_id bigint;
  event_id bigint;
  turn_id bigint;
  action jsonb;
  action_type text;
  actor_id integer;
  destination_id bigint;
  route_id bigint;
  party_type text;
  party_days integer;
  party_size integer;
  force_size integer;
  v_region_id smallint;
  v_rule_id bigint;
  v_required_days integer;
  committed_strength bigint;
  available_strength integer;
  relation_type text;
  diplomacy_status text;
  war_name text;
  war_summary text;
  side_name text;
  affected_character_ids integer[] := '{}';
  affected_house_ids bigint[] := '{}';
  created_muster_ids bigint[] := '{}';
  started_journey_ids bigint[] := '{}';
  created_diplomacy_ids bigint[] := '{}';
  created_war_ids bigint[] := '{}';
  state_changes jsonb := '[]'::jsonb;
  completed_order record;
  journey record;
  current_location_name text;
  response jsonb;
begin
  if p_request_id is null
    or ((p_user_id is null) <> (p_character_id is null)) then
    raise exception 'GAME_INVALID_REQUEST: Player identity must be supplied together, or omitted for a global turn.';
  end if;
  if length(trim(coalesce(p_player_request, ''))) = 0
    or length(p_player_request) > 6000 then
    raise exception 'GAME_INVALID_REQUEST: The player request is empty or too long.';
  end if;
  if length(trim(coalesce(p_narration, ''))) = 0 or length(p_narration) > 12000
    or length(trim(coalesce(p_event_title, ''))) = 0 or length(p_event_title) > 160
    or length(trim(coalesce(p_event_summary, ''))) = 0
    or length(p_event_summary) > 4000 then
    raise exception 'GAME_INVALID_REQUEST: Generated turn text is invalid.';
  end if;
  if p_event_type not in (
    'political', 'military', 'personal', 'movement', 'information',
    'promise', 'decision', 'other'
  ) then
    raise exception 'GAME_INVALID_REQUEST: Unsupported event type.';
  end if;
  if jsonb_typeof(p_character_knowledge) is distinct from 'object' then
    raise exception 'GAME_INVALID_REQUEST: Character knowledge must be a JSON object.';
  end if;
  if jsonb_typeof(p_actions) is distinct from 'array'
    or jsonb_array_length(p_actions) > 1000 then
    raise exception 'GAME_INVALID_REQUEST: A turn may contain at most 1000 actions.';
  end if;

  select * into world
  from public.world_state
  where id = 1
  for update;
  if not found then
    raise exception 'GAME_STATE_MISSING: The world state is not initialized.';
  end if;

  select * into existing_turn
  from public.gameplay_turns
  where request_id = p_request_id;
  if found then
    if existing_turn.user_id is distinct from p_user_id
      or existing_turn.character_id is distinct from p_character_id then
      raise exception 'GAME_INVALID_REQUEST: Request ID was already used.';
    end if;
    return jsonb_build_object(
      'turnId', existing_turn.id,
      'turnNumber', existing_turn.turn_number,
      'revision', existing_turn.gameplay_revision,
      'eventId', existing_turn.event_id,
      'narration', existing_turn.narration
    );
  end if;

  if p_user_id is not null then
    select character_id into assigned_character_id
    from public.user_character_assignments
    where user_id = p_user_id;
    if not found or assigned_character_id <> p_character_id then
      raise exception 'GAME_NOT_ASSIGNED: The character is not assigned to this player.';
    end if;
  end if;
  if world.gameplay_revision <> p_expected_revision then
    raise exception 'GAME_STALE_STATE: The world changed while this turn was being processed.';
  end if;

  update public.world_state
  set turn_number = turn_number + 1,
      elapsed_days = elapsed_days + 7,
      gameplay_revision = gameplay_revision + 1,
      date_description = coalesce(opening_date_description, date_description)
        || ' - game day ' || (elapsed_days + 7)
        || ' (exact calendar day unestablished)',
      updated_at = now()
  where id = 1
  returning * into world;

  for completed_order in
    update public.game_muster_orders as order_row
    set elapsed_days = order_row.elapsed_days + 7,
        status = case
          when order_row.elapsed_days + 7 >= order_row.required_days then 'ready'
          else order_row.status
        end,
        updated_at = now()
    where order_row.world_state_id = 1
      and order_row.status = 'mustering'
    returning id, house_id, force_size, status, elapsed_days, required_days
  loop
    if completed_order.status = 'ready' then
      state_changes := state_changes || jsonb_build_array(jsonb_build_object(
        'changeType', 'muster_completed',
        'description', 'A force of ' || completed_order.force_size
          || ' completed its muster.',
        'target', jsonb_build_object('type', 'house', 'id', completed_order.house_id),
        'structuredChange', jsonb_build_object(
          'muster_order_id', completed_order.id,
          'force_size', completed_order.force_size,
          'status', 'ready'
        )
      ));
      affected_house_ids := array_append(affected_house_ids, completed_order.house_id);
    end if;
  end loop;

  update public.travel_journeys
  set elapsed_days = elapsed_days + 7,
      updated_at = now()
  where world_state_id = 1
    and status in ('in_progress', 'delayed')
    and estimated_duration_days is not null;

  for journey in
    select id, destination_location_id, elapsed_days, estimated_duration_days
    from public.travel_journeys
    where world_state_id = 1
      and status in ('in_progress', 'delayed')
      and estimated_duration_days is not null
      and elapsed_days >= estimated_duration_days
    for update
  loop
    update public.travel_journey_legs
    set status = 'completed',
        actual_arrival_at = now(),
        actual_distance_miles = (
          select edge.distance_midpoint_miles
          from public.travel_route_edges as edge
          where edge.id = travel_journey_legs.route_edge_id
        ),
        updated_at = now()
    where journey_id = journey.id;

    update public.travel_journeys
    set status = 'arrived',
        arrived_at = now(),
        updated_at = now()
    where id = journey.id;
  end loop;

  for action in select value from jsonb_array_elements(p_actions)
  loop
    action_type := action ->> 'type';
    actor_id := (action ->> 'actorCharacterId')::integer;
    select * into actor
    from public.playable_characters
    where id = actor_id
    for update;
    if not found then
      raise exception 'GAME_INVALID_ACTION: Actor character does not exist.';
    end if;
    actor_house_id := coalesce(actor.current_house_id, actor.starting_house_id);
    affected_character_ids := array_append(affected_character_ids, actor_id);

    if action_type = 'move' then
      actor_user_id := null;
      if p_user_id is null then
        select participant.user_id into actor_user_id
        from public.gameplay_turn_participants as participant
        where participant.world_state_id = 1
          and participant.turn_number = world.turn_number
          and participant.character_id = actor_id;
      else
        select assignment.user_id into actor_user_id
        from public.user_character_assignments as assignment
        where assignment.character_id = actor_id;
      end if;
      route_id := (action ->> 'routeOptionId')::bigint;
      destination_id := (action ->> 'destinationLocationId')::bigint;
      party_type := action ->> 'partyType';
      party_size := (action ->> 'partySize')::integer;
      select * into route
      from public.travel_route_options
      where id = route_id;
      if not found or route.catalog_status <> 'available' then
        raise exception 'GAME_INVALID_ACTION: The selected route is not available.';
      end if;
      if exists (
        select 1
        from public.travel_route_option_legs as option_leg
        join public.travel_route_edges as edge
          on edge.id = option_leg.route_edge_id
        where option_leg.route_option_id = route_id
          and (
            edge.availability_status in ('closed', 'restricted')
            or edge.seasonal_status = 'closed'
            or edge.is_blockaded is true
            or edge.is_destroyed is true
          )
      ) then
        raise exception 'GAME_INVALID_ACTION: The selected route is closed or blocked.';
      end if;
      if exists (
        select 1
        from public.travel_route_option_legs as option_leg
        join public.travel_route_edges as edge
          on edge.id = option_leg.route_edge_id
        where option_leg.route_option_id = route_id
          and edge.requires_permission is true
      ) then
        raise exception 'GAME_INVALID_ACTION: The selected route requires unresolved permission.';
      end if;
      if actor.current_location_id is null
        or destination_id = actor.current_location_id
        or not (
          (route.origin_location_id = actor.current_location_id
            and route.destination_location_id = destination_id)
          or
          (route.destination_location_id = actor.current_location_id
            and route.origin_location_id = destination_id)
        ) then
        raise exception 'GAME_INVALID_ACTION: The route does not match the character locations.';
      end if;
      party_days := case party_type
        when 'mounted_party' then route.mounted_party_days
        when 'foot_party' then route.foot_party_days
        else null
      end;
      if party_days is null or party_days <= 0 or party_size is null or party_size <= 0 then
        raise exception 'GAME_INVALID_ACTION: No usable travel estimate exists for this party.';
      end if;
      if exists (
        select 1
        from public.travel_journey_participants as participant
        join public.travel_journeys as active_journey
          on active_journey.id = participant.journey_id
        where participant.character_id = actor_id
          and participant.participation_status in ('travelling', 'joined')
          and active_journey.status in (
            'planned', 'awaiting_permission', 'ready', 'in_progress', 'delayed'
          )
      ) then
        raise exception 'GAME_INVALID_ACTION: The character is already travelling.';
      end if;

      insert into public.travel_journeys (
        world_state_id, route_option_id, origin_location_id,
        destination_location_id, status, party_type, party_size,
        planned_departure_at, created_by_user_id, estimated_duration_days,
        elapsed_days, state_note
      )
      values (
        1, route_id, actor.current_location_id, destination_id, 'planned',
        party_type, party_size, now(), actor_user_id, party_days, 0,
        'Travel uses the route estimate; unknown route conditions remain uncertain.'
      )
      returning id into v_journey_id;

      insert into public.travel_journey_participants (
        journey_id, character_id, user_id, participant_role,
        participation_status, joined_at
      )
      values (
        v_journey_id, actor_id,
        actor_user_id,
        'traveller', 'travelling', now()
      );

      update public.travel_journeys
      set status = 'in_progress',
          departed_at = now(),
          current_leg_sequence = 1,
          estimated_arrival_at = now() + make_interval(days => party_days),
          updated_at = now()
      where id = v_journey_id;

      update public.travel_journey_legs as journey_leg
      set estimated_days = greatest(
            1,
            ceil(party_days::numeric / route_leg_count.leg_count)::integer
          ),
          updated_at = now()
      from (
        select journey_leg.journey_id as id, count(*)::integer as leg_count
        from public.travel_journey_legs as journey_leg
        where journey_leg.journey_id = v_journey_id
        group by journey_leg.journey_id
      ) as route_leg_count
      where journey_leg.journey_id = route_leg_count.id;

      started_journey_ids := array_append(started_journey_ids, v_journey_id);
      state_changes := state_changes || jsonb_build_array(jsonb_build_object(
        'changeType', 'travel_departure',
        'description', 'A travelling party departed for location ' || destination_id || '.',
        'target', jsonb_build_object('type', 'character', 'id', actor_id),
        'structuredChange', jsonb_build_object(
          'journey_id', v_journey_id,
          'route_option_id', route_id,
          'destination_location_id', destination_id,
          'estimated_duration_days', party_days
        )
      ));
      if actor_house_id is not null then
        affected_house_ids := array_append(affected_house_ids, actor_house_id);
      end if;

    elsif action_type = 'muster' then
      v_region_id := (action ->> 'regionId')::smallint;
      force_size := (action ->> 'forceSize')::integer;
      v_rule_id := (action ->> 'ruleId')::bigint;
      if actor_house_id is null or force_size is null or force_size <= 0 then
        raise exception 'GAME_INVALID_ACTION: A muster requires a house and positive force size.';
      end if;
      if not exists (
        select 1 from public.houses
        where id = actor_house_id and houses.region_id = v_region_id
      ) and not exists (
        select 1 from public.playable_locations as location
        where location.id = actor.current_location_id
          and location.world_region_id = v_region_id
      ) then
        raise exception 'GAME_INVALID_ACTION: The actor cannot muster in that region.';
      end if;
      select max(estimate.maximum_strength) into available_strength
      from public.regional_military_estimates as estimate
      where estimate.region_id = v_region_id
        and estimate.force_type = 'regional_levy'
        and estimate.world_state_id = 1;
      if available_strength is null then
        raise exception 'GAME_INVALID_ACTION: Regional levy capacity is unknown.';
      end if;
      select rule.minimum_days, rule.maximum_days
      into v_required_days, party_days
      from public.military_muster_rules as rule
      where rule.id = v_rule_id
        and rule.force_type = 'regional_levy'
        and (rule.region_id is null or rule.region_id = v_region_id);
      if not found then
        raise exception 'GAME_INVALID_ACTION: The muster rule does not apply to this region.';
      end if;
      v_required_days := greatest(
        1,
        ceil((v_required_days + party_days)::numeric / 2)::integer
      );
      select coalesce(sum(order_record.force_size), 0)
      into committed_strength
      from public.game_muster_orders as order_record
      where order_record.region_id = v_region_id
        and order_record.status <> 'cancelled';
      if committed_strength + force_size > available_strength then
        raise exception 'GAME_INVALID_ACTION: The muster exceeds remaining regional capacity.';
      end if;
      insert into public.game_muster_orders (
        world_state_id, house_id, region_id, requested_by_character_id,
        force_size, required_days, elapsed_days, status, created_turn
      )
      values (
        1, actor_house_id, v_region_id, actor_id, force_size, v_required_days,
        0, 'mustering', world.turn_number
      )
      returning id into muster_order_id;
      created_muster_ids := array_append(created_muster_ids, muster_order_id);
      affected_house_ids := array_append(affected_house_ids, actor_house_id);
      state_changes := state_changes || jsonb_build_array(jsonb_build_object(
        'changeType', 'military_muster_ordered',
        'description', 'A force of ' || force_size || ' was ordered to muster.',
        'target', jsonb_build_object('type', 'house', 'id', actor_house_id),
        'structuredChange', jsonb_build_object(
          'muster_order_id', muster_order_id,
          'region_id', v_region_id,
          'force_size', force_size,
          'required_days', v_required_days,
          'status', 'mustering'
        )
      ));

    elsif action_type = 'diplomacy_propose' then
      target_house_id := (action ->> 'targetHouseId')::bigint;
      relation_type := action ->> 'relationType';
      if actor_house_id is null or target_house_id is null
        or actor_house_id = target_house_id then
        raise exception 'GAME_INVALID_ACTION: Diplomacy requires two different houses.';
      end if;
      if not exists (select 1 from public.houses where id = target_house_id) then
        raise exception 'GAME_INVALID_ACTION: The target house does not exist.';
      end if;
      insert into public.diplomacy_records (
        world_state_id, relation_type, status, house_a_id, house_b_id,
        character_a_id, terms, is_public
      )
      values (
        1, relation_type, 'proposed', actor_house_id, target_house_id,
        actor_id, action ->> 'terms', false
      )
      returning id into v_diplomacy_id;
      created_diplomacy_ids := array_append(created_diplomacy_ids, v_diplomacy_id);
      affected_house_ids := array_append(affected_house_ids, actor_house_id);
      affected_house_ids := array_append(affected_house_ids, target_house_id);
      state_changes := state_changes || jsonb_build_array(jsonb_build_object(
        'changeType', 'diplomacy_proposed',
        'description', 'A private diplomatic proposal was recorded.',
        'target', jsonb_build_object('type', 'diplomacy', 'id', v_diplomacy_id),
        'structuredChange', jsonb_build_object(
          'relation_type', relation_type,
          'status', 'proposed',
          'house_a_id', actor_house_id,
          'house_b_id', target_house_id
        )
      ));

    elsif action_type = 'diplomacy_resolve' then
      v_diplomacy_id := (action ->> 'diplomacyRecordId')::bigint;
      diplomacy_status := action ->> 'status';
      if not exists (
        select 1 from public.diplomacy_records as record
        where record.id = v_diplomacy_id
          and record.status in ('proposed', 'active')
          and (
            record.character_a_id = actor_id
            or record.character_b_id = actor_id
            or actor_house_id in (record.house_a_id, record.house_b_id)
          )
          and (
            (record.status = 'proposed'
              and diplomacy_status in ('active', 'ended')
              and (
                record.character_b_id = actor_id
                or actor_house_id = record.house_b_id
              ))
            or
            (record.status = 'active'
              and diplomacy_status in ('broken', 'fulfilled', 'ended'))
          )
      ) then
        raise exception 'GAME_INVALID_ACTION: The actor cannot resolve this proposal.';
      end if;
      update public.diplomacy_records
      set status = diplomacy_status
      where id = v_diplomacy_id;
      state_changes := state_changes || jsonb_build_array(jsonb_build_object(
        'changeType', 'diplomacy_resolved',
        'description', 'A diplomatic proposal changed status to ' || diplomacy_status || '.',
        'target', jsonb_build_object('type', 'diplomacy', 'id', v_diplomacy_id),
        'structuredChange', jsonb_build_object('status', diplomacy_status)
      ));

    elsif action_type = 'war_declare' then
      target_house_id := (action ->> 'targetHouseId')::bigint;
      war_name := action ->> 'name';
      war_summary := action ->> 'summary';
      if actor_house_id is null or target_house_id is null
        or actor_house_id = target_house_id
        or not exists (select 1 from public.houses where id = target_house_id) then
        raise exception 'GAME_INVALID_ACTION: War requires two different known houses.';
      end if;
      if exists (
        select 1
        from public.war_participants as first_party
        join public.war_participants as second_party
          on second_party.war_id = first_party.war_id
        join public.world_wars as existing_war
          on existing_war.id = first_party.war_id
        where existing_war.status = 'active'
          and first_party.house_id = actor_house_id
          and second_party.house_id = target_house_id
      ) then
        raise exception 'GAME_INVALID_ACTION: These houses are already at war.';
      end if;
      insert into public.world_wars (
        world_state_id, name, status, summary, is_public
      )
      values (1, war_name, 'active', war_summary, false)
      returning id into v_war_id;
      insert into public.war_participants (war_id, house_id, side)
      values
        (v_war_id, actor_house_id, 'declaring'),
        (v_war_id, target_house_id, 'target');
      created_war_ids := array_append(created_war_ids, v_war_id);
      affected_house_ids := array_append(affected_house_ids, actor_house_id);
      affected_house_ids := array_append(affected_house_ids, target_house_id);
      state_changes := state_changes || jsonb_build_array(jsonb_build_object(
        'changeType', 'war_declared',
        'description', 'A new conflict was recorded between two houses.',
        'target', jsonb_build_object('type', 'war', 'id', v_war_id),
        'structuredChange', jsonb_build_object(
          'house_a_id', actor_house_id,
          'house_b_id', target_house_id,
          'status', 'active'
        )
      ));

    elsif action_type = 'war_join' then
      v_war_id := (action ->> 'warId')::bigint;
      side_name := action ->> 'side';
      if actor_house_id is null or not exists (
        select 1 from public.world_wars
        where id = v_war_id and status = 'active'
      ) then
        raise exception 'GAME_INVALID_ACTION: Joining requires an active war and a house.';
      end if;
      if exists (
        select 1 from public.war_participants
        where war_participants.war_id = v_war_id
          and war_participants.house_id = actor_house_id
      ) then
        raise exception 'GAME_INVALID_ACTION: The house already participates in this war.';
      end if;
      if not exists (
        select 1 from public.war_participants
        where war_participants.war_id = v_war_id
          and war_participants.side = side_name
      ) then
        raise exception 'GAME_INVALID_ACTION: The selected side is not part of this war.';
      end if;
      insert into public.war_participants (war_id, house_id, side)
      values (v_war_id, actor_house_id, side_name);
      affected_house_ids := array_append(affected_house_ids, actor_house_id);
      state_changes := state_changes || jsonb_build_array(jsonb_build_object(
        'changeType', 'war_joined',
        'description', 'A house joined an active conflict.',
        'target', jsonb_build_object('type', 'war', 'id', v_war_id),
        'structuredChange', jsonb_build_object(
          'house_id', actor_house_id,
          'side', side_name
        )
      ));

    elsif action_type = 'wait' then
      state_changes := state_changes || jsonb_build_array(jsonb_build_object(
        'changeType', 'turn_waited',
        'description', 'The character took no state-changing action.',
        'target', jsonb_build_object('type', 'character', 'id', actor_id),
        'structuredChange', jsonb_build_object('reason', action ->> 'reason')
      ));
    else
      raise exception 'GAME_INVALID_ACTION: Unsupported action type.';
    end if;
  end loop;

  if p_character_id is not null then
    select location.name into current_location_name
    from public.playable_characters as character
    join public.playable_locations as location
      on location.id = character.current_location_id
    where character.id = p_character_id;
  end if;

  insert into public.game_events (
    world_state_id, world_date_label, event_type, title,
    canonical_summary, public_summary, affected_character_ids,
    affected_house_ids, location, character_knowledge, state_changes
  )
  values (
    1,
    world.date_description,
    p_event_type,
    p_event_title,
    p_event_summary,
    null,
    affected_character_ids,
    affected_house_ids,
    current_location_name,
    p_character_knowledge,
    state_changes
  )
  returning id into event_id;

  update public.game_muster_orders
  set source_event_id = event_id
  where id = any(created_muster_ids);
  update public.travel_journeys
  set departure_event_id = event_id
  where id = any(started_journey_ids);
  update public.diplomacy_records
  set source_event_id = event_id
  where id = any(created_diplomacy_ids);
  update public.world_wars
  set source_event_id = event_id
  where id = any(created_war_ids);
  update public.war_participants
  set source_event_id = event_id
  where war_id = any(created_war_ids);

  if p_user_id is not null then
    insert into public.gameplay_turns (
      request_id, turn_number, gameplay_revision, user_id, character_id,
      player_request, narration, action_data, event_id
    )
    values (
      p_request_id, world.turn_number, world.gameplay_revision,
      p_user_id, p_character_id, p_player_request, p_narration, p_actions, event_id
    )
    returning id into turn_id;
  end if;

  response := jsonb_build_object(
    'turnId', turn_id,
    'turnNumber', world.turn_number,
    'revision', world.gameplay_revision,
    'eventId', event_id,
    'narration', p_narration
  );
  return response;
end
$$;

revoke all on function public.commit_game_turn(
  uuid, integer, uuid, bigint, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.commit_game_turn(
  uuid, integer, uuid, bigint, text, text, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;

commit;
