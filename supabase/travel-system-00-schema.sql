-- Westeros travel system: schema and security setup.
-- Run after event-log.sql, world-state-schema.sql, and opening-state-seed.sql.
-- Execute this complete file once, then continue with the next numbered file.

begin;

do $$
begin
  if to_regclass('public.playable_locations') is null
    or to_regclass('public.playable_characters') is null
    or to_regclass('public.houses') is null
    or to_regclass('public.game_events') is null
    or to_regclass('public.world_state') is null then
    raise exception
      'Run event-log.sql, world-state-schema.sql, and opening-state-seed.sql before travel-system.sql.';
  end if;
end
$$;

alter table public.playable_locations
  add column if not exists travel_priority_rank smallint,
  add column if not exists is_travel_core boolean not null default false,
  add column if not exists travel_geography_note text;

create table if not exists public.travel_workbook_imports (
  id bigint generated always as identity primary key,
  import_key text not null unique,
  filename text not null,
  sha256 text not null unique,
  evidence_note text not null,
  imported_at timestamptz not null default now()
);

create table if not exists public.travel_workbook_rows (
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete cascade,
  sheet_name text not null,
  row_number integer not null check (row_number > 0),
  row_data jsonb not null check (jsonb_typeof(row_data) = 'array'),
  primary key (import_id, sheet_name, row_number)
);

create table if not exists public.travel_sources (
  id bigint generated always as identity primary key,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  source_name text not null,
  source_url text not null,
  supports text not null,
  use_limitations text not null,
  source_sheet text not null default 'SOURCE REGISTER',
  source_row_number integer not null,
  unique (import_id, source_name),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict
);

create table if not exists public.travel_location_reference (
  location_id smallint primary key
    references public.playable_locations(id) on delete restrict,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  region_name text not null,
  location_type text not null,
  normalized_starting_house text,
  normalized_house text,
  priority_rank smallint check (priority_rank is null or priority_rank > 0),
  is_core10 boolean not null,
  is_playable boolean not null,
  geography_note text not null,
  implementation_note text not null,
  source_sheet text not null default 'LOCATION MASTER',
  source_row_number integer not null,
  unique (import_id, priority_rank),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict
);

create table if not exists public.travel_corridors (
  id bigint generated always as identity primary key,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  corridor_name text not null,
  network_class text not null,
  edge_modes text[] not null default '{}',
  edge_count integer not null check (edge_count >= 0),
  playable_locations_touched text[] not null default '{}',
  edge_keys text[] not null default '{}',
  waypoint_catalogue text[] not null default '{}',
  description text not null,
  confidence_level text not null
    check (confidence_level in ('high', 'medium', 'low', 'very_low', 'unknown')),
  source_url text,
  source_id bigint references public.travel_sources(id) on delete set null,
  source_sheet text not null default 'ROAD CORRIDORS',
  source_row_number integer not null,
  unique (import_id, corridor_name),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict
);

create table if not exists public.travel_transit_nodes (
  id bigint generated always as identity primary key,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  node_name text not null unique,
  node_type text not null,
  geographic_role text not null,
  gameplay_constraints text not null,
  is_catalogued_chokepoint boolean not null default true,
  source_sheet text,
  source_row_number integer,
  created_at timestamptz not null default now(),
  check (
    (source_sheet is null and source_row_number is null)
    or (source_sheet is not null and source_row_number is not null)
  ),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict
);

create table if not exists public.travel_route_edges (
  id bigint generated always as identity primary key,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  edge_key text not null unique,
  from_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  to_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  corridor_id bigint not null
    references public.travel_corridors(id) on delete restrict,
  mode text not null check (mode in ('road', 'road_pass', 'sea')),
  distance_min_miles numeric(9, 2) not null check (distance_min_miles >= 0),
  distance_max_miles numeric(9, 2) not null,
  distance_midpoint_miles numeric(9, 2) not null,
  distance_basis text not null,
  confidence_level text not null
    check (confidence_level in ('high', 'medium', 'low', 'very_low', 'unknown')),
  top_priority_endpoints text,
  route_constraint text,
  route_notes text,
  requires_vessel boolean not null default false,
  is_bidirectional boolean not null default true,
  availability_status text not null default 'unknown'
    check (availability_status in ('open', 'restricted', 'closed', 'unknown')),
  is_open boolean,
  controller_house_id bigint references public.houses(id) on delete set null,
  requires_permission boolean,
  toll_status text,
  is_blockaded boolean,
  is_destroyed boolean,
  seasonal_status text not null default 'unknown',
  capacity_class text,
  current_risk_level text not null default 'unknown',
  current_speed_modifier numeric(6, 3)
    check (current_speed_modifier is null or current_speed_modifier > 0),
  terrain text,
  road_quality text,
  base_risk_level text not null default 'unknown',
  base_speed_modifier numeric(6, 3)
    check (base_speed_modifier is null or base_speed_modifier > 0),
  last_state_change_event_id bigint
    references public.game_events(id) on delete set null,
  source_sheet text not null default 'DIRECT NETWORK',
  source_row_number integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_location_id <> to_location_id),
  check (distance_max_miles >= distance_min_miles),
  check (
    distance_midpoint_miles between distance_min_miles and distance_max_miles
  ),
  unique (import_id, edge_key),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict
);

create unique index if not exists travel_route_edges_physical_pair_uidx
  on public.travel_route_edges (
    least(from_location_id, to_location_id),
    greatest(from_location_id, to_location_id)
  );

create table if not exists public.travel_route_edge_waypoints (
  edge_id bigint not null
    references public.travel_route_edges(id) on delete cascade,
  sequence_number smallint not null check (sequence_number > 0),
  transit_node_id bigint not null
    references public.travel_transit_nodes(id) on delete restrict,
  primary key (edge_id, sequence_number),
  unique (edge_id, transit_node_id)
);

create table if not exists public.travel_route_options (
  id bigint generated always as identity primary key,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  reference_key text not null unique,
  origin_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  destination_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  option_type text not null
    check (option_type in ('shortest_midpoint_multimodal', 'land_only')),
  catalog_status text not null
    check (catalog_status in ('available', 'unavailable')),
  unavailable_reason text,
  playable_path text[] not null default '{}',
  leg_modes text[] not null default '{}',
  corridor_names text[] not null default '{}',
  distance_min_miles numeric(9, 2),
  distance_max_miles numeric(9, 2),
  distance_midpoint_miles numeric(9, 2),
  mounted_party_days integer,
  foot_party_days integer,
  large_army_days integer,
  confidence_level text not null
    check (confidence_level in ('high', 'medium', 'low', 'very_low', 'unknown')),
  route_constraints text,
  direction_note text,
  selection_method text not null,
  source_sheet text not null,
  source_row_number integer not null,
  created_at timestamptz not null default now(),
  check (origin_location_id <> destination_location_id),
  check (
    (catalog_status = 'available'
      and cardinality(playable_path) >= 2
      and cardinality(leg_modes) = cardinality(playable_path) - 1
      and cardinality(corridor_names) = cardinality(playable_path) - 1
      and distance_min_miles is not null
      and distance_max_miles is not null
      and distance_midpoint_miles is not null)
    or
    (catalog_status = 'unavailable'
      and cardinality(playable_path) = 0
      and cardinality(leg_modes) = 0
      and cardinality(corridor_names) = 0
      and distance_min_miles is null
      and distance_max_miles is null
      and distance_midpoint_miles is null)
  ),
  check (
    distance_min_miles is null
    or (distance_min_miles >= 0
      and distance_max_miles >= distance_min_miles
      and distance_midpoint_miles between distance_min_miles and distance_max_miles)
  ),
  unique (id, import_id),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict
);

create unique index if not exists travel_route_options_unordered_pair_uidx
  on public.travel_route_options (
    least(origin_location_id, destination_location_id),
    greatest(origin_location_id, destination_location_id),
    option_type,
    import_id
  );

create table if not exists public.travel_route_option_legs (
  id bigint generated always as identity primary key,
  route_option_id bigint not null
    references public.travel_route_options(id) on delete cascade,
  sequence_number smallint not null check (sequence_number > 0),
  route_edge_id bigint not null
    references public.travel_route_edges(id) on delete restrict,
  from_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  to_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  unique (route_option_id, sequence_number),
  check (from_location_id <> to_location_id)
);

create table if not exists public.travel_assumptions (
  id bigint generated always as identity primary key,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  assumption_name text not null,
  value_text text not null,
  minimum_value numeric(12, 3),
  maximum_value numeric(12, 3),
  unit text not null,
  classification text not null,
  implementation_detail text not null,
  source_sheet text not null default 'TRAVEL ASSUMPTIONS',
  source_row_number integer not null,
  unique (import_id, assumption_name),
  check (
    minimum_value is null or maximum_value is null
    or maximum_value >= minimum_value
  ),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict
);

create table if not exists public.travel_route_control_fields (
  id bigint generated always as identity primary key,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  field_name text not null,
  suggested_type text not null,
  purpose text not null,
  source_sheet text not null default 'ROUTE CONTROL',
  source_row_number integer not null,
  unique (import_id, field_name),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict
);

create table if not exists public.travel_distance_conflicts (
  id bigint generated always as identity primary key,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  origin_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  destination_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  quoted_or_secondary_value text not null,
  map_calibrated_value text not null,
  adopted_network_range text not null,
  confidence_level text not null
    check (confidence_level in ('high', 'medium', 'low', 'very_low', 'unknown')),
  implementation_note text not null,
  source_sheet text not null default 'DISTANCE CONFLICTS',
  source_row_number integer not null,
  unique (import_id, origin_location_id, destination_location_id),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict
);

create table if not exists public.travel_legacy_corridor_edges (
  id bigint generated always as identity primary key,
  import_id bigint not null
    references public.travel_workbook_imports(id) on delete restrict,
  legacy_route_key text not null,
  from_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  to_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  mode text not null,
  route_name text not null,
  nonplayable_waypoints text,
  distance_min_miles numeric(9, 2),
  distance_max_miles numeric(9, 2),
  distance_basis text,
  confidence_level text not null
    check (confidence_level in ('high', 'medium', 'low', 'very_low', 'unknown')),
  notes text,
  source_sheet text not null default 'ALT CORRIDORS',
  source_row_number integer not null,
  unique (import_id, legacy_route_key),
  foreign key (import_id, source_sheet, source_row_number)
    references public.travel_workbook_rows(import_id, sheet_name, row_number)
    on delete restrict,
  check (
    distance_min_miles is null or distance_max_miles >= distance_min_miles
  )
);

create table if not exists public.travel_journeys (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  route_option_id bigint not null
    references public.travel_route_options(id) on delete restrict,
  origin_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  destination_location_id smallint not null
    references public.playable_locations(id) on delete restrict,
  status text not null default 'planned'
    check (status in (
      'planned', 'awaiting_permission', 'ready', 'in_progress',
      'delayed', 'arrived', 'cancelled', 'abandoned'
    )),
  party_type text not null
    check (party_type in ('courier', 'mounted_party', 'foot_party', 'army', 'ship', 'fleet', 'mixed')),
  party_size integer check (party_size is null or party_size > 0),
  current_leg_sequence smallint,
  current_transit_node_id bigint
    references public.travel_transit_nodes(id) on delete set null,
  distance_travelled_miles numeric(10, 2) not null default 0
    check (distance_travelled_miles >= 0),
  planned_departure_at timestamptz,
  departed_at timestamptz,
  estimated_arrival_at timestamptz,
  arrived_at timestamptz,
  delay_days integer not null default 0 check (delay_days >= 0),
  delay_reason text,
  created_by_user_id uuid references auth.users(id) on delete set null,
  departure_event_id bigint references public.game_events(id) on delete set null,
  arrival_event_id bigint references public.game_events(id) on delete set null,
  state_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (origin_location_id <> destination_location_id),
  check (current_leg_sequence is null or current_leg_sequence > 0),
  check (arrived_at is null or status = 'arrived')
);

create table if not exists public.travel_journey_participants (
  id bigint generated always as identity primary key,
  journey_id bigint not null
    references public.travel_journeys(id) on delete cascade,
  character_id integer references public.playable_characters(id) on delete restrict,
  house_id bigint references public.houses(id) on delete restrict,
  user_id uuid references auth.users(id) on delete cascade,
  participant_role text not null default 'traveller',
  participation_status text not null default 'travelling'
    check (participation_status in ('travelling', 'joined', 'arrived', 'left', 'captured', 'missing')),
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(character_id, house_id, user_id) >= 1),
  check (left_at is null or joined_at is null or left_at >= joined_at)
);

create unique index if not exists travel_journey_character_participant_uidx
  on public.travel_journey_participants (journey_id, character_id)
  where character_id is not null;

create unique index if not exists travel_active_character_journey_uidx
  on public.travel_journey_participants (character_id)
  where character_id is not null
    and participation_status in ('travelling', 'joined');

create table if not exists public.travel_journey_legs (
  id bigint generated always as identity primary key,
  journey_id bigint not null
    references public.travel_journeys(id) on delete cascade,
  sequence_number smallint not null check (sequence_number > 0),
  route_option_leg_id bigint
    references public.travel_route_option_legs(id) on delete restrict,
  route_edge_id bigint not null
    references public.travel_route_edges(id) on delete restrict,
  direction_reversed boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'skipped', 'blocked')),
  estimated_days integer check (estimated_days is null or estimated_days >= 0),
  actual_departure_at timestamptz,
  actual_arrival_at timestamptz,
  actual_distance_miles numeric(10, 2)
    check (actual_distance_miles is null or actual_distance_miles >= 0),
  delay_days integer not null default 0 check (delay_days >= 0),
  state_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (journey_id, sequence_number),
  check (
    actual_arrival_at is null or actual_departure_at is null
    or actual_arrival_at >= actual_departure_at
  )
);

create or replace function public.validate_travel_journey_route()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  route public.travel_route_options%rowtype;
begin
  if tg_op = 'INSERT' and new.status <> 'planned' then
    raise exception 'A new journey must start in planned status.';
  end if;

  select * into route
  from public.travel_route_options
  where id = new.route_option_id;

  if not found or route.catalog_status <> 'available' then
    raise exception 'Journey must use an available travel route option.';
  end if;

  if not (
    (route.origin_location_id = new.origin_location_id
      and route.destination_location_id = new.destination_location_id)
    or
    (route.origin_location_id = new.destination_location_id
      and route.destination_location_id = new.origin_location_id)
  ) then
    raise exception 'Journey locations do not match the selected route option.';
  end if;

  if not exists (
    select 1
    from public.travel_route_option_legs
    where route_option_id = route.id
  ) then
    raise exception 'Selected travel route option has no connected route legs.';
  end if;

  return new;
end
$$;

drop trigger if exists travel_journey_validate_route
  on public.travel_journeys;

create trigger travel_journey_validate_route
before insert or update of route_option_id, origin_location_id, destination_location_id
on public.travel_journeys
for each row execute function public.validate_travel_journey_route();

create or replace function public.create_travel_journey_legs()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  reverse_route boolean;
begin
  select
    route.origin_location_id = new.destination_location_id
  into reverse_route
  from public.travel_route_options as route
  where route.id = new.route_option_id;

  insert into public.travel_journey_legs (
    journey_id,
    sequence_number,
    route_option_leg_id,
    route_edge_id,
    direction_reversed
  )
  select
    new.id,
    row_number() over (
      order by
        case when reverse_route then option_leg.sequence_number end desc,
        case when not reverse_route then option_leg.sequence_number end asc
    )::smallint,
    option_leg.id,
    option_leg.route_edge_id,
    reverse_route
  from public.travel_route_option_legs as option_leg
  where option_leg.route_option_id = new.route_option_id;

  return new;
end
$$;

drop trigger if exists travel_journey_create_legs
  on public.travel_journeys;

create trigger travel_journey_create_legs
after insert on public.travel_journeys
for each row execute function public.create_travel_journey_legs();

create index if not exists travel_route_edges_origin_idx
  on public.travel_route_edges (from_location_id);

create index if not exists travel_route_edges_destination_idx
  on public.travel_route_edges (to_location_id);

create index if not exists travel_route_edges_controller_idx
  on public.travel_route_edges (controller_house_id);

create index if not exists travel_route_options_origin_idx
  on public.travel_route_options (origin_location_id, option_type);

create index if not exists travel_route_options_destination_idx
  on public.travel_route_options (destination_location_id, option_type);

create index if not exists travel_journeys_status_idx
  on public.travel_journeys (status, planned_departure_at);

create index if not exists travel_journey_participants_character_idx
  on public.travel_journey_participants (character_id);

create or replace function public.validate_travel_route_option_leg()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  edge public.travel_route_edges%rowtype;
  route public.travel_route_options%rowtype;
  edge_corridor text;
  from_name text;
  to_name text;
begin
  select * into route
  from public.travel_route_options
  where id = new.route_option_id;

  if not found or route.catalog_status <> 'available' then
    raise exception 'Travel route option % is not available.', new.route_option_id;
  end if;

  select * into edge
  from public.travel_route_edges
  where id = new.route_edge_id;

  if not found then
    raise exception 'Travel route edge % does not exist.', new.route_edge_id;
  end if;

  if not (
    (edge.from_location_id = new.from_location_id
      and edge.to_location_id = new.to_location_id)
    or
    (edge.is_bidirectional
      and edge.from_location_id = new.to_location_id
      and edge.to_location_id = new.from_location_id)
  ) then
    raise exception
      'Travel route option leg endpoints do not match edge %.', new.route_edge_id;
  end if;

  if new.sequence_number >= cardinality(route.playable_path) then
    raise exception 'Route leg sequence exceeds the selected itinerary path.';
  end if;

  select name into from_name
  from public.playable_locations
  where id = new.from_location_id;
  select name into to_name
  from public.playable_locations
  where id = new.to_location_id;
  select corridor_name into edge_corridor
  from public.travel_corridors
  where id = edge.corridor_id;

  if route.playable_path[new.sequence_number] <> from_name
    or route.playable_path[new.sequence_number + 1] <> to_name
    or route.leg_modes[new.sequence_number] <> edge.mode
    or route.corridor_names[new.sequence_number] <> edge_corridor then
    raise exception
      'Route leg % does not match the selected itinerary path and edge data.',
      new.sequence_number;
  end if;

  return new;
end
$$;

drop trigger if exists travel_route_option_leg_validate
  on public.travel_route_option_legs;

create trigger travel_route_option_leg_validate
before insert or update on public.travel_route_option_legs
for each row execute function public.validate_travel_route_option_leg();

create or replace function public.record_travel_journey_arrival()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  event_id bigint;
  affected_ids integer[];
  origin_name text;
  destination_name text;
  world_date_label text;
begin
  if old.status = 'arrived' or new.status <> 'arrived' then
    return new;
  end if;

  if exists (
    select 1
    from public.travel_journey_legs as leg
    where leg.journey_id = new.id
      and leg.status not in ('completed', 'skipped')
  ) then
    raise exception 'Cannot mark journey % arrived while route legs remain incomplete.', new.id;
  end if;

  if not exists (
    select 1 from public.travel_journey_legs where journey_id = new.id
  ) then
    raise exception 'Cannot mark journey % arrived without route legs.', new.id;
  end if;

  select array_agg(participant.character_id::integer order by participant.character_id)
  into affected_ids
  from public.travel_journey_participants as participant
  where participant.journey_id = new.id
    and participant.character_id is not null
    and participant.participation_status in ('travelling', 'joined');

  select name into origin_name
  from public.playable_locations where id = new.origin_location_id;
  select name into destination_name
  from public.playable_locations where id = new.destination_location_id;
  select date_description into world_date_label
  from public.world_state where id = new.world_state_id;

  insert into public.game_events (
    world_state_id,
    world_date_label,
    event_type,
    title,
    canonical_summary,
    public_summary,
    affected_character_ids,
    location,
    location_id,
    state_changes
  )
  values (
    new.world_state_id,
    world_date_label,
    'movement',
    'Journey arrived at ' || destination_name,
    'The travelling party arrived at ' || destination_name
      || ' after departing from ' || origin_name || '.',
    null,
    coalesce(affected_ids, '{}'::integer[]),
    destination_name,
    new.destination_location_id,
    jsonb_build_array(jsonb_build_object(
      'changeType', 'travel_arrival',
      'description', 'Journey ' || new.id || ' arrived at ' || destination_name || '.',
      'target', jsonb_build_object(
        'type', 'location',
        'id', new.destination_location_id
      ),
      'structuredChange', jsonb_build_object(
        'journey_id', new.id,
        'origin_location_id', new.origin_location_id,
        'destination_location_id', new.destination_location_id
      )
    ))
  )
  returning id into event_id;

  insert into public.playable_character_state_history (
    character_id,
    event_type,
    old_location_id,
    new_location_id,
    old_state,
    new_state,
    change_note,
    changed_at
  )
  select
    character.id,
    'travel_arrival',
    character.current_location_id,
    new.destination_location_id,
    jsonb_build_object('journey_id', new.id, 'status', old.status),
    jsonb_build_object('journey_id', new.id, 'status', 'arrived'),
    'Journey arrival event ' || event_id,
    now()
  from public.travel_journey_participants as participant
  join public.playable_characters as character
    on character.id = participant.character_id
  where participant.journey_id = new.id
    and participant.participation_status in ('travelling', 'joined');

  update public.playable_characters as character
  set current_location_id = new.destination_location_id,
      updated_at = now()
  from public.travel_journey_participants as participant
  where participant.journey_id = new.id
    and participant.character_id = character.id
    and participant.participation_status in ('travelling', 'joined');

  update public.user_character_assignments as assignment
  set current_location_id = new.destination_location_id,
      updated_at = now()
  from public.travel_journey_participants as participant
  where participant.journey_id = new.id
    and participant.character_id = assignment.character_id
    and participant.participation_status in ('travelling', 'joined');

  update public.travel_journey_participants
  set participation_status = 'arrived',
      left_at = coalesce(left_at, now())
  where journey_id = new.id
    and participation_status in ('travelling', 'joined');

  update public.travel_journeys
  set arrival_event_id = event_id,
      arrived_at = coalesce(new.arrived_at, now()),
      updated_at = now()
  where id = new.id;

  return new;
end
$$;

drop trigger if exists travel_journey_record_arrival
  on public.travel_journeys;

create trigger travel_journey_record_arrival
after update of status on public.travel_journeys
for each row execute function public.record_travel_journey_arrival();

alter table public.travel_workbook_imports enable row level security;

alter table public.travel_workbook_rows enable row level security;

alter table public.travel_sources enable row level security;

alter table public.travel_location_reference enable row level security;

alter table public.travel_corridors enable row level security;

alter table public.travel_transit_nodes enable row level security;

alter table public.travel_route_edges enable row level security;

alter table public.travel_route_edge_waypoints enable row level security;

alter table public.travel_route_options enable row level security;

alter table public.travel_route_option_legs enable row level security;

alter table public.travel_assumptions enable row level security;

alter table public.travel_route_control_fields enable row level security;

alter table public.travel_distance_conflicts enable row level security;

alter table public.travel_legacy_corridor_edges enable row level security;

alter table public.travel_journeys enable row level security;

alter table public.travel_journey_participants enable row level security;

alter table public.travel_journey_legs enable row level security;

revoke all on public.travel_workbook_imports, public.travel_workbook_rows,
  public.travel_sources, public.travel_location_reference,
  public.travel_corridors, public.travel_transit_nodes,
  public.travel_route_edges, public.travel_route_edge_waypoints,
  public.travel_route_options, public.travel_route_option_legs,
  public.travel_assumptions, public.travel_route_control_fields,
  public.travel_distance_conflicts, public.travel_legacy_corridor_edges,
  public.travel_journeys, public.travel_journey_participants,
  public.travel_journey_legs
from anon, authenticated;

grant select, insert, update, delete on public.travel_workbook_imports,
  public.travel_workbook_rows, public.travel_sources,
  public.travel_location_reference, public.travel_corridors,
  public.travel_transit_nodes, public.travel_route_edges,
  public.travel_route_edge_waypoints, public.travel_route_options,
  public.travel_route_option_legs, public.travel_assumptions,
  public.travel_route_control_fields, public.travel_distance_conflicts,
  public.travel_legacy_corridor_edges, public.travel_journeys,
  public.travel_journey_participants, public.travel_journey_legs
to service_role;

grant usage, select on sequence
  public.travel_workbook_imports_id_seq,
  public.travel_sources_id_seq,
  public.travel_corridors_id_seq,
  public.travel_transit_nodes_id_seq,
  public.travel_route_edges_id_seq,
  public.travel_route_options_id_seq,
  public.travel_route_option_legs_id_seq,
  public.travel_assumptions_id_seq,
  public.travel_route_control_fields_id_seq,
  public.travel_distance_conflicts_id_seq,
  public.travel_legacy_corridor_edges_id_seq,
  public.travel_journeys_id_seq,
  public.travel_journey_participants_id_seq,
  public.travel_journey_legs_id_seq
to service_role;

commit;
