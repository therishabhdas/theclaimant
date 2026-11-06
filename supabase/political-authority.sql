-- Run after gameplay-engine.sql and global-turn-cycle.sql.
-- Adds political offices and delegations without replacing the existing
-- house, territory, treasury, military, relationship, or claim records.

begin;

do $$
begin
  if to_regclass('public.gameplay_turn_orders') is null
    or to_regclass('public.gameplay_npc_orders') is null
    or to_regclass('public.gameplay_turn_resolutions') is null then
    raise exception
      'Run gameplay-engine.sql and global-turn-cycle.sql before political-authority.sql.';
  end if;
end
$$;

create table if not exists public.political_entities (
  id bigint generated always as identity primary key,
  entity_key text not null unique check (length(trim(entity_key)) > 0),
  entity_type text not null check (length(trim(entity_type)) > 0),
  name text not null check (length(trim(name)) > 0),
  house_id bigint references public.houses(id) on delete cascade,
  region_id smallint references public.world_regions(id) on delete cascade,
  location_id bigint references public.playable_locations(id) on delete cascade,
  institution_key text,
  created_at timestamptz not null default now(),
  check (num_nonnulls(house_id, region_id, location_id, institution_key) = 1)
);

create table if not exists public.political_authority_positions (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  entity_id bigint not null
    references public.political_entities(id) on delete restrict,
  character_id integer
    references public.playable_characters(id) on delete set null,
  position_name text not null check (length(trim(position_name)) > 0),
  responsibilities text,
  scope_region_id smallint references public.world_regions(id) on delete set null,
  scope_location_id bigint references public.playable_locations(id) on delete set null,
  appointment_basis text not null default 'unknown'
    check (appointment_basis in (
      'succession', 'inheritance', 'appointment', 'regency', 'delegation',
      'election', 'conquest', 'claim', 'other', 'unknown'
    )),
  position_status text not null default 'unknown'
    check (position_status in (
      'active', 'vacant', 'contested', 'suspended', 'removed', 'unknown'
    )),
  recognition_status text not null default 'unknown'
    check (recognition_status in (
      'recognized', 'contested', 'unrecognized', 'unknown'
    )),
  is_disputed boolean not null default false,
  is_public boolean not null default false,
  recognized_by text,
  recognized_by_character_id integer
    references public.playable_characters(id) on delete set null,
  valid_from_turn integer not null default 0 check (valid_from_turn >= 0),
  valid_through_turn integer check (
    valid_through_turn is null or valid_through_turn >= valid_from_turn
  ),
  source_key text unique,
  source_event_id bigint references public.game_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists political_authority_character_status_idx
  on public.political_authority_positions (character_id, position_status);
create index if not exists political_authority_entity_status_idx
  on public.political_authority_positions (entity_id, position_status);

create table if not exists public.political_delegations (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  authority_position_id bigint not null
    references public.political_authority_positions(id) on delete restrict,
  delegator_character_id integer not null
    references public.playable_characters(id) on delete restrict,
  delegate_character_id integer not null
    references public.playable_characters(id) on delete restrict,
  responsibilities text not null check (length(trim(responsibilities)) > 0),
  scope_region_id smallint references public.world_regions(id) on delete set null,
  scope_location_id bigint references public.playable_locations(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired', 'contested', 'unknown')),
  recognition_status text not null default 'unknown'
    check (recognition_status in (
      'recognized', 'contested', 'unrecognized', 'unknown'
    )),
  is_public boolean not null default false,
  starts_turn integer not null default 0 check (starts_turn >= 0),
  ends_turn integer check (ends_turn is null or ends_turn >= starts_turn),
  source_event_id bigint references public.game_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delegator_character_id <> delegate_character_id)
);

create index if not exists political_delegations_delegate_status_idx
  on public.political_delegations (delegate_character_id, status);

create table if not exists public.political_authority_recognitions (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  authority_position_id bigint not null
    references public.political_authority_positions(id) on delete cascade,
  recognized_by_character_id integer not null
    references public.playable_characters(id) on delete cascade,
  recognition_status text not null
    check (recognition_status in ('recognized', 'disputed')),
  is_public boolean not null default false,
  turn_number integer not null check (turn_number >= 0),
  source_event_id bigint references public.game_events(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (authority_position_id, recognized_by_character_id, turn_number)
);

create table if not exists public.political_authority_history (
  id bigint generated always as identity primary key,
  authority_position_id bigint
    references public.political_authority_positions(id) on delete set null,
  changed_by_character_id integer
    references public.playable_characters(id) on delete set null,
  turn_number integer not null default 0 check (turn_number >= 0),
  change_type text not null check (length(trim(change_type)) > 0),
  old_state jsonb,
  new_state jsonb,
  source_event_id bigint references public.game_events(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.political_territorial_control_history (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  location_id bigint not null
    references public.playable_locations(id) on delete restrict,
  previous_house_id bigint references public.houses(id) on delete set null,
  new_house_id bigint references public.houses(id) on delete set null,
  changed_by_character_id integer
    references public.playable_characters(id) on delete set null,
  turn_number integer not null check (turn_number > 0),
  source_event_id bigint references public.game_events(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.political_action_outcomes (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  turn_number integer not null check (turn_number > 0),
  actor_character_id integer not null
    references public.playable_characters(id) on delete restrict,
  action_operation text not null check (length(trim(action_operation)) > 0),
  action_data jsonb not null check (jsonb_typeof(action_data) = 'object'),
  resolution_plan jsonb not null default '{}'::jsonb
    check (jsonb_typeof(resolution_plan) = 'object'),
  order_accepted boolean not null,
  execution_status text not null
    check (execution_status in (
      'not_attempted', 'attempted', 'executed', 'partially_executed',
      'failed', 'resisted', 'delayed'
    )),
  authority_status text not null
    check (authority_status in ('recognized', 'contested', 'unrecognized', 'unknown')),
  consequence text not null,
  state_changes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(state_changes) = 'array'),
  source_event_id bigint references public.game_events(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (world_state_id, turn_number, actor_character_id)
);

alter table public.political_action_outcomes
  add column if not exists resolution_plan jsonb not null default '{}'::jsonb;
alter table public.political_action_outcomes
  add column if not exists state_changes jsonb not null default '[]'::jsonb;
alter table public.political_action_outcomes
  drop constraint if exists political_action_outcomes_execution_status_check;
alter table public.political_action_outcomes
  add constraint political_action_outcomes_execution_status_check
  check (execution_status in (
    'not_attempted', 'attempted', 'executed', 'partially_executed',
    'failed', 'resisted', 'delayed'
  ));

create table if not exists public.political_detentions (
  id bigint generated always as identity primary key,
  world_state_id smallint not null default 1
    references public.world_state(id) on delete restrict,
  prisoner_character_id integer not null
    references public.playable_characters(id) on delete restrict,
  custodian_character_id integer not null
    references public.playable_characters(id) on delete restrict,
  location_id bigint references public.playable_locations(id) on delete set null,
  status text not null default 'attempted'
    check (status in ('attempted', 'held', 'released', 'escaped', 'unknown')),
  reason text,
  started_turn integer not null check (started_turn > 0),
  ended_turn integer check (ended_turn is null or ended_turn >= started_turn),
  source_event_id bigint references public.game_events(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.political_entities (entity_key, entity_type, name, house_id)
select 'house:' || house.id, 'house', house.name, house.id
from public.houses as house
on conflict (entity_key) do nothing;

insert into public.political_entities (entity_key, entity_type, name, region_id)
select 'region:' || region.id, 'region', region.name, region.id
from public.world_regions as region
on conflict (entity_key) do nothing;

insert into public.political_entities (entity_key, entity_type, name, location_id)
select 'location:' || location.id, 'location', location.name, location.id
from public.playable_locations as location
on conflict (entity_key) do nothing;

insert into public.political_entities (
  entity_key, entity_type, name, institution_key
)
values ('institution:iron-throne', 'institution', 'The Iron Throne', 'iron-throne')
on conflict (entity_key) do nothing;

-- Only single, unambiguous opening heads already present in the playable
-- roster are promoted to house-head offices.
insert into public.political_authority_positions (
  entity_id, character_id, position_name, responsibilities, scope_region_id,
  appointment_basis, position_status, recognition_status, is_public, source_key
)
select
  entity.id,
  character.id,
  'Head of ' || house.name,
  'House leadership; practical responsibilities and obedience remain contextual.',
  house.region_id,
  'succession',
  'active',
  'recognized',
  true,
  'opening:house-head:' || house.id
from public.houses as house
join public.political_entities as entity
  on entity.entity_key = 'house:' || house.id
join public.playable_characters as character
  on lower(trim(character.display_name)) = lower(trim(house.opening_head))
where house.opening_head is not null
  and length(trim(house.opening_head)) > 0
  and house.opening_head not like '%,%'
  and house.opening_head not like '%;%'
  and house.opening_head not ilike '% and %'
on conflict (source_key) do nothing;

insert into public.political_authority_positions (
  entity_id, character_id, position_name, responsibilities,
  scope_region_id, scope_location_id, appointment_basis, position_status,
  recognition_status, is_disputed, is_public, recognized_by, source_key
)
select
  entity.id, character.id, seed.position_name, seed.responsibilities,
  region.id, location.id, seed.appointment_basis, seed.position_status,
  seed.recognition_status, seed.is_disputed, true, seed.recognized_by,
  seed.source_key
from (
  values
    ('institution:iron-throne', 'Joffrey Baratheon',
      'Heir apparent to the Iron Throne',
      'Treated by the royal court as Robert Baratheon''s heir; succession remains disputed.',
      'unknown', 'active', 'recognized', true, 'the royal court',
      'opening:heir:joffrey', 'The Crownlands', 'Red Keep'),
    ('institution:iron-throne', 'Eddard Stark', 'Hand of the King',
      'The king''s principal minister; duties and practical reach depend on circumstances.',
      'appointment', 'active', 'recognized', false, 'the Crown',
      'opening:hand:eddard', 'The Crownlands', 'Red Keep'),
    ('House Stark', 'Eddard Stark', 'Head of House Stark',
      'House Stark remains the ruling house of the North; Eddard is in King''s Landing.',
      'succession', 'active', 'recognized', false, 'the North',
      'opening:house-head:stark', 'The North', 'Winterfell'),
    ('institution:iron-throne', 'Cersei Lannister', 'Queen Regent',
      'Acts as regent in the royal household; the scope of obedience is not assumed.',
      'regency', 'active', 'recognized', false, 'the royal household',
      'opening:regent:cersei', 'The Crownlands', 'Red Keep'),
    ('institution:iron-throne', 'Barristan Selmy', 'Lord Commander of the Kingsguard',
      'Commands the Kingsguard; individual members may still exercise judgment.',
      'appointment', 'active', 'recognized', false, 'the Crown',
      'opening:kingsguard-command:barristan', 'The Crownlands', 'Red Keep'),
    ('institution:iron-throne', 'Petyr Baelish', 'Master of Coin',
      'Oversees royal finances; access to funds and compliance are not presumed.',
      'appointment', 'active', 'recognized', false, 'the Crown',
      'opening:small-council:coin', 'The Crownlands', 'Red Keep'),
    ('institution:iron-throne', 'Varys', 'Master of Whisperers',
      'Serves on the Small Council; private networks and intentions remain private.',
      'appointment', 'active', 'recognized', false, 'the Crown',
      'opening:small-council:whisperers', 'The Crownlands', 'Red Keep'),
    ('institution:iron-throne', 'Pycelle', 'Grand Maester',
      'Serves the royal court; the office does not confer command over other institutions.',
      'appointment', 'active', 'recognized', false, 'the Crown',
      'opening:grand-maester:pycelle', 'The Crownlands', 'Red Keep'),
    ('House Arryn', 'Robert Arryn', 'Lord of the Vale',
      'Recognized head of House Arryn; Lysa Arryn governs as regent.',
      'succession', 'active', 'recognized', false, 'the Vale',
      'opening:vale-lord:robert', 'The Vale', 'The Eyrie'),
    ('House Arryn', 'Lysa Arryn', 'Regent of the Vale',
      'Exercises regency for Robert Arryn; the extent of compliance is circumstantial.',
      'regency', 'active', 'recognized', false, 'the Vale',
      'opening:vale-regent:lysa', 'The Vale', 'The Eyrie'),
    ('House Greyjoy', 'Balon Greyjoy', 'Lord of the Iron Islands',
      'Heads House Greyjoy; no renewed rebellion is presumed.',
      'succession', 'active', 'recognized', false, 'the Iron Islands',
      'opening:iron-islands-lord:balon', 'The Iron Islands', 'Pyke'),
    ('House Baratheon of Dragonstone', 'Stannis Baratheon',
      'Lord of Dragonstone',
      'Holds Dragonstone and is Robert Baratheon''s elder surviving brother.',
      'succession', 'active', 'recognized', false, 'Dragonstone',
      'opening:dragonstone-lord:stannis', 'The Crownlands', 'Dragonstone'),
    ('institution:iron-throne', null, 'King of the Seven Kingdoms',
      'The king is dead; no uncontested transfer of the Crown has been established.',
      'unknown', 'vacant', 'contested', true, null,
      'opening:vacant-crown', 'The Crownlands', 'Red Keep')
) as seed (
  entity_key, character_name, position_name, responsibilities,
  appointment_basis, position_status, recognition_status, is_disputed,
  recognized_by, source_key, region_name, location_name
)
join public.political_entities as entity
  on entity.entity_key = seed.entity_key
  or (entity.entity_type = 'house' and entity.name = seed.entity_key)
left join public.playable_characters as character
  on lower(trim(character.display_name)) = lower(trim(seed.character_name))
left join public.world_regions as region on region.name = seed.region_name
left join public.playable_locations as location on location.name = seed.location_name
where seed.character_name is null or character.id is not null
on conflict (source_key) do nothing;

-- Preserve every remaining roster title as an unverified position rather than
-- silently promoting a catalogue label into recognized authority.
insert into public.political_authority_positions (
  entity_id, character_id, position_name, responsibilities,
  scope_region_id, scope_location_id, appointment_basis, position_status,
  recognition_status, is_public, source_key
)
select
  coalesce(house_entity.id, throne_entity.id),
  character.id,
  trim(character.opening_title),
  'Opening roster title; formal basis, scope, and recognition are not established by this title alone.',
  character.world_region_id,
  character.current_location_id,
  'unknown',
  'unknown',
  'unknown',
  true,
  'opening-title:' || character.id
from public.playable_characters as character
left join public.political_entities as house_entity
  on house_entity.entity_key = 'house:' ||
    coalesce(character.current_house_id, character.starting_house_id)
join public.political_entities as throne_entity
  on throne_entity.entity_key = 'institution:iron-throne'
where character.opening_title is not null
  and length(trim(character.opening_title)) > 0
  and coalesce(character.current_life_status, '') not ilike '%dead%'
  and coalesce(character.current_life_status, '') not ilike '%deceased%'
  and not exists (
    select 1
    from public.political_authority_positions as position
    where position.character_id = character.id
      and position.position_name = trim(character.opening_title)
  )
on conflict (source_key) do nothing;

create or replace view public.character_political_influence as
select
  character.id as character_id,
  character.current_house_id,
  coalesce(character.political_power, 0)::integer as political_reputation,
  coalesce(character.diplomatic_power, 0)::integer as diplomatic_reputation,
  coalesce(character.legitimacy_power, 0)::integer as legitimacy,
  coalesce(house.treasury_amount, 0)::numeric(18, 2) as associated_house_wealth,
  coalesce(house.army_size, 0)::integer as associated_house_force,
  coalesce((
    select count(*)::integer
    from public.political_authority_positions as position
    cross join public.world_state as world
    where position.character_id = character.id
      and position.position_status = 'active'
      and position.recognition_status = 'recognized'
      and position.valid_from_turn <= world.turn_number
      and (
        position.valid_through_turn is null
        or position.valid_through_turn >= world.turn_number
      )
  ), 0) as recognized_offices,
  coalesce((
    select count(*)::integer
    from public.political_delegations as delegation
    cross join public.world_state as world
    where delegation.delegate_character_id = character.id
      and delegation.status = 'active'
      and delegation.recognition_status = 'recognized'
      and delegation.starts_turn <= world.turn_number
      and (delegation.ends_turn is null or delegation.ends_turn >= world.turn_number)
  ), 0) as recognized_delegated_responsibilities,
  coalesce((
    select sum(loyalty.strength)::integer
    from public.character_loyalties as loyalty
    where loyalty.loyal_to_character_id = character.id
  ), 0) as personal_loyalty_support,
  coalesce((
    select count(*)::integer
    from public.diplomacy_records as relation
    where relation.status = 'active'
      and relation.relation_type = 'alliance'
      and (
        relation.character_a_id = character.id
        or relation.character_b_id = character.id
        or (
          character.current_house_id is not null
          and (
            relation.house_a_id = character.current_house_id
            or relation.house_b_id = character.current_house_id
          )
        )
      )
  ), 0) as active_alliances,
  coalesce((
    select sum(muster.force_size)::integer
    from public.game_muster_orders as muster
    where muster.requested_by_character_id = character.id
      and muster.status in ('mustering', 'ready')
  ), 0) as forces_personally_mustered,
  coalesce((
    select count(*)::integer
    from public.house_location_relations as control
    where control.house_id = character.current_house_id
      and control.relation_type = 'current_control'
  ), 0) as controlled_locations,
  coalesce((
    select count(*)::integer
    from public.character_secret_knowledge as knowledge
    join public.character_secrets as secret on secret.id = knowledge.secret_id
    where knowledge.character_id = character.id
      and knowledge.knowledge_status in ('knows', 'learned', 'suspects')
      and secret.subject_character_id is not null
      and secret.subject_character_id <> character.id
  ), 0) as known_leverage_facts
from public.playable_characters as character
left join public.houses as house
  on house.id = character.current_house_id;

create or replace function public.record_political_authority_history()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  turn_number integer;
begin
  select world.turn_number into turn_number
  from public.world_state as world
  where world.id = new.world_state_id;

  insert into public.political_authority_history (
    authority_position_id, changed_by_character_id, turn_number,
    change_type, old_state, new_state
  )
  values (
    new.id,
    nullif(current_setting('app.political_actor_id', true), '')::integer,
    coalesce(turn_number, 0),
    case when tg_op = 'INSERT' then 'created' else 'updated' end,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end
$$;

drop trigger if exists political_authority_history_trigger
  on public.political_authority_positions;
create trigger political_authority_history_trigger
after insert or update of
  world_state_id, entity_id, character_id, position_name, responsibilities,
  scope_region_id, scope_location_id, appointment_basis, position_status,
  recognition_status, is_disputed, is_public, recognized_by,
  recognized_by_character_id, valid_from_turn, valid_through_turn
on public.political_authority_positions
for each row execute function public.record_political_authority_history();

create or replace function public.resolve_political_actions_for_turn()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  order_row record;
  actor_house_id bigint;
  entity_id bigint;
  region_id smallint;
  position_id bigint;
  delegation_id bigint;
  claim_id bigint;
  recognition_id bigint;
  detention_id bigint;
  outcome_id bigint;
  resolution_plan jsonb;
  planned_result text;
  planned_consequence text;
  state_changes jsonb;
  effect_row record;
  previous_effect_value text;
  resulting_effect_value text;
  previous_position_state jsonb;
  resulting_position_state jsonb;
  previous_delegation_state jsonb;
  resulting_delegation_state jsonb;
  v_consequence text;
  v_execution_status text;
  v_authority_status text;
  v_is_public boolean;
  affected_rows integer;
begin
  if new.turn_number <= old.turn_number then
    return new;
  end if;

  for order_row in
    select orders.character_id as actor_id,
      orders.action_data -> 0 as action,
      orders.resolution_status, orders.resolution_note,
      orders.resolution_outcome
    from public.gameplay_turn_orders as orders
    where orders.world_state_id = new.id
      and orders.turn_number = new.turn_number
      and orders.resolution_status in ('accepted', 'rejected')
    union all
    select orders.character_id as actor_id,
      orders.action_data -> 0 as action,
      orders.resolution_status, orders.resolution_note,
      orders.resolution_outcome
    from public.gameplay_npc_orders as orders
    where orders.world_state_id = new.id
      and orders.turn_number = new.turn_number
      and orders.resolution_status in ('accepted', 'rejected')
  loop
    if order_row.action is null
      or order_row.action ->> 'type' is distinct from 'political_action' then
      continue;
    end if;

    outcome_id := null;
    insert into public.political_action_outcomes (
      world_state_id, turn_number, actor_character_id, action_operation,
      action_data, resolution_plan, order_accepted, execution_status,
      authority_status, consequence, state_changes
    )
    values (
      new.id, new.turn_number, order_row.actor_id,
      order_row.action ->> 'operation', order_row.action,
      coalesce(order_row.resolution_outcome, '{}'::jsonb),
      order_row.resolution_status = 'accepted',
      'attempted', 'unknown',
      'The action was attempted; its political recognition is unresolved.',
      '[]'::jsonb
    )
    on conflict (world_state_id, turn_number, actor_character_id) do nothing
    returning id into outcome_id;

    if outcome_id is null then
      continue;
    end if;

    if order_row.resolution_status <> 'accepted' then
      update public.political_action_outcomes
      set execution_status = 'failed',
          consequence = 'The political order was not accepted; no political effect was applied.'
      where id = outcome_id;
      continue;
    end if;

    resolution_plan := order_row.resolution_outcome;
    planned_result := resolution_plan ->> 'result';
    planned_consequence := resolution_plan ->> 'consequence';
    state_changes := '[]'::jsonb;
    position_id := null;
    delegation_id := null;
    claim_id := null;
    recognition_id := null;
    detention_id := null;
    previous_position_state := null;
    previous_delegation_state := null;
    if order_row.action ->> 'authorityPositionId' is not null then
      select jsonb_build_object(
        'characterId', position.character_id,
        'positionStatus', position.position_status,
        'recognitionStatus', position.recognition_status,
        'isDisputed', position.is_disputed
      )
      into previous_position_state
      from public.political_authority_positions as position
      where position.id = (order_row.action ->> 'authorityPositionId')::bigint;
      position_id := (order_row.action ->> 'authorityPositionId')::bigint;
    end if;
    if order_row.action ->> 'delegationId' is not null then
      select jsonb_build_object(
        'status', delegation.status,
        'delegateCharacterId', delegation.delegate_character_id
      )
      into previous_delegation_state
      from public.political_delegations as delegation
      where delegation.id = (order_row.action ->> 'delegationId')::bigint;
      delegation_id := (order_row.action ->> 'delegationId')::bigint;
    end if;
    if planned_result is null
      or planned_result not in (
        'executed', 'partially_executed', 'attempted', 'failed', 'resisted', 'delayed'
      )
      or planned_consequence is null
      or jsonb_typeof(resolution_plan -> 'effects') is distinct from 'array' then
      update public.political_action_outcomes
      set execution_status = 'failed',
          consequence = 'The political attempt has no valid contextual adjudication plan.'
      where id = outcome_id;
      continue;
    end if;
    if planned_result not in ('executed', 'partially_executed') then
      update public.political_action_outcomes
      set execution_status = planned_result,
          authority_status = 'unknown',
          consequence = case planned_result
            when 'attempted' then
              'The action remained an attempt; no supported political state change was committed.'
            when 'failed' then
              'The action did not achieve its political goal; no supported state change was committed.'
            when 'resisted' then
              'The stated political goal was resisted; no supported state change was committed.'
            else
              'The political result remains unresolved; no supported state change was committed.'
          end,
          resolution_plan = resolution_plan
      where id = outcome_id;
      continue;
    end if;

    select coalesce(character.current_house_id, character.starting_house_id)
    into actor_house_id
    from public.playable_characters as character
    where character.id = order_row.actor_id;
    v_is_public := coalesce((order_row.action ->> 'isPublic')::boolean, false);

    case order_row.action ->> 'operation'
      when 'claim_title' then
        insert into public.political_claims (
          claimant_character_id, claimant_house_id, target_title,
          claim_status, summary
        )
        values (
          order_row.actor_id, actor_house_id,
          order_row.action ->> 'targetTitle', 'contested',
          nullif(order_row.action ->> 'details', '')
        )
        returning id into claim_id;
        v_execution_status := 'executed';
        v_authority_status := 'contested';
        v_consequence := 'The claim was recorded; it does not itself confer recognized authority.';
        state_changes := jsonb_build_array(jsonb_build_object(
          'type', 'claim',
          'id', claim_id,
          'previousState', null,
          'resultingState', jsonb_build_object(
            'claimantCharacterId', order_row.actor_id,
            'claimantHouseId', actor_house_id,
            'targetTitle', order_row.action ->> 'targetTitle',
            'claimStatus', 'contested'
          )
        ));

      when 'appoint' then
        entity_id := case
          when (order_row.action ->> 'targetHouseId') is not null then
            (select entity.id from public.political_entities as entity
             where entity.entity_key = 'house:' || (order_row.action ->> 'targetHouseId'))
          when (order_row.action ->> 'targetLocationId') is not null then
            (select entity.id from public.political_entities as entity
             where entity.entity_key = 'location:' || (order_row.action ->> 'targetLocationId'))
          else
            (select entity.id from public.political_entities as entity
             where entity.entity_key = 'institution:iron-throne')
        end;
        if entity_id is null
          or nullif(trim(order_row.action ->> 'targetTitle'), '') is null
          or not exists (
            select 1
            from public.playable_characters as target
            where target.id = (order_row.action ->> 'targetCharacterId')::integer
          ) then
          v_execution_status := 'failed';
          v_authority_status := 'unknown';
          v_consequence := 'The appointment could not be linked to a known political entity and character.';
        else
          region_id := null;
          if (order_row.action ->> 'targetHouseId') is not null then
            select house.region_id into region_id from public.houses as house
            where house.id = (order_row.action ->> 'targetHouseId')::bigint;
          elsif (order_row.action ->> 'targetLocationId') is not null then
            select location.world_region_id into region_id
            from public.playable_locations as location
            where location.id = (order_row.action ->> 'targetLocationId')::bigint;
          end if;
          perform set_config('app.political_actor_id', order_row.actor_id::text, true);
          insert into public.political_authority_positions (
            entity_id, character_id, position_name, responsibilities,
            scope_region_id, scope_location_id, appointment_basis, position_status,
            recognition_status, is_disputed, is_public,
            valid_from_turn
          )
          values (
            entity_id,
            (order_row.action ->> 'targetCharacterId')::integer,
            order_row.action ->> 'targetTitle',
            nullif(order_row.action ->> 'details', ''),
            region_id,
            (order_row.action ->> 'targetLocationId')::bigint,
            'appointment', 'contested', 'unrecognized', true,
            v_is_public, new.turn_number
          )
          returning id into position_id;
          v_execution_status := 'executed';
          v_authority_status := 'contested';
          v_consequence := 'The appointment was recorded as disputed and is not yet recognized.';
        end if;

      when 'remove' then
        perform set_config('app.political_actor_id', order_row.actor_id::text, true);
        update public.political_authority_positions as position
        set position_status = 'removed',
            recognition_status = 'unrecognized',
            valid_through_turn = new.turn_number,
            updated_at = now()
        where position.id = (order_row.action ->> 'authorityPositionId')::bigint
          and position.position_status not in ('removed', 'vacant')
          and exists (
            select 1
            from jsonb_array_elements(resolution_plan -> 'effects') as effect(value)
            where effect.value ->> 'type' = 'position'
              and (effect.value ->> 'authorityPositionId')::bigint = position.id
              and effect.value ->> 'positionStatus' = 'removed'
          );
        v_execution_status := case when found then 'executed' else 'failed' end;
        v_authority_status := case when found then 'unrecognized' else 'unknown' end;
        v_consequence := case when found
          then 'The position was removed; prior authority remains in the history.'
          else 'The position was not active and could not be removed.'
        end;
        if v_execution_status = 'executed' then
          for effect_row in
            select delegation.id, delegation.status
            from public.political_delegations as delegation
            where delegation.authority_position_id =
                (order_row.action ->> 'authorityPositionId')::bigint
              and delegation.status = 'active'
              and exists (
                select 1
                from jsonb_array_elements(resolution_plan -> 'effects') as effect(value)
                where effect.value ->> 'type' = 'delegation'
                  and (effect.value ->> 'delegationId')::bigint = delegation.id
                  and effect.value ->> 'status' = 'revoked'
              )
          loop
            update public.political_delegations as delegation
            set status = 'revoked', ends_turn = new.turn_number, updated_at = now()
            where delegation.id = effect_row.id
            returning delegation.status into resulting_effect_value;
            if found then
              state_changes := state_changes || jsonb_build_array(jsonb_build_object(
                'type', 'delegation',
                'id', effect_row.id,
                'previousState', jsonb_build_object('status', effect_row.status),
                'resultingState', jsonb_build_object(
                  'status', resulting_effect_value,
                  'endsTurn', new.turn_number
                )
              ));
            end if;
          end loop;
        end if;

      when 'delegate' then
        insert into public.political_delegations (
          authority_position_id, delegator_character_id, delegate_character_id,
          responsibilities, recognition_status, is_public, starts_turn
        )
        select
          position.id,
          order_row.actor_id,
          (order_row.action ->> 'targetCharacterId')::integer,
          coalesce(nullif(order_row.action ->> 'details', ''), 'Delegated responsibilities unspecified.'),
          case when position.character_id = order_row.actor_id
              and position.position_status = 'active'
              and position.recognition_status = 'recognized'
            then 'recognized' else 'contested' end,
          v_is_public, new.turn_number
        from public.political_authority_positions as position
        where position.id = (order_row.action ->> 'authorityPositionId')::bigint
          and position.position_status not in ('removed', 'vacant')
          and (order_row.action ->> 'targetCharacterId')::integer <> order_row.actor_id
          and exists (
            select 1 from public.playable_characters as target
            where target.id = (order_row.action ->> 'targetCharacterId')::integer
          )
        returning id into delegation_id;
        v_execution_status := case when delegation_id is null then 'failed' else 'executed' end;
        v_authority_status := case when delegation_id is null then 'unknown'
          when exists (
          select 1 from public.political_authority_positions as position
          where position.id = (order_row.action ->> 'authorityPositionId')::bigint
            and position.character_id = order_row.actor_id
            and position.position_status = 'active'
            and position.recognition_status = 'recognized'
        ) then 'recognized' else 'contested' end;
        v_consequence := case when delegation_id is null
          then 'No valid active office or delegate was found; no delegation was created.'
          when v_authority_status = 'recognized'
          then 'A recognized officeholder delegated limited responsibilities; the office remains with its holder.'
          else 'The delegation was recorded as contested; it does not transfer the underlying office.'
        end;

      when 'revoke_delegation' then
        update public.political_delegations as delegation
        set status = 'revoked', ends_turn = new.turn_number, updated_at = now()
        where delegation.id = (order_row.action ->> 'delegationId')::bigint
          and delegation.status = 'active'
          and exists (
            select 1
            from jsonb_array_elements(resolution_plan -> 'effects') as effect(value)
            where effect.value ->> 'type' = 'delegation'
              and (effect.value ->> 'delegationId')::bigint = delegation.id
              and effect.value ->> 'status' = 'revoked'
          );
        v_execution_status := case when found then 'executed' else 'failed' end;
        v_authority_status := case when found then 'contested' else 'unknown' end;
        v_consequence := case when found
          then 'The delegation was revoked; the underlying office remains unchanged.'
          else 'The delegation was not active and could not be revoked.'
        end;

      when 'seize_location' then
        v_execution_status := 'attempted';
        v_authority_status := 'unrecognized';
        v_consequence := 'The seizure was attempted; territorial control remains unchanged because no battle, siege, or surrender resolution exists.';

      when 'recognize' then
        insert into public.political_authority_recognitions (
          authority_position_id, recognized_by_character_id,
          recognition_status, is_public, turn_number
        )
        select
          position.id, order_row.actor_id, 'recognized', v_is_public, new.turn_number
        from public.political_authority_positions as position
        where position.id = (order_row.action ->> 'authorityPositionId')::bigint
          and position.position_status not in ('removed', 'vacant')
          and exists (
            select 1
            from jsonb_array_elements(resolution_plan -> 'effects') as effect(value)
            where effect.value ->> 'type' = 'recognition'
              and (effect.value ->> 'authorityPositionId')::bigint = position.id
              and (effect.value ->> 'recognizedByCharacterId')::integer = order_row.actor_id
              and effect.value ->> 'status' = 'recognized'
          )
        on conflict (
          authority_position_id, recognized_by_character_id, turn_number
        ) do update set
          recognition_status = excluded.recognition_status,
          is_public = excluded.is_public;
        get diagnostics affected_rows = row_count;
        if affected_rows > 0 then
          select recognition.id into recognition_id
          from public.political_authority_recognitions as recognition
          where recognition.authority_position_id =
              (order_row.action ->> 'authorityPositionId')::bigint
            and recognition.recognized_by_character_id = order_row.actor_id
            and recognition.turn_number = new.turn_number;
          select position.recognition_status into v_authority_status
          from public.political_authority_positions as position
          where position.id = (order_row.action ->> 'authorityPositionId')::bigint;
          v_execution_status := 'executed';
          v_consequence := 'The actor recorded recognition; other characters may still dispute the position or refuse obedience.';
          state_changes := jsonb_build_array(jsonb_build_object(
            'type', 'recognition',
            'id', recognition_id,
            'previousState', null,
            'resultingState', jsonb_build_object(
              'authorityPositionId', (order_row.action ->> 'authorityPositionId')::bigint,
              'recognizedByCharacterId', order_row.actor_id,
              'recognitionStatus', 'recognized'
            )
          ));
        else
          v_execution_status := 'failed';
          v_authority_status := 'unknown';
          v_consequence := 'The position was not active and could not be recognized.';
        end if;

      when 'challenge' then
        perform set_config('app.political_actor_id', order_row.actor_id::text, true);
        update public.political_authority_positions as position
        set position_status = 'contested',
            recognition_status = 'contested',
            is_disputed = true,
            updated_at = now()
        where position.id = (order_row.action ->> 'authorityPositionId')::bigint
          and position.position_status not in ('removed', 'vacant')
          and exists (
            select 1
            from jsonb_array_elements(resolution_plan -> 'effects') as effect(value)
            where effect.value ->> 'type' = 'position'
              and (effect.value ->> 'authorityPositionId')::bigint = position.id
              and effect.value ->> 'positionStatus' = 'contested'
              and effect.value ->> 'recognitionStatus' = 'contested'
              and (effect.value ->> 'isDisputed')::boolean
          );
        v_execution_status := case when found then 'executed' else 'failed' end;
        v_authority_status := 'contested';
        v_consequence := case when found
          then 'The position is now recorded as disputed; control and obedience may differ.'
          else 'The position was not active and could not be challenged.'
        end;

      when 'overthrow' then
        perform set_config('app.political_actor_id', order_row.actor_id::text, true);
        update public.political_authority_positions as position
        set position_status = 'contested',
            recognition_status = 'contested',
            is_disputed = true,
            updated_at = now()
        where position.id = (order_row.action ->> 'authorityPositionId')::bigint
          and position.position_status not in ('removed', 'vacant')
          and exists (
            select 1
            from jsonb_array_elements(resolution_plan -> 'effects') as effect(value)
            where effect.value ->> 'type' = 'position'
              and (effect.value ->> 'authorityPositionId')::bigint = position.id
              and effect.value ->> 'positionStatus' = 'contested'
              and effect.value ->> 'recognitionStatus' = 'contested'
              and (effect.value ->> 'isDisputed')::boolean
          );
        v_execution_status := case
          when found then 'partially_executed' else 'failed'
        end;
        v_authority_status := 'contested';
        v_consequence := case when found
          then 'An overthrow was attempted and the office is disputed; removal is not presumed.'
          else 'The position was not active and could not be challenged.'
        end;

      when 'imprison' then
        insert into public.political_detentions (
          prisoner_character_id, custodian_character_id, location_id,
          status, reason, started_turn
        )
        select
          (order_row.action ->> 'targetCharacterId')::integer,
          order_row.actor_id,
          character.current_location_id,
          'attempted',
          nullif(order_row.action ->> 'details', ''),
          new.turn_number
        from public.playable_characters as character
        where character.id = (order_row.action ->> 'targetCharacterId')::integer
          and character.id <> order_row.actor_id;
        get diagnostics affected_rows = row_count;
        if affected_rows > 0 then
          select detention.id into detention_id
          from public.political_detentions as detention
          where detention.world_state_id = new.id
            and detention.prisoner_character_id =
              (order_row.action ->> 'targetCharacterId')::integer
            and detention.custodian_character_id = order_row.actor_id
            and detention.started_turn = new.turn_number
          order by detention.id desc
          limit 1;
          state_changes := jsonb_build_array(jsonb_build_object(
            'type', 'detention_attempt',
            'id', detention_id,
            'previousState', null,
            'resultingState', jsonb_build_object(
              'prisonerCharacterId', (order_row.action ->> 'targetCharacterId')::integer,
              'custodianCharacterId', order_row.actor_id,
              'locationId', (
                select character.current_location_id
                from public.playable_characters as character
                where character.id = (order_row.action ->> 'targetCharacterId')::integer
              ),
              'status', 'attempted'
            )
          ));
        end if;
        v_execution_status := case when affected_rows > 0 then 'attempted' else 'failed' end;
        v_authority_status := 'unknown';
        v_consequence := case when affected_rows > 0
          then 'An imprisonment was attempted; custody is not presumed.'
          else 'The target could not be detained.'
        end;

      when 'defy' then
        v_execution_status := 'executed';
        v_authority_status := 'contested';
        v_consequence := 'Defiance was recorded; neither authority nor obedience is inferred from rank.';

      when 'betray' then
        for effect_row in
          select effect.value
          from jsonb_array_elements(resolution_plan -> 'effects') as effect(value)
        loop
          if effect_row.value ->> 'type' = 'loyalty'
            and (order_row.action ->> 'targetCharacterId') is not null then
            select loyalty.strength::text into previous_effect_value
            from public.character_loyalties as loyalty
            where loyalty.id = (effect_row.value ->> 'loyaltyId')::bigint
              and loyalty.character_id = order_row.actor_id
              and loyalty.loyal_to_character_id =
                (order_row.action ->> 'targetCharacterId')::integer;
            if found then
              update public.character_loyalties as loyalty
              set strength = (effect_row.value ->> 'strength')::smallint
              where loyalty.id = (effect_row.value ->> 'loyaltyId')::bigint
              returning loyalty.strength::text into resulting_effect_value;
              if found then
                state_changes := state_changes || jsonb_build_array(jsonb_build_object(
                  'type', 'loyalty',
                  'id', (effect_row.value ->> 'loyaltyId')::bigint,
                  'previousStrength', previous_effect_value,
                  'resultingStrength', resulting_effect_value
                ));
              end if;
            end if;
          elsif effect_row.value ->> 'type' = 'diplomacy'
            and (order_row.action ->> 'targetHouseId') is not null then
            select relation.status into previous_effect_value
            from public.diplomacy_records as relation
            where relation.id = (effect_row.value ->> 'diplomacyRecordId')::bigint
              and relation.status = 'active'
              and (
                relation.character_a_id = order_row.actor_id
                or relation.character_b_id = order_row.actor_id
                or relation.house_a_id = actor_house_id
                or relation.house_b_id = actor_house_id
              )
              and (
                relation.house_a_id = (order_row.action ->> 'targetHouseId')::bigint
                or relation.house_b_id = (order_row.action ->> 'targetHouseId')::bigint
              );
            if found then
              update public.diplomacy_records as relation
              set status = effect_row.value ->> 'status',
                  ended_on = current_date
              where relation.id = (effect_row.value ->> 'diplomacyRecordId')::bigint
                and relation.status = 'active'
              returning relation.status into resulting_effect_value;
              if found then
                state_changes := state_changes || jsonb_build_array(jsonb_build_object(
                  'type', 'diplomacy',
                  'id', (effect_row.value ->> 'diplomacyRecordId')::bigint,
                  'previousStatus', previous_effect_value,
                  'resultingStatus', resulting_effect_value
                ));
              end if;
            end if;
          end if;
        end loop;
        v_execution_status := case
          when jsonb_array_length(state_changes) > 0 then 'executed'
          else 'attempted'
        end;
        v_authority_status := 'unknown';
        v_consequence := case when jsonb_array_length(state_changes) > 0
          then 'Recorded loyalty or agreements changed as specified; all other ties remain unchanged.'
          else 'The betrayal was attempted, but no matching recorded loyalty or agreement changed.'
        end;

      else
        v_execution_status := 'failed';
        v_authority_status := 'unknown';
        v_consequence := 'The political operation is not supported.';
    end case;

    if planned_result = 'partially_executed'
      and v_execution_status = 'executed' then
      v_execution_status := 'partially_executed';
    end if;
    if position_id is not null then
      select jsonb_build_object(
        'characterId', position.character_id,
        'positionStatus', position.position_status,
        'recognitionStatus', position.recognition_status,
        'isDisputed', position.is_disputed
      )
      into resulting_position_state
      from public.political_authority_positions as position
      where position.id = position_id;
      if resulting_position_state is distinct from previous_position_state then
        state_changes := state_changes || jsonb_build_array(jsonb_build_object(
          'type', 'position',
          'id', position_id,
          'previousState', previous_position_state,
          'resultingState', resulting_position_state
        ));
      end if;
    end if;
    if delegation_id is not null then
      select jsonb_build_object(
        'status', delegation.status,
        'delegateCharacterId', delegation.delegate_character_id
      )
      into resulting_delegation_state
      from public.political_delegations as delegation
      where delegation.id = delegation_id;
      if resulting_delegation_state is distinct from previous_delegation_state then
        state_changes := state_changes || jsonb_build_array(jsonb_build_object(
          'type', 'delegation',
          'id', delegation_id,
          'previousState', previous_delegation_state,
          'resultingState', resulting_delegation_state
        ));
      end if;
    end if;
    update public.political_action_outcomes
    set execution_status = v_execution_status,
        authority_status = v_authority_status,
        consequence = v_consequence,
        resolution_plan = resolution_plan,
        state_changes = state_changes
    where id = outcome_id;
  end loop;

  return new;
end
$$;

drop trigger if exists resolve_political_actions_after_world_turn
  on public.world_state;
create trigger resolve_political_actions_after_world_turn
after update of turn_number on public.world_state
for each row execute function public.resolve_political_actions_for_turn();

create or replace function public.attach_political_action_event()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.political_action_outcomes as outcome
  set source_event_id = new.event_id
  where outcome.world_state_id = new.world_state_id
    and outcome.turn_number = new.turn_number
    and outcome.source_event_id is null;
  update public.political_authority_positions as position
  set source_event_id = new.event_id
  where position.world_state_id = new.world_state_id
    and position.valid_from_turn = new.turn_number
    and position.source_event_id is null;
  update public.political_delegations as delegation
  set source_event_id = new.event_id
  where delegation.world_state_id = new.world_state_id
    and delegation.starts_turn = new.turn_number
    and delegation.source_event_id is null;
  update public.political_authority_recognitions as recognition
  set source_event_id = new.event_id
  where recognition.world_state_id = new.world_state_id
    and recognition.turn_number = new.turn_number
    and recognition.source_event_id is null;
  update public.political_authority_history as history
  set source_event_id = new.event_id
  where history.turn_number = new.turn_number
    and history.created_at = now()
    and history.authority_position_id in (
      select position.id
      from public.political_authority_positions as position
      where position.valid_from_turn = new.turn_number
         or position.updated_at = now()
    )
    and history.authority_position_id is not null;
  update public.political_territorial_control_history as history
  set source_event_id = new.event_id
  where history.world_state_id = new.world_state_id
    and history.turn_number = new.turn_number
    and history.source_event_id is null;
  update public.political_detentions as detention
  set source_event_id = new.event_id
  where detention.world_state_id = new.world_state_id
    and detention.started_turn = new.turn_number
    and detention.source_event_id is null;
  update public.house_location_relations as relation
  set source_event_id = new.event_id
  from public.political_action_outcomes as outcome
  where outcome.world_state_id = new.world_state_id
    and outcome.turn_number = new.turn_number
    and outcome.action_operation = 'seize_location'
    and outcome.execution_status = 'executed'
    and outcome.source_event_id = new.event_id
    and relation.location_id =
      (outcome.action_data ->> 'targetLocationId')::bigint
    and relation.relation_type = 'current_control'
    and relation.created_at = outcome.created_at
    and relation.source_event_id is null;
  update public.political_claims as claim
  set source_event_id = new.event_id
  from public.political_action_outcomes as outcome
  where outcome.world_state_id = new.world_state_id
    and outcome.turn_number = new.turn_number
    and outcome.action_operation = 'claim_title'
    and outcome.execution_status = 'executed'
    and outcome.source_event_id = new.event_id
    and claim.claimant_character_id = outcome.actor_character_id
    and claim.target_title = outcome.action_data ->> 'targetTitle'
    and claim.created_at = outcome.created_at
    and claim.source_event_id is null;
  return new;
end
$$;

drop trigger if exists attach_political_action_event_trigger
  on public.gameplay_turn_resolutions;
create trigger attach_political_action_event_trigger
after insert on public.gameplay_turn_resolutions
for each row execute function public.attach_political_action_event();

alter table public.political_entities enable row level security;
alter table public.political_authority_positions enable row level security;
alter table public.political_delegations enable row level security;
alter table public.political_authority_recognitions enable row level security;
alter table public.political_authority_history enable row level security;
alter table public.political_territorial_control_history enable row level security;
alter table public.political_action_outcomes enable row level security;
alter table public.political_detentions enable row level security;

revoke all on public.political_entities, public.political_authority_positions,
  public.political_delegations, public.political_authority_history,
  public.political_authority_recognitions,
  public.political_territorial_control_history, public.political_action_outcomes,
  public.political_detentions
  from public, anon, authenticated;
revoke all on public.character_political_influence from public, anon, authenticated;
grant select, insert, update, delete on public.political_entities,
  public.political_authority_positions, public.political_delegations,
  public.political_authority_recognitions,
  public.political_authority_history, public.political_action_outcomes,
  public.political_territorial_control_history, public.political_detentions
  to service_role;
grant select on public.character_political_influence to service_role;
grant usage, select on sequence public.political_entities_id_seq,
  public.political_authority_positions_id_seq, public.political_delegations_id_seq,
  public.political_authority_recognitions_id_seq,
  public.political_authority_history_id_seq, public.political_action_outcomes_id_seq,
  public.political_territorial_control_history_id_seq,
  public.political_detentions_id_seq to service_role;
revoke all on function public.record_political_authority_history()
  from public, anon, authenticated;
revoke all on function public.resolve_political_actions_for_turn()
  from public, anon, authenticated;
revoke all on function public.attach_political_action_event()
  from public, anon, authenticated;

commit;
