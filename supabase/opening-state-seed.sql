-- Seed the opening snapshot from theclaimant_starting_reference.txt.
-- Run after event-log.sql and world-state-schema.sql.
-- Safe to rerun: opening/reference fields are retained, while current state is
-- only initialized before any post-opening events exist.

begin;

alter table public.world_state
  add column if not exists opening_situation text;

alter table public.world_regions
  add column if not exists opening_situation text,
  add column if not exists current_situation text not null
    default 'The succession is disputed but no realm-wide war has begun.';

alter table public.houses
  add column if not exists seat_name text,
  add column if not exists house_words text,
  add column if not exists opening_head text,
  add column if not exists opening_summary text,
  add column if not exists current_summary text,
  add column if not exists treasury_is_estimate boolean not null default false,
  add column if not exists treasury_source_note text,
  add column if not exists debt_amount numeric(18, 2),
  add column if not exists debt_summary text;

alter table public.playable_characters
  add column if not exists birth_house_id bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'playable_characters_birth_house_id_fkey'
      and conrelid = 'public.playable_characters'::regclass
  ) then
    alter table public.playable_characters
      add constraint playable_characters_birth_house_id_fkey
      foreign key (birth_house_id) references public.houses(id)
      on delete set null;
  end if;
end
$$;

alter table public.game_events
  add column if not exists reference_key text;

create unique index if not exists game_events_reference_key_uidx
  on public.game_events (reference_key)
  where reference_key is not null;

alter table public.world_wars
  add column if not exists reference_key text,
  add column if not exists is_public boolean not null default false,
  add column if not exists public_summary text;

create unique index if not exists world_wars_reference_key_uidx
  on public.world_wars (reference_key)
  where reference_key is not null;

alter table public.diplomacy_records
  add column if not exists reference_key text,
  add column if not exists is_public boolean not null default false,
  add column if not exists public_summary text;

create unique index if not exists diplomacy_records_reference_key_uidx
  on public.diplomacy_records (reference_key)
  where reference_key is not null;

alter table public.character_secrets
  add column if not exists reference_key text;

create unique index if not exists character_secrets_reference_key_uidx
  on public.character_secrets (reference_key)
  where reference_key is not null;

create table if not exists public.character_secret_subjects (
  secret_id bigint not null
    references public.character_secrets(id) on delete cascade,
  character_id integer not null
    references public.playable_characters(id) on delete cascade,
  role text not null default 'subject',
  primary key (secret_id, character_id, role)
);

alter table public.character_secret_subjects enable row level security;
revoke all on public.character_secret_subjects from anon, authenticated;
grant select, insert, update, delete on public.character_secret_subjects to service_role;

insert into public.world_state (
  id,
  world_date,
  date_description,
  season,
  current_situation,
  opening_situation
)
values (
  1,
  null,
  'Summer 298 AC, shortly after King Robert I Baratheon''s death during the hunt; exact day unknown.',
  'summer',
  'Robert is dead. Joffrey is treated by the court as heir, but the succession is vulnerable to dispute. No war of succession has begun.',
  'The game opens immediately after Robert I Baratheon''s death during the hunt. Joffrey is treated by the court as heir, but the succession is unresolved and no war of succession has begun.'
)
on conflict (id) do update set
  world_date = coalesce(public.world_state.world_date, excluded.world_date),
  date_description = excluded.date_description,
  season = coalesce(public.world_state.season, excluded.season),
  opening_situation = excluded.opening_situation,
  current_situation = case
    when public.world_state.current_situation =
      'The succession is disputed but no realm-wide war has begun.'
      then excluded.current_situation
    else public.world_state.current_situation
  end,
  updated_at = now();

insert into public.world_regions (name)
values
  ('The North'),
  ('The Vale'),
  ('The Riverlands'),
  ('The Iron Islands'),
  ('The Westerlands'),
  ('The Reach'),
  ('The Stormlands'),
  ('The Crownlands'),
  ('Dorne')
on conflict (name) do nothing;

update public.world_regions as region
set
  opening_situation = seed.opening_situation,
  current_situation = case
    when region.current_situation is null
      or region.current_situation =
      'The succession is disputed but no realm-wide war has begun.'
      then seed.opening_situation
    else region.current_situation
  end
from (
  values
    ('The North', 'Formally loyal to the Crown. Ned Stark serves as Hand in King''s Landing; Robb Stark remains at Winterfell. The North has not declared independence.'),
    ('The Vale', 'Robert Arryn is Lord of the Vale under Lysa Arryn''s regency. Lysa has withdrawn from King''s Landing; the Vale has not joined a rebellion and its forces are not automatically committed.'),
    ('The Riverlands', 'House Tully remains tied to the Starks by marriage and is formally loyal to the Crown. The Riverlands are not at war; their many houses retain their own interests.'),
    ('The Iron Islands', 'Balon Greyjoy remains Lord of the Iron Islands. The Greyjoy Rebellion has ended; no new rebellion has begun. Theon remains a ward/hostage at Winterfell.'),
    ('The Westerlands', 'House Lannister is powerful and closely connected to the royal household. Tywin is away from King''s Landing; the Lannisters do not automatically control every royal institution.'),
    ('The Reach', 'House Tyrell rules from Highgarden. Its position is not committed to a later alliance; Margaery is unmarried at this opening.'),
    ('The Stormlands', 'Robert Baratheon is dead. Stannis holds Dragonstone; Renly is in King''s Landing. The Stormlands'' political alignment is unsettled.'),
    ('The Crownlands', 'The Crownlands are ruled directly by the Crown, not by a regional Great House. King''s Landing is tense and the royal succession is not uncontested.'),
    ('Dorne', 'House Martell rules from Sunspear. Dorne remains formally within the realm; its grievances against the Lannisters endure, but no open uprising is underway.')
) as seed(name, opening_situation)
where region.name = seed.name;

-- These are estimates of regional potential, not forces already mustered.
-- Keep the Crownlands' City Watch separate from its regional levy estimate.
insert into public.regional_military_estimates (
  world_state_id,
  region_id,
  force_name,
  force_type,
  minimum_strength,
  maximum_strength,
  strength_unit,
  confidence_level,
  readiness_status,
  summary,
  source_note,
  is_gameplay_assumption
)
select
  1,
  region.id,
  seed.force_name,
  seed.force_type,
  seed.minimum_strength,
  seed.maximum_strength,
  case when seed.force_type = 'fleet' then 'ships' else 'personnel' end,
  case
    when region.name in ('The Riverlands', 'Dorne') then 'very_low'
    when seed.force_name = 'Kingsguard' then 'medium'
    else 'low'
  end,
  seed.readiness_status,
  seed.summary,
  seed.source_note,
  (
    region.name in ('The Riverlands', 'Dorne')
    and seed.force_name = 'Regional levy potential'
  )
from (
  values
    ('The North', 'Regional levy potential', 'regional_levy',
      45000, 45000, 'potential',
      'Estimated maximum regional forces available to call, not currently mustered.',
      'Approximate planning estimate supplied for the campaign; not a precise canonical muster.'),
    ('The Vale', 'Regional levy potential', 'regional_levy',
      45000, 45000, 'potential',
      'Estimated maximum regional forces available to call, not currently mustered.',
      'Approximate planning estimate supplied for the campaign; full mobilization is uncertain.'),
    ('The Riverlands', 'Regional levy potential', 'regional_levy',
      45000, 45000, 'potential',
      'Theoretical regional ceiling only; fragmented leadership makes a unified Riverlands muster unlikely.',
      'Very-low-confidence game estimate. Includes House Frey''s approximately 4,000 and other Riverlands forces; do not add these house figures again.'),
    ('The Iron Islands', 'Regional levy potential', 'regional_levy',
      20000, 20000, 'potential',
      'Approximate land-force potential, not troops currently mustered.',
      'Low-confidence older semi-canon/lore-summary estimate; no house-by-house allocation supplied.'),
    ('The Westerlands', 'Regional levy potential', 'regional_levy',
      50000, 50000, 'potential',
      'Estimated maximum regional forces available to call, not currently mustered.',
      'Approximate planning estimate supplied for the campaign; not a precise canonical muster.'),
    ('The Reach', 'Regional levy potential', 'regional_levy',
      80000, 100000, 'potential',
      'Estimated range of regional forces available to call, not currently mustered.',
      'Approximate planning range supplied for the campaign; cavalry share and mustering rate remain unspecified.'),
    ('The Stormlands', 'Regional levy potential', 'regional_levy',
      30000, 30000, 'potential',
      'Estimated maximum regional forces available to call, not currently mustered.',
      'Approximate planning estimate supplied for the campaign; do not count later Renly or Stannis hosts as already raised.'),
    ('The Crownlands', 'Regional levy potential', 'regional_levy',
      10000, 15000, 'potential',
      'Estimated range for forces of the Crownlands coastal lords; excludes the separately listed City Watch.',
      'Approximate planning range supplied for the campaign.'),
    ('The Crownlands', 'King''s Landing City Watch', 'city_watch',
      2000, 2000, 'standing',
      'The Gold Cloaks; standing city-watch estimate, separate from field levies.',
      'Approximate strength supplied for the campaign.'),
    ('The Crownlands', 'Kingsguard', 'standing_guard',
      7, 7, 'standing',
      'Seven serving Kingsguard members; a royal bodyguard, not a field army.',
      'Opening roster count supplied for this campaign.'),
    ('The Crownlands', 'Dragonstone garrison', 'garrison',
      430, 430, 'unknown',
      'Thirty knights, one hundred crossbowmen, and three hundred men-at-arms; low-confidence secondary/RPG estimate.',
      'Secondary/RPG estimate only, not established novel canon.'),
    ('The Crownlands', 'Royal fleet at the opening', 'fleet',
      null::integer, null::integer, 'unknown',
      'Exact opening inventory and distribution are not established.',
      'A later near-opening account says about 50 ships remained at King''s Landing after Stannis took most of the rebuilt fleet to Dragonstone; do not apply that later distribution to this pre-claim opening.'),
    ('The Iron Islands', 'Total longship inventory', 'fleet',
      500, 500, 'unknown',
      'Approximate total longship inventory; vessel readiness is unknown.',
      'Low-confidence older semi-canon/lore-summary estimate. The Iron Fleet estimate below is a subset, not additional ships.'),
    ('The Iron Islands', 'Iron Fleet subset', 'fleet',
      100, 100, 'unknown',
      'Approximate count of larger Iron Fleet vessels; included within total Iron Islands longships.',
      'Low-confidence older semi-canon/lore-summary estimate; do not add to the total longship inventory.'),
    ('The Reach', 'Redwyne warships', 'fleet',
      200, 200, 'unknown',
      'Estimated warship inventory; readiness and crews are unknown.',
      'Approximate fleet estimate supplied for the campaign.'),
    ('The Reach', 'Redwyne merchant and support vessels', 'fleet',
      1000, 1000, 'unknown',
      'Estimated non-warship merchant/support inventory; not fighting warships.',
      'Approximate fleet estimate supplied for the campaign. Keep distinct from Redwyne warships.'),
    ('The Westerlands', 'Lannisport mixed fleet estimate', 'fleet',
      20, 30, 'unknown',
      'Estimated mixed vessel count; vessel classes are not specified.',
      'Older semi-canon estimate. Do not add to the separate, overlapping estimate of 50-60 large western ships.'),
    ('The Westerlands', 'Western large-ship alternative estimate', 'fleet',
      50, 60, 'unknown',
      'Alternative estimate of large western ships; overlaps with the Lannisport mixed fleet estimate.',
      'Older semi-canon estimate. Alternative to, not additive with, the 20-30 Lannisport mixed-vessel estimate.'),
    ('Dorne', 'Regional levy potential', 'regional_levy',
      40000, 45000, 'potential',
      'Game estimate of regional force potential, not currently mustered.',
      'Very-low-confidence planning range. The frequently repeated 50,000 figure is disputed and not adopted here.')
) as seed(
  region_name, force_name, force_type, minimum_strength, maximum_strength,
  readiness_status, summary, source_note
)
join public.world_regions as region on region.name = seed.region_name
on conflict (world_state_id, region_id, force_name) do update set
  force_type = excluded.force_type,
  minimum_strength = excluded.minimum_strength,
  maximum_strength = excluded.maximum_strength,
  strength_unit = excluded.strength_unit,
  confidence_level = excluded.confidence_level,
  readiness_status = excluded.readiness_status,
  summary = excluded.summary,
  source_note = excluded.source_note,
  is_gameplay_assumption = excluded.is_gameplay_assumption,
  updated_at = now();

insert into public.military_muster_rules (
  world_state_id,
  region_id,
  reference_key,
  rule_name,
  force_type,
  minimum_days,
  maximum_days,
  target_strength,
  summary,
  is_gameplay_assumption,
  source_note
)
select
  1,
  region.id,
  seed.reference_key,
  seed.rule_name,
  seed.force_type,
  seed.minimum_days,
  seed.maximum_days,
  seed.target_strength,
  seed.summary,
  seed.is_gameplay_assumption,
  seed.source_note
from (
  values
    ('opening-muster-household', null::text, 'Household force assembly',
      'standing_guard', 1, 3, null::integer,
      'Gameplay timing assumption for assembling a household force.',
      true,
      'Simulation rule only; not a universal lore fact.'),
    ('opening-muster-local-bannerman', null::text, 'Local bannerman levy',
      'regional_levy', 7, 21, null::integer,
      'Gameplay timing assumption for a local bannerman levy.',
      true,
      'Simulation rule only; distance, willingness, roads, and weather modify timing.'),
    ('opening-muster-regional', null::text, 'Regional muster',
      'regional_levy', 21, 56, null::integer,
      'Gameplay timing assumption for a regional muster.',
      true,
      'Simulation rule only; distance, willingness, roads, supply, and weather modify timing.'),
    ('opening-muster-north', 'The North', 'North-wide muster',
      'regional_levy', 42, 84, null::integer,
      'Gameplay timing assumption for gathering a North-wide force.',
      true,
      'Simulation rule only; reflects the North''s scale and dispersed forces, not a fixed lore calendar.'),
    ('opening-muster-highgarden-10000', 'The Reach', 'Highgarden 10,000-man claim',
      'regional_levy', 14, 14, 10000,
      'Claimed ability to raise 10,000 men in a fortnight.',
      false,
      'Reported later-dialogue benchmark; not an opening mobilization or guaranteed outcome.'),
    ('opening-muster-highgarden-20000', 'The Reach', 'Highgarden 20,000-man claim',
      'regional_levy', 30, 30, 20000,
      'Claimed ability to raise 20,000 men in a month.',
      false,
      'Reported later-dialogue benchmark; not an opening mobilization or guaranteed outcome.')
) as seed(
  reference_key, region_name, rule_name, force_type, minimum_days,
  maximum_days, target_strength, summary, is_gameplay_assumption, source_note
)
left join public.world_regions as region on region.name = seed.region_name
on conflict (reference_key) do update set
  region_id = excluded.region_id,
  rule_name = excluded.rule_name,
  force_type = excluded.force_type,
  minimum_days = excluded.minimum_days,
  maximum_days = excluded.maximum_days,
  target_strength = excluded.target_strength,
  summary = excluded.summary,
  is_gameplay_assumption = excluded.is_gameplay_assumption,
  source_note = excluded.source_note,
  updated_at = now();

insert into public.houses (
  name,
  seat_name,
  house_words,
  opening_head,
  opening_summary,
  current_summary
)
values
  ('House Stark', 'Winterfell', 'Winter Is Coming', 'Eddard Stark; Robb Stark at Winterfell', 'The ruling house of the North. Eddard Stark is in King''s Landing as Hand; Robb remains at Winterfell. The North has not declared independence.', 'The ruling house of the North. Eddard Stark is in King''s Landing as Hand; Robb remains at Winterfell. The North has not declared independence.'),
  ('House Arryn', 'The Eyrie', 'As High as Honor', 'Robert Arryn, under Lysa Arryn''s regency', 'Robert Arryn is the young Lord of the Vale. His mother Lysa governs as regent following Jon Arryn''s death; the Vale has not committed to a faction.', 'Robert Arryn is the young Lord of the Vale. His mother Lysa governs as regent following Jon Arryn''s death; the Vale has not committed to a faction.'),
  ('House Tully', 'Riverrun', 'Family, Duty, Honor', 'Hoster Tully', 'House Tully remains loyal to the Crown and is connected to House Stark through Catelyn Stark. The Riverlands are not at war.', 'House Tully remains loyal to the Crown and is connected to House Stark through Catelyn Stark. The Riverlands are not at war.'),
  ('House Greyjoy', 'Pyke', 'We Do Not Sow', 'Balon Greyjoy', 'Balon Greyjoy remains Lord of the Iron Islands. The defeated Greyjoy Rebellion has not been renewed; Theon is held as a ward/hostage at Winterfell.', 'Balon Greyjoy remains Lord of the Iron Islands. The defeated Greyjoy Rebellion has not been renewed; Theon is held as a ward/hostage at Winterfell.'),
  ('House Lannister', 'Casterly Rock', 'Hear Me Roar', 'Tywin Lannister', 'A powerful western house closely connected to the royal family through Cersei, Jaime, and Tyrion. No later alliance or outcome is presumed.', 'A powerful western house closely connected to the royal family through Cersei, Jaime, and Tyrion. No later alliance or outcome is presumed.'),
  ('House Targaryen', null, null, 'Viserys and Daenerys survive in exile', 'The dynasty was overthrown in Robert''s Rebellion. Viserys and Daenerys are outside Westeros at the opening.', 'The dynasty was overthrown in Robert''s Rebellion. Viserys and Daenerys are outside Westeros at the opening.'),
  ('House Tyrell', 'Highgarden', 'Growing Strong', 'Mace Tyrell', 'House Tyrell rules the Reach. Its stance in the succession crisis is uncommitted; Margaery is unmarried at the opening.', 'House Tyrell rules the Reach. Its stance in the succession crisis is uncommitted; Margaery is unmarried at the opening.'),
  ('House Baratheon', 'Storm''s End', 'Ours Is the Fury', 'Robert is dead; Stannis and Renly have competing interests', 'The Baratheon family''s succession is unsettled. Stannis controls Dragonstone; Renly is in King''s Landing. The Stormlands'' alignment is not settled.', 'The Baratheon family''s succession is unsettled. Stannis controls Dragonstone; Renly is in King''s Landing. The Stormlands'' alignment is not settled.'),
  ('House Baratheon of King''s Landing', 'King''s Landing', 'Ours Is the Fury', 'Robert I is dead; Joffrey is treated as heir by the court', 'The Crown and royal household are based at King''s Landing. The court treats Joffrey as heir, but the succession is not uncontested. Robert''s reign left the Crown deeply indebted.', 'The Crown and royal household are based at King''s Landing. The court treats Joffrey as heir, but the succession is not uncontested. Robert''s reign left the Crown deeply indebted.'),
  ('House Nymeros Martell', 'Sunspear', 'Unbowed, Unbent, Unbroken', 'Doran Martell', 'Dorne remains formally part of the realm. The Martells retain grievances against the Lannisters, but no open uprising is underway.', 'Dorne remains formally part of the realm. The Martells retain grievances against the Lannisters, but no open uprising is underway.'),
  ('House Baratheon of Dragonstone', 'Dragonstone', 'Ours Is the Fury', 'Stannis Baratheon', 'Stannis Baratheon holds Dragonstone and is Robert''s elder surviving brother. His conclusions and support are not automatically known to every lord.','Stannis Baratheon holds Dragonstone and is Robert''s elder surviving brother. His conclusions and support are not automatically known to every lord.'),
  ('House Bolton', 'The Dreadfort', null, 'Roose Bolton', 'A powerful northern house and historic Stark rival. Do not presume a later betrayal.','A powerful northern house and historic Stark rival. Do not presume a later betrayal.'),
  ('House Karstark', 'Karhold', null, 'Rickard Karstark', 'A militarily significant northern cadet branch of the Starks.','A militarily significant northern cadet branch of the Starks.'),
  ('House Manderly', 'White Harbor', null, 'Wyman Manderly', 'The North''s major port and one of its wealthiest houses.','The North''s major port and one of its wealthiest houses.'),
  ('House Umber', 'The Last Hearth', null, 'Greatjon Umber', 'A northern house known for its fierce warriors.','A northern house known for its fierce warriors.'),
  ('House Glover', 'Deepwood Motte', null, 'Galbart and Robett Glover', 'A northern house with lands at Deepwood Motte.','A northern house with lands at Deepwood Motte.'),
  ('House Mormont', 'Bear Island', null, 'Maege Mormont', 'A northern house led by Maege Mormont.','A northern house led by Maege Mormont.'),
  ('House Reed', 'Greywater Watch', null, 'Howland Reed', 'Rules the crannogmen in the Neck and is loyal to the Starks. Greywater Watch is a hidden, mobile stronghold.','Rules the crannogmen in the Neck and is loyal to the Starks. Greywater Watch is a hidden, mobile stronghold.'),
  ('House Cerwyn', 'Castle Cerwyn', null, null, 'A close Stark bannerman in the North.','A close Stark bannerman in the North.'),
  ('House Tallhart', 'Torrhen''s Square', null, null, 'A northern house of Torrhen''s Square.','A northern house of Torrhen''s Square.'),
  ('House Hornwood', 'Hornwood', null, null, 'A northern house of Hornwood.','A northern house of Hornwood.'),
  ('House Ryswell', 'The Rills', null, null, 'A northern house of the Rills.','A northern house of the Rills.'),
  ('House Dustin', 'Barrowton', null, 'Barbrey Dustin', 'A politically consequential northern house. Barbrey Dustin distrusts the Starks in private.','A politically consequential northern house. Barbrey Dustin distrusts the Starks in private.'),
  ('House Locke', 'Oldcastle', null, null, 'A northern house of Oldcastle.','A northern house of Oldcastle.'),
  ('House Royce', 'Runestone', null, 'Yohn Royce', 'One of the oldest and most powerful houses of the Vale.','One of the oldest and most powerful houses of the Vale.'),
  ('House Royce of the Gates of the Moon', 'The Gates of the Moon', null, null, 'A cadet Royce branch associated with the lower stronghold for the Eyrie.','A cadet Royce branch associated with the lower stronghold for the Eyrie.'),
  ('House Corbray', 'Heart''s Home', null, 'Lyn Corbray', 'A Vale house known for martial prestige.','A Vale house known for martial prestige.'),
  ('House Waynwood', 'Ironoaks', null, 'Anya Waynwood', 'An influential Vale house.','An influential Vale house.'),
  ('House Belmore', 'Strongsong', null, null, 'A house of the Vale.','A house of the Vale.'),
  ('House Hunter', 'Longbow Hall', null, null, 'A house of the Vale.','A house of the Vale.'),
  ('House Redfort', 'Redfort', null, null, 'A house of the Vale.','A house of the Vale.'),
  ('House Templeton', 'Ninestars', null, null, 'A knightly house of the Vale.','A knightly house of the Vale.'),
  ('House Grafton', 'Gulltown', null, 'Gerold Grafton', 'Controls Gulltown, the Vale''s major port.','Controls Gulltown, the Vale''s major port.'),
  ('House Baelish', 'The Fingers', null, null, 'A minor Vale house; Petyr Baelish is not a Great House lord.','A minor Vale house; Petyr Baelish is not a Great House lord.'),
  ('House Sunderland', 'The Three Sisters', null, null, 'Rules the Sistermen of the Three Sisters.','Rules the Sistermen of the Three Sisters.'),
  ('House Frey', 'The Twins', null, 'Walder Frey', 'A Tully bannerman holding the strategically important crossing at the Twins. The family has internal divisions and competing interests.','A Tully bannerman holding the strategically important crossing at the Twins. The family has internal divisions and competing interests.'),
  ('House Blackwood', 'Raventree Hall', null, 'Tytos Blackwood', 'An ancient Riverlands house and longstanding rival of House Bracken.','An ancient Riverlands house and longstanding rival of House Bracken.'),
  ('House Bracken', 'Stone Hedge', null, null, 'A Riverlands house and longstanding rival of House Blackwood.','A Riverlands house and longstanding rival of House Blackwood.'),
  ('House Mallister', 'Seagard', null, 'Jason Mallister', 'A coastal Riverlands house that guards against ironborn raids.','A coastal Riverlands house that guards against ironborn raids.'),
  ('House Piper', 'Pinkmaiden', null, 'Clement Piper', 'A house of the Riverlands.','A house of the Riverlands.'),
  ('House Vance of Wayfarer''s Rest', 'Wayfarer''s Rest', null, null, 'One of two distinct Vance branches in the Riverlands.','One of two distinct Vance branches in the Riverlands.'),
  ('House Vance of Atranta', 'Atranta', null, null, 'One of two distinct Vance branches in the Riverlands.','One of two distinct Vance branches in the Riverlands.'),
  ('House Mooton', 'Maidenpool', null, null, 'Controls Maidenpool, an important eastern town and port.','Controls Maidenpool, an important eastern town and port.'),
  ('House Darry', 'Darry', null, null, 'An old Riverlands house with complicated loyalties after Robert''s Rebellion.','An old Riverlands house with complicated loyalties after Robert''s Rebellion.'),
  ('House Whent', 'Harrenhal', null, 'Shella Whent', 'A declining house associated with Harrenhal; the seat''s current status is politically complicated.','A declining house associated with Harrenhal; the seat''s current status is politically complicated.'),
  ('House Smallwood', 'Acorn Hall', null, null, 'A lesser Riverlands house.','A lesser Riverlands house.'),
  ('House Roote', 'Lord Harroway''s Town', null, null, 'A lesser Riverlands house.','A lesser Riverlands house.'),
  ('House Ryger', 'Willow Wood', null, null, 'A lesser Riverlands house.','A lesser Riverlands house.'),
  ('House Harlaw', 'Ten Towers', null, 'Rodrik Harlaw', 'The wealthiest and most populous of the Iron Islands'' houses.','The wealthiest and most populous of the Iron Islands'' houses.'),
  ('House Botley', 'Lordsport', null, null, 'An influential house near Pyke.','An influential house near Pyke.'),
  ('House Drumm', 'Old Wyk', null, 'Dunstan Drumm', 'An Iron Islands house associated with Old Wyk and martial traditions.','An Iron Islands house associated with Old Wyk and martial traditions.'),
  ('House Blacktyde', 'Blacktyde', null, null, 'A house of the Iron Islands.','A house of the Iron Islands.'),
  ('House Goodbrother', 'Hammerhorn', null, null, 'A house with several branches across Great Wyk.','A house with several branches across Great Wyk.'),
  ('House Orkwood', 'Orkmont', null, null, 'A house of the Iron Islands.','A house of the Iron Islands.'),
  ('House Wynch', 'Iron Holt', null, null, 'A house of the Iron Islands.','A house of the Iron Islands.'),
  ('House Lefford', 'The Golden Tooth', null, null, 'Controls a strategic pass into the Westerlands.','Controls a strategic pass into the Westerlands.'),
  ('House Marbrand', 'Ashemark', null, 'Addam Marbrand', 'A leading Lannister bannerman house.','A leading Lannister bannerman house.'),
  ('House Crakehall', 'Crakehall', null, null, 'A powerful martial house of the Westerlands.','A powerful martial house of the Westerlands.'),
  ('House Brax', 'Hornvale', null, null, 'A significant house of the Westerlands.','A significant house of the Westerlands.'),
  ('House Farman', 'Faircastle', null, null, 'A naval and coastal house of the Westerlands.','A naval and coastal house of the Westerlands.'),
  ('House Westerling', 'The Crag', null, null, 'An old Westerlands house with a diminished fortune.','An old Westerlands house with a diminished fortune.'),
  ('House Serrett', 'Silverhill', null, null, 'A house of the Westerlands.','A house of the Westerlands.'),
  ('House Swyft', 'Cornfield', null, null, 'A house of the Westerlands.','A house of the Westerlands.'),
  ('House Lydden', 'Deep Den', null, null, 'A house of the Westerlands.','A house of the Westerlands.'),
  ('House Prester', 'Feastfires', null, null, 'A house of the Westerlands.','A house of the Westerlands.'),
  ('House Banefort', 'Banefort', null, null, 'A house of the Westerlands.','A house of the Westerlands.'),
  ('House Hightower', 'The Hightower', null, 'Leyton Hightower', 'An ancient, wealthy, influential Reach house based in Oldtown.','An ancient, wealthy, influential Reach house based in Oldtown.'),
  ('House Redwyne', 'The Arbor', null, 'Paxter Redwyne', 'Controls the Arbor, vineyards, and a powerful fleet.','Controls the Arbor, vineyards, and a powerful fleet.'),
  ('House Tarly', 'Horn Hill', null, 'Randyll Tarly', 'A formidable Reach marcher house and military power.','A formidable Reach marcher house and military power.'),
  ('House Rowan', 'Goldengrove', null, null, 'A major Reach house.','A major Reach house.'),
  ('House Florent', 'Brightwater Keep', null, 'Alester Florent', 'A proud Reach house that claims older royal descent.','A proud Reach house that claims older royal descent.'),
  ('House Fossoway', 'Cider Hall', null, null, 'A prominent Reach house with distinct red-apple and green-apple branches.','A prominent Reach house with distinct red-apple and green-apple branches.'),
  ('House Oakheart', 'Old Oak', null, null, 'A marcher and coastal house of the Reach.','A marcher and coastal house of the Reach.'),
  ('House Crane', 'Red Lake', null, null, 'A house of the Reach.','A house of the Reach.'),
  ('House Merryweather', 'Longtable', null, 'Orton Merryweather', 'A house of the Reach.','A house of the Reach.'),
  ('House Beesbury', 'Honeyholt', null, null, 'A house of the Reach.','A house of the Reach.'),
  ('House Ashford', 'Ashford', null, null, 'A Reach house and tourney seat.','A Reach house and tourney seat.'),
  ('House Caswell', 'Bitterbridge', null, null, 'A Reach house controlling an important crossing on the Mander.','A Reach house controlling an important crossing on the Mander.'),
  ('House Peake', 'Starpike', null, null, 'A house of the Reach.','A house of the Reach.'),
  ('House Webber', 'Coldmoat', null, null, 'A house of the Reach.','A house of the Reach.'),
  ('House Estermont', 'Greenstone', null, null, 'A Stormlands house; Robert Baratheon''s mother came from this family.','A Stormlands house; Robert Baratheon''s mother came from this family.'),
  ('House Tarth', 'Evenfall Hall', null, 'Brienne of Tarth is its heir', 'Rules the island of Tarth. Brienne''s future allegiance is not fixed.','Rules the island of Tarth. Brienne''s future allegiance is not fixed.'),
  ('House Swann', 'Stonehelm', null, null, 'A powerful marcher and coastal house of the Stormlands.','A powerful marcher and coastal house of the Stormlands.'),
  ('House Selmy', 'Harvest Hall', null, null, 'Barristan Selmy''s birth house.','Barristan Selmy''s birth house.'),
  ('House Dondarrion', 'Blackhaven', null, 'Beric Dondarrion', 'A marcher house of the Stormlands.','A marcher house of the Stormlands.'),
  ('House Caron', 'Nightsong', null, null, 'A marcher house of the Stormlands.','A marcher house of the Stormlands.'),
  ('House Penrose', 'Parchments', null, 'Cortnay Penrose serves as castellan of Storm''s End', 'A Stormlands house.','A Stormlands house.'),
  ('House Connington', 'Griffin''s Roost', null, null, 'A once-prominent royalist house; Jon Connington is exiled outside Westeros at the opening.','A once-prominent royalist house; Jon Connington is exiled outside Westeros at the opening.'),
  ('House Wylde', 'Rain House', null, null, 'A house of the Stormlands.','A house of the Stormlands.'),
  ('House Fell', 'Felwood', null, null, 'A house of the Stormlands.','A house of the Stormlands.'),
  ('House Morrigen', 'Crow''s Nest', null, null, 'A house of the Stormlands.','A house of the Stormlands.'),
  ('House Grandison', 'Grandview', null, null, 'A house of the Stormlands.','A house of the Stormlands.'),
  ('House Buckler', 'Bronzegate', null, null, 'A house of the Stormlands.','A house of the Stormlands.'),
  ('House Errol', 'Haystack Hall', null, null, 'A house of the Stormlands.','A house of the Stormlands.'),
  ('House Staedmon', 'Broad Arch', null, null, 'A house of the Stormlands.','A house of the Stormlands.'),
  ('House Cafferen', 'Fawnton', null, null, 'A house of the Stormlands.','A house of the Stormlands.'),
  ('House Rogers', 'Amberly', null, null, 'A house of the Stormlands.','A house of the Stormlands.'),
  ('House Seaworth', null, null, 'Davos Seaworth', 'A newly ennobled house associated with Stannis.','A newly ennobled house associated with Stannis.'),
  ('House Rosby', 'Rosby', null, null, 'A small, strategically placed Crownlands house.','A small, strategically placed Crownlands house.'),
  ('House Stokeworth', 'Stokeworth', null, 'Tanda Stokeworth', 'A Crownlands house near the capital.','A Crownlands house near the capital.'),
  ('House Rykker', 'Duskendale', null, null, 'Controls the secondary port of Duskendale.','Controls the secondary port of Duskendale.'),
  ('House Buckwell', 'Antlers', null, null, 'A Crownlands house.','A Crownlands house.'),
  ('House Staunton', 'Rook''s Rest', null, null, 'A Crownlands house.','A Crownlands house.'),
  ('House Massey', 'Stonedance', null, null, 'A Crownlands house.','A Crownlands house.'),
  ('House Bar Emmon', 'Sharp Point', null, null, 'A Crownlands house.','A Crownlands house.'),
  ('House Brune', 'Brownhollow and the Dyre Den', null, null, 'Two branches/seats associated with Crackclaw Point.','Two branches/seats associated with Crackclaw Point.'),
  ('House Celtigar', 'Claw Isle', null, null, 'An old Valyrian-descended house, loyal to the Crown in principle.','An old Valyrian-descended house, loyal to the Crown in principle.'),
  ('House Velaryon', 'Driftmark', null, 'Monford Velaryon', 'An old Valyrian-descended house with a significant fleet.','An old Valyrian-descended house with a significant fleet.'),
  ('House Sunglass', 'Sweetport Sound', null, null, 'A Crownlands house.','A Crownlands house.'),
  ('House Yronwood', 'Yronwood', null, 'Anders Yronwood', 'A powerful Dornish house and rival/second house to Martell.','A powerful Dornish house and rival/second house to Martell.'),
  ('House Dayne', 'Starfall', null, null, 'An ancient Dornish house associated with Dawn and the Sword of the Morning tradition.','An ancient Dornish house associated with Dawn and the Sword of the Morning tradition.'),
  ('House Fowler', 'Skyreach', null, null, 'A Dornish marcher house.','A Dornish marcher house.'),
  ('House Manwoody', 'Kingsgrave', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Allyrion', 'Godsgrace', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Blackmont', 'Blackmont', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Qorgyle', 'Sandstone', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Uller', 'Hellholt', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Wyl', 'Wyl', null, null, 'A Dornish marcher house.','A Dornish marcher house.'),
  ('House Dalt', 'Lemonwood', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Gargalen', 'Salt Shore', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Santagar', 'Spottswood', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Toland', 'Ghost Hill', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Vaith', 'The Red Dunes', null, null, 'A house of Dorne.','A house of Dorne.'),
  ('House Jordayne', 'The Tor', null, null, 'A house of Dorne.','A house of Dorne.')
on conflict (name) do update set
  seat_name = coalesce(public.houses.seat_name, excluded.seat_name),
  house_words = coalesce(public.houses.house_words, excluded.house_words),
  opening_head = coalesce(public.houses.opening_head, excluded.opening_head),
  opening_summary = coalesce(public.houses.opening_summary, excluded.opening_summary),
  current_summary = coalesce(public.houses.current_summary, excluded.current_summary);

update public.houses as house
set region_id = region.id
from (
  values
    ('House Stark', 'The North'), ('House Bolton', 'The North'), ('House Karstark', 'The North'),
    ('House Manderly', 'The North'), ('House Umber', 'The North'), ('House Glover', 'The North'),
    ('House Mormont', 'The North'), ('House Reed', 'The North'), ('House Cerwyn', 'The North'),
    ('House Tallhart', 'The North'), ('House Hornwood', 'The North'), ('House Ryswell', 'The North'),
    ('House Dustin', 'The North'), ('House Locke', 'The North'),
    ('House Arryn', 'The Vale'), ('House Royce', 'The Vale'),
    ('House Royce of the Gates of the Moon', 'The Vale'), ('House Corbray', 'The Vale'),
    ('House Waynwood', 'The Vale'), ('House Belmore', 'The Vale'), ('House Hunter', 'The Vale'),
    ('House Redfort', 'The Vale'), ('House Templeton', 'The Vale'), ('House Grafton', 'The Vale'),
    ('House Baelish', 'The Vale'), ('House Sunderland', 'The Vale'),
    ('House Tully', 'The Riverlands'), ('House Frey', 'The Riverlands'),
    ('House Blackwood', 'The Riverlands'), ('House Bracken', 'The Riverlands'),
    ('House Mallister', 'The Riverlands'), ('House Piper', 'The Riverlands'),
    ('House Vance of Wayfarer''s Rest', 'The Riverlands'), ('House Vance of Atranta', 'The Riverlands'),
    ('House Mooton', 'The Riverlands'), ('House Darry', 'The Riverlands'),
    ('House Whent', 'The Riverlands'), ('House Smallwood', 'The Riverlands'),
    ('House Roote', 'The Riverlands'), ('House Ryger', 'The Riverlands'),
    ('House Greyjoy', 'The Iron Islands'), ('House Harlaw', 'The Iron Islands'),
    ('House Botley', 'The Iron Islands'), ('House Drumm', 'The Iron Islands'),
    ('House Blacktyde', 'The Iron Islands'), ('House Goodbrother', 'The Iron Islands'),
    ('House Orkwood', 'The Iron Islands'), ('House Wynch', 'The Iron Islands'),
    ('House Lannister', 'The Westerlands'), ('House Lefford', 'The Westerlands'),
    ('House Marbrand', 'The Westerlands'), ('House Crakehall', 'The Westerlands'),
    ('House Brax', 'The Westerlands'), ('House Farman', 'The Westerlands'),
    ('House Westerling', 'The Westerlands'), ('House Serrett', 'The Westerlands'),
    ('House Swyft', 'The Westerlands'), ('House Lydden', 'The Westerlands'),
    ('House Prester', 'The Westerlands'), ('House Banefort', 'The Westerlands'),
    ('House Tyrell', 'The Reach'), ('House Hightower', 'The Reach'),
    ('House Redwyne', 'The Reach'), ('House Tarly', 'The Reach'),
    ('House Rowan', 'The Reach'), ('House Florent', 'The Reach'),
    ('House Fossoway', 'The Reach'), ('House Oakheart', 'The Reach'),
    ('House Crane', 'The Reach'), ('House Merryweather', 'The Reach'),
    ('House Beesbury', 'The Reach'), ('House Ashford', 'The Reach'),
    ('House Caswell', 'The Reach'), ('House Peake', 'The Reach'), ('House Webber', 'The Reach'),
    ('House Baratheon', 'The Stormlands'),
    ('House Baratheon of King''s Landing', 'The Crownlands'),
    ('House Baratheon of Dragonstone', 'The Crownlands'),
    ('House Estermont', 'The Stormlands'), ('House Tarth', 'The Stormlands'),
    ('House Swann', 'The Stormlands'), ('House Selmy', 'The Stormlands'),
    ('House Dondarrion', 'The Stormlands'), ('House Caron', 'The Stormlands'),
    ('House Penrose', 'The Stormlands'), ('House Connington', 'The Stormlands'),
    ('House Wylde', 'The Stormlands'), ('House Fell', 'The Stormlands'),
    ('House Morrigen', 'The Stormlands'), ('House Grandison', 'The Stormlands'),
    ('House Buckler', 'The Stormlands'), ('House Errol', 'The Stormlands'),
    ('House Staedmon', 'The Stormlands'), ('House Cafferen', 'The Stormlands'),
    ('House Rogers', 'The Stormlands'), ('House Seaworth', 'The Stormlands'),
    ('House Rosby', 'The Crownlands'), ('House Stokeworth', 'The Crownlands'),
    ('House Rykker', 'The Crownlands'), ('House Buckwell', 'The Crownlands'),
    ('House Staunton', 'The Crownlands'), ('House Massey', 'The Crownlands'),
    ('House Bar Emmon', 'The Crownlands'), ('House Brune', 'The Crownlands'),
    ('House Celtigar', 'The Crownlands'), ('House Velaryon', 'The Crownlands'),
    ('House Sunglass', 'The Crownlands'),
    ('House Nymeros Martell', 'Dorne'), ('House Yronwood', 'Dorne'),
    ('House Dayne', 'Dorne'), ('House Fowler', 'Dorne'), ('House Manwoody', 'Dorne'),
    ('House Allyrion', 'Dorne'), ('House Blackmont', 'Dorne'), ('House Qorgyle', 'Dorne'),
    ('House Uller', 'Dorne'), ('House Wyl', 'Dorne'), ('House Dalt', 'Dorne'),
    ('House Gargalen', 'Dorne'), ('House Santagar', 'Dorne'), ('House Toland', 'Dorne'),
    ('House Vaith', 'Dorne'), ('House Jordayne', 'Dorne')
) as assignment(house_name, region_name)
join public.world_regions as region on region.name = assignment.region_name
where house.name = assignment.house_name;

-- These opening liquid balances are explicitly game-balance estimates.
-- Rerunning the seed after campaign events will not reset changed balances.
update public.houses as house
set treasury_amount = seed.treasury_amount,
    treasury_is_estimate = true,
    treasury_source_note = seed.source_note
from (
  values
    ('House Lannister', 2000000::numeric, 'Campaign liquid-balance estimate; not a canon treasury figure.'),
    ('House Tyrell', 1500000::numeric, 'Campaign liquid-balance estimate; not a canon treasury figure.'),
    ('House Arryn', 500000::numeric, 'Campaign liquid-balance estimate; not a canon treasury figure.'),
    ('House Stark', 350000::numeric, 'Campaign liquid-balance estimate; not a canon treasury figure.'),
    ('House Tully', 250000::numeric, 'Campaign liquid-balance estimate; not a canon treasury figure.'),
    ('House Greyjoy', 150000::numeric, 'Campaign liquid-balance estimate; not a canon treasury figure; reaving income is not included.'),
    ('House Baratheon', 250000::numeric, 'Campaign liquid-balance estimate for Storm''s End; not a canon treasury figure.'),
    ('House Baratheon of Dragonstone', 75000::numeric, 'Campaign liquid-balance estimate; not a canon treasury figure.'),
    ('House Nymeros Martell', 250000::numeric, 'Campaign liquid-balance estimate; not a canon treasury figure.'),
    ('House Hightower', 500000::numeric, 'Campaign bannerman liquid-balance estimate; not a canon treasury figure.'),
    ('House Redwyne', 400000::numeric, 'Campaign bannerman liquid-balance estimate; not a canon treasury figure.'),
    ('House Manderly', 200000::numeric, 'Campaign bannerman liquid-balance estimate; not a canon treasury figure.'),
    ('House Frey', 200000::numeric, 'Campaign bannerman liquid-balance estimate; not a canon treasury figure.'),
    ('House Grafton', 175000::numeric, 'Campaign bannerman liquid-balance estimate; not a canon treasury figure.'),
    ('House Royce', 125000::numeric, 'Campaign bannerman liquid-balance estimate; not a canon treasury figure.'),
    ('House Mallister', 125000::numeric, 'Campaign bannerman liquid-balance estimate; not a canon treasury figure.'),
    ('House Harlaw', 100000::numeric, 'Campaign bannerman liquid-balance estimate; not a canon treasury figure.'),
    ('House Velaryon', 150000::numeric, 'Campaign bannerman liquid-balance estimate; not a canon treasury figure.')
) as seed(house_name, treasury_amount, source_note)
where house.name = seed.house_name
  and not exists (
    select 1
    from public.game_events
    where reference_key is distinct from 'opening-snapshot'
  );

insert into public.world_financial_records (
  world_state_id,
  reference_key,
  record_type,
  subject_name,
  creditor_name,
  amount,
  lower_bound,
  amount_qualifier,
  summary,
  is_gameplay_assumption,
  source_note
)
values
  (1, 'opening-crown-liquid-treasury', 'liquid_treasury',
    'Crown / Iron Throne', null, 0, null, 'gameplay_convention',
    'No freely spendable liquid treasury for opening gameplay.',
    true, 'Zero is a gameplay convention, not a claim that a canonical audit counted exactly zero coins.'),
  (1, 'opening-crown-total-debt', 'debt',
    'Crown / Iron Throne', null, null, 6000000, 'greater_than',
    'The Crown owes more than six million gold dragons; exact total unknown.',
    false, 'Reported lower bound; do not infer an exact total or fill missing creditor allocations.'),
  (1, 'opening-crown-debt-lannister', 'debt',
    'Crown / Iron Throne', 'House Lannister', 3000000, null, 'approximately',
    'Approximately three million gold dragons owed to House Lannister.',
    false, 'Approximate reported creditor amount.'),
  (1, 'opening-crown-debt-tyrell', 'debt',
    'Crown / Iron Throne', 'Mace Tyrell', null, null, 'unknown',
    'Creditor identified; amount not established.',
    false, 'Do not allocate an invented amount.'),
  (1, 'opening-crown-debt-iron-bank', 'debt',
    'Crown / Iron Throne', 'Iron Bank of Braavos', null, null, 'unknown',
    'Creditor identified; amount not established.',
    false, 'Do not allocate an invented amount.'),
  (1, 'opening-crown-debt-tyroshi-cartels', 'debt',
    'Crown / Iron Throne', 'Tyroshi trading cartels', null, null, 'unknown',
    'Creditor group identified; amount not established.',
    false, 'Do not allocate an invented amount.'),
  (1, 'opening-crown-debt-faith', 'debt',
    'Crown / Iron Throne', 'Faith of the Seven', null, null, 'unknown',
    'Creditor identified; amount not established.',
    false, 'Do not allocate an invented amount.')
on conflict (reference_key) do update set
  record_type = excluded.record_type,
  subject_name = excluded.subject_name,
  creditor_name = excluded.creditor_name,
  amount = excluded.amount,
  lower_bound = excluded.lower_bound,
  amount_qualifier = excluded.amount_qualifier,
  summary = excluded.summary,
  is_gameplay_assumption = excluded.is_gameplay_assumption,
  source_note = excluded.source_note,
  updated_at = now();

-- Only use a location-name match when it is unique in the existing catalogue.
update public.houses as house
set seat_location_id = location.id
from public.playable_locations as location
join (
  select lower(trim(name)) as normalized_name
  from public.playable_locations
  group by lower(trim(name))
  having count(*) = 1
) as unique_location
  on unique_location.normalized_name = lower(trim(location.name))
where house.seat_location_id is null
  and house.seat_name is not null
  and lower(trim(house.seat_name)) = lower(trim(location.name));

-- Establish only the principal liege links supported by the opening regional
-- hierarchy. Crownlands lands remain directly under the Crown, not a house.
update public.houses as vassal
set liege_house_id = liege.id
from (
  values
    ('House Bolton', 'House Stark'), ('House Karstark', 'House Stark'),
    ('House Manderly', 'House Stark'), ('House Umber', 'House Stark'),
    ('House Glover', 'House Stark'), ('House Mormont', 'House Stark'),
    ('House Reed', 'House Stark'), ('House Cerwyn', 'House Stark'),
    ('House Tallhart', 'House Stark'), ('House Hornwood', 'House Stark'),
    ('House Ryswell', 'House Stark'), ('House Dustin', 'House Stark'),
    ('House Locke', 'House Stark'),
    ('House Royce', 'House Arryn'), ('House Royce of the Gates of the Moon', 'House Arryn'),
    ('House Corbray', 'House Arryn'), ('House Waynwood', 'House Arryn'),
    ('House Belmore', 'House Arryn'), ('House Hunter', 'House Arryn'),
    ('House Redfort', 'House Arryn'), ('House Templeton', 'House Arryn'),
    ('House Grafton', 'House Arryn'), ('House Sunderland', 'House Arryn'),
    ('House Frey', 'House Tully'), ('House Blackwood', 'House Tully'),
    ('House Bracken', 'House Tully'), ('House Mallister', 'House Tully'),
    ('House Piper', 'House Tully'), ('House Vance of Wayfarer''s Rest', 'House Tully'),
    ('House Vance of Atranta', 'House Tully'), ('House Mooton', 'House Tully'),
    ('House Darry', 'House Tully'), ('House Whent', 'House Tully'),
    ('House Smallwood', 'House Tully'), ('House Roote', 'House Tully'),
    ('House Ryger', 'House Tully'),
    ('House Harlaw', 'House Greyjoy'), ('House Botley', 'House Greyjoy'),
    ('House Drumm', 'House Greyjoy'), ('House Blacktyde', 'House Greyjoy'),
    ('House Goodbrother', 'House Greyjoy'), ('House Orkwood', 'House Greyjoy'),
    ('House Wynch', 'House Greyjoy'),
    ('House Lefford', 'House Lannister'), ('House Marbrand', 'House Lannister'),
    ('House Crakehall', 'House Lannister'), ('House Brax', 'House Lannister'),
    ('House Farman', 'House Lannister'), ('House Westerling', 'House Lannister'),
    ('House Serrett', 'House Lannister'), ('House Swyft', 'House Lannister'),
    ('House Lydden', 'House Lannister'), ('House Prester', 'House Lannister'),
    ('House Banefort', 'House Lannister'),
    ('House Hightower', 'House Tyrell'), ('House Redwyne', 'House Tyrell'),
    ('House Tarly', 'House Tyrell'), ('House Rowan', 'House Tyrell'),
    ('House Florent', 'House Tyrell'), ('House Fossoway', 'House Tyrell'),
    ('House Oakheart', 'House Tyrell'), ('House Crane', 'House Tyrell'),
    ('House Merryweather', 'House Tyrell'), ('House Beesbury', 'House Tyrell'),
    ('House Ashford', 'House Tyrell'), ('House Caswell', 'House Tyrell'),
    ('House Peake', 'House Tyrell'), ('House Webber', 'House Tyrell'),
    ('House Estermont', 'House Baratheon'), ('House Tarth', 'House Baratheon'),
    ('House Swann', 'House Baratheon'), ('House Selmy', 'House Baratheon'),
    ('House Dondarrion', 'House Baratheon'), ('House Caron', 'House Baratheon'),
    ('House Penrose', 'House Baratheon'), ('House Connington', 'House Baratheon'),
    ('House Wylde', 'House Baratheon'), ('House Fell', 'House Baratheon'),
    ('House Morrigen', 'House Baratheon'), ('House Grandison', 'House Baratheon'),
    ('House Buckler', 'House Baratheon'), ('House Errol', 'House Baratheon'),
    ('House Staedmon', 'House Baratheon'), ('House Cafferen', 'House Baratheon'),
    ('House Rogers', 'House Baratheon'), ('House Seaworth', 'House Baratheon of Dragonstone'),
    ('House Yronwood', 'House Nymeros Martell'), ('House Dayne', 'House Nymeros Martell'),
    ('House Fowler', 'House Nymeros Martell'), ('House Manwoody', 'House Nymeros Martell'),
    ('House Allyrion', 'House Nymeros Martell'), ('House Blackmont', 'House Nymeros Martell'),
    ('House Qorgyle', 'House Nymeros Martell'), ('House Uller', 'House Nymeros Martell'),
    ('House Wyl', 'House Nymeros Martell'), ('House Dalt', 'House Nymeros Martell'),
    ('House Gargalen', 'House Nymeros Martell'), ('House Santagar', 'House Nymeros Martell'),
    ('House Toland', 'House Nymeros Martell'), ('House Vaith', 'House Nymeros Martell'),
    ('House Jordayne', 'House Nymeros Martell')
) as hierarchy(vassal_name, liege_name)
join public.houses as liege on liege.name = hierarchy.liege_name
where vassal.name = hierarchy.vassal_name
  and vassal.liege_house_id is null
  and vassal.id <> liege.id;

-- Link existing directory records to the canonical region and opening house.
update public.playable_locations as location
set world_region_id = region.id
from public.world_regions as region
where trim(location.region) = region.name
  and location.world_region_id is null;

update public.playable_characters as character
set world_region_id = region.id
from public.world_regions as region
where trim(character.region) = region.name
  and character.world_region_id is null;

update public.playable_characters as character
set
  starting_house_id = coalesce(character.starting_house_id, starting_house.id),
  current_house_id = coalesce(character.current_house_id, starting_house.id)
from public.houses as starting_house
where trim(character.starting_house) = starting_house.name;

update public.playable_characters as character
set birth_house_id = house.id
from public.houses as house
where character.birth_house_id is null
  and character.birth_house is not null
  and trim(character.birth_house) = house.name;

-- The seed establishes current fields from opening fields only before any
-- non-opening event is present, so rerunning it cannot roll back game progress.
update public.playable_characters as character
set
  current_status = character.opening_status,
  current_life_status = character.opening_life_status,
  current_location_id = character.opening_location_id,
  current_claim_target = character.opening_claim_target,
  current_claim_basis = character.opening_claim_basis,
  current_claim_status = character.opening_claim_status,
  current_claim_summary = character.opening_claim_summary
where not exists (
  select 1
  from public.game_events
  where reference_key is distinct from 'opening-snapshot'
);

update public.user_character_assignments as assignment
set current_location_id = character.current_location_id
from public.playable_characters as character
where assignment.character_id = character.id
  and assignment.current_location_id is null;

insert into public.house_location_relations (house_id, location_id, relation_type)
select house.id, location.id, 'opening_control'
from public.playable_locations as location
join public.houses as house on trim(location.starting_house) = house.name
where location.starting_house is not null
on conflict (house_id, location_id, relation_type) do nothing;

insert into public.house_location_relations (house_id, location_id, relation_type)
select house.id, location.id, 'current_control'
from public.playable_locations as location
join public.houses as house on trim(location.house) = house.name
where location.house is not null
on conflict (house_id, location_id, relation_type) do nothing;

-- Seed the opening political claims for roster characters only when the
-- corresponding claim does not already exist.
insert into public.political_claims (
  claimant_character_id,
  claimant_house_id,
  target_title,
  claim_status,
  summary
)
select
  character.id,
  character.starting_house_id,
  trim(character.opening_claim_target),
  coalesce(character.opening_claim_status, 'unresolved'),
  character.opening_claim_summary
from public.playable_characters as character
where character.opening_claim_target is not null
  and length(trim(character.opening_claim_target)) > 0
  and not exists (
    select 1
    from public.political_claims as claim
    where claim.claimant_character_id = character.id
      and claim.target_title = trim(character.opening_claim_target)
  );

insert into public.house_claims (house_id, claim_id)
select character.starting_house_id, claim.id
from public.political_claims as claim
join public.playable_characters as character
  on character.id = claim.claimant_character_id
where character.starting_house_id is not null
on conflict (house_id, claim_id) do nothing;

-- No succession war is active in the opening snapshot. These are completed
-- historical conflicts, not active wars.
insert into public.world_wars (
  reference_key,
  world_state_id,
  name,
  status,
  summary,
  is_public,
  public_summary
)
values
  ('opening-roberts-rebellion', 1, 'Robert''s Rebellion', 'ended',
    'The Targaryen dynasty was overthrown. Exact dates are not set in this opening-state database.',
    true, 'Robert''s Rebellion ended with the overthrow of the Targaryen dynasty.'),
  ('opening-greyjoy-rebellion', 1, 'Greyjoy Rebellion', 'ended',
    'The rebellion was defeated years before the opening; the reference places it about nine years earlier.',
    true, 'The Greyjoy Rebellion was defeated years ago. Balon Greyjoy remains Lord of the Iron Islands.')
on conflict (reference_key) where reference_key is not null do update set
  summary = excluded.summary,
  public_summary = excluded.public_summary,
  is_public = excluded.is_public;

insert into public.war_participants (war_id, house_id, side)
select war.id, house.id, participant.side
from (
  values
    ('opening-roberts-rebellion', 'House Baratheon', 'rebellion'),
    ('opening-roberts-rebellion', 'House Targaryen', 'royal dynasty'),
    ('opening-greyjoy-rebellion', 'House Greyjoy', 'rebellion'),
    ('opening-greyjoy-rebellion', 'House Baratheon', 'Crown')
) as participant(war_key, house_name, side)
join public.world_wars as war on war.reference_key = participant.war_key
join public.houses as house on house.name = participant.house_name
on conflict (war_id, house_id) do nothing;

-- Only explicitly established opening relationships are seeded here.
insert into public.diplomacy_records (
  reference_key,
  world_state_id,
  relation_type,
  status,
  house_a_id,
  house_b_id,
  character_a_id,
  character_b_id,
  related_location_id,
  terms,
  is_public,
  public_summary
)
select
  seed.reference_key,
  1,
  seed.relation_type,
  seed.status,
  house_a.id,
  house_b.id,
  character_a.id,
  character_b.id,
  location.id,
  seed.terms,
  seed.is_public,
  seed.public_summary
from (
  values
    ('opening-marriage-eddard-catelyn', 'marriage', 'active',
      'House Stark', 'House Tully', 'Eddard Stark', 'Catelyn Stark', null,
      'Marriage between Eddard Stark and Catelyn Stark; Catelyn was born a Tully.',
      true, 'Eddard Stark and Catelyn Stark are married.'),
    ('opening-betrothal-sansa-joffrey', 'marriage', 'proposed',
      'House Stark', 'House Baratheon', 'Sansa Stark', 'Joffrey Baratheon', null,
      'Sansa Stark is betrothed to Joffrey at the opening.',
      true, 'Sansa Stark is betrothed to Joffrey.'),
    ('opening-betrothal-mycella-trystane', 'marriage', 'proposed',
      'House Baratheon', 'House Nymeros Martell', 'Myrcella Baratheon', 'Trystane Martell', null,
      'Trystane Martell is betrothed to Myrcella at the opening.',
      true, 'Trystane Martell is betrothed to Myrcella.'),
    ('opening-hostage-theon-winterfell', 'hostage', 'active',
      'House Greyjoy', 'House Stark', 'Theon Greyjoy', 'Eddard Stark', 'Winterfell',
      'Theon Greyjoy is Balon Greyjoy''s son and is held at Winterfell as a ward/hostage.',
      true, 'Theon Greyjoy was raised at Winterfell as a ward/hostage after the Greyjoy Rebellion.')
) as seed(
  reference_key, relation_type, status, house_a_name, house_b_name,
  character_a_name, character_b_name, location_name, terms, is_public, public_summary
)
left join public.houses as house_a on house_a.name = seed.house_a_name
left join public.houses as house_b on house_b.name = seed.house_b_name
left join public.playable_characters as character_a
  on lower(trim(character_a.display_name)) = lower(trim(seed.character_a_name))
left join public.playable_characters as character_b
  on lower(trim(character_b.display_name)) = lower(trim(seed.character_b_name))
left join public.playable_locations as location
  on lower(trim(location.name)) = lower(trim(seed.location_name))
where seed.location_name is null
   or (
     select count(*)
     from public.playable_locations as candidate
     where lower(trim(candidate.name)) = lower(trim(seed.location_name))
   ) = 1
on conflict (reference_key) where reference_key is not null do nothing;

-- Store the canonical opening event once. Participants are linked to existing
-- roster rows where those rows exist; the event remains useful without them.
insert into public.game_events (
  reference_key,
  occurred_at,
  world_state_id,
  world_date_label,
  event_type,
  title,
  canonical_summary,
  public_summary,
  character_knowledge,
  affected_character_ids,
  affected_house_ids,
  location,
  location_id,
  state_changes
)
select
  'opening-snapshot',
  transaction_timestamp(),
  1,
  'Summer 298 AC; exact day unknown',
  'political',
  'The opening situation after Robert I Baratheon''s death',
  'Robert I Baratheon is dead. Joffrey is treated by the royal court as heir, but the legitimacy question is unresolved. Eddard Stark is Hand. Jon Arryn is dead. Stannis is at Dragonstone; Renly is in King''s Landing. No war of succession has begun. House positions and regional situations are initialized from the supplied starting reference.',
  'King Robert I is dead. The court treats Joffrey as heir, but the succession remains politically vulnerable. The great houses have not all committed to a side, and no war of succession has begun.',
  '{}'::jsonb,
  coalesce((
    select array_agg(character.id order by character.id)
    from public.playable_characters as character
    where lower(trim(character.display_name)) in (
      'robert baratheon', 'joffrey baratheon', 'eddard stark', 'ned stark',
      'jon arryn', 'cersei lannister', 'stannis baratheon', 'renly baratheon',
      'balon greyjoy', 'theon greyjoy', 'robb stark', 'lysa arryn',
      'hoster tully', 'mace tyrell', 'doran martell'
    )
  ), '{}'::integer[]),
  coalesce((
    select array_agg(house.id order by house.id)
    from public.houses as house
    where house.name in (
      'House Stark', 'House Arryn', 'House Tully', 'House Greyjoy',
      'House Lannister', 'House Tyrell', 'House Baratheon',
      'House Baratheon of King''s Landing',
      'House Baratheon of Dragonstone', 'House Nymeros Martell'
    )
  ), '{}'::bigint[]),
  null,
  null,
  '[]'::jsonb
where not exists (
  select 1 from public.game_events where reference_key = 'opening-snapshot'
);

update public.game_events
set world_date_label = 'Summer 298 AC; exact day unknown'
where reference_key = 'opening-snapshot';

-- Keep the succession secret canonical and private. Do not mark the other
-- characters as knowing it: the reference supports only these knowledge states.
with secret as (
  insert into public.character_secrets (
    reference_key,
    subject_character_id,
    canonical_summary,
    public_summary
  )
  select
    'opening-royal-parentage',
    (
      select character.id
      from public.playable_characters as character
      where lower(trim(character.display_name)) in ('joffrey baratheon', 'joffrey')
      order by case lower(trim(character.display_name))
        when 'joffrey baratheon' then 0 else 1 end
      limit 1
    ),
    'Joffrey, Myrcella, and Tommen are biologically the children of Cersei Lannister and Jaime Lannister, not Robert Baratheon. This is not public knowledge at the opening.',
    'The royal succession is vulnerable to private dispute, but no public challenge has settled it.'
  on conflict (reference_key) where reference_key is not null do update set
    canonical_summary = excluded.canonical_summary,
    public_summary = excluded.public_summary
  returning id
)
insert into public.character_secret_subjects (secret_id, character_id, role)
select secret.id, character.id, 'parentage'
from secret
cross join public.playable_characters as character
where lower(trim(character.display_name)) in (
  'joffrey baratheon', 'myrcella baratheon', 'tommen baratheon'
)
on conflict do nothing;

with secret as (
  select id
  from public.character_secrets
  where reference_key = 'opening-royal-parentage'
),
knowledge(character_name, knowledge_status, details) as (
  values
    ('cersei lannister', 'knows', 'Cersei knows the truth of her relationship with Jaime and the children''s parentage.'),
    ('jaime lannister', 'knows', 'Jaime knows the truth of his relationship with Cersei and the children''s parentage.'),
    ('eddard stark', 'suspects', 'Ned''s suspicion arises from the Baratheon black-hair pattern, the children''s Lannister appearance, and Jon Arryn''s investigation.'),
    ('ned stark', 'suspects', 'Ned''s suspicion arises from the Baratheon black-hair pattern, the children''s Lannister appearance, and Jon Arryn''s investigation.'),
    ('stannis baratheon', 'suspects', 'Stannis has reason to suspect the truth; the reference does not establish that every lord knows his conclusions.')
)
insert into public.character_secret_knowledge (
  secret_id,
  character_id,
  knowledge_status,
  details
)
select secret.id, character.id, knowledge.knowledge_status, knowledge.details
from secret
join knowledge on true
join public.playable_characters as character
  on lower(trim(character.display_name)) = knowledge.character_name
on conflict (secret_id, character_id) do nothing;

commit;

-- Sanity-check the seeded snapshot.
select id, date_description, season, current_situation
from public.world_state
where id = 1;

select region.name, region.current_situation, count(location.id) as locations
from public.world_regions as region
left join public.playable_locations as location
  on location.world_region_id = region.id
group by region.id, region.name, region.current_situation
order by region.id;

select status, count(*) as wars
from public.world_wars
group by status
order by status;

select reference_key, relation_type, status
from public.diplomacy_records
where reference_key like 'opening-%'
order by reference_key;

select
  region.name,
  estimate.force_name,
  estimate.minimum_strength,
  estimate.maximum_strength,
  estimate.strength_unit,
  estimate.confidence_level,
  estimate.readiness_status,
  estimate.is_gameplay_assumption
from public.regional_military_estimates as estimate
join public.world_regions as region on region.id = estimate.region_id
order by region.id, estimate.force_name;

select name, treasury_amount, debt_amount, debt_summary
from public.houses
where treasury_amount is not null or debt_amount is not null or debt_summary is not null
order by name;

select
  reference_key,
  record_type,
  subject_name,
  creditor_name,
  amount,
  lower_bound,
  amount_qualifier,
  is_gameplay_assumption
from public.world_financial_records
where reference_key like 'opening-%'
order by reference_key;

select
  rule_name,
  minimum_days,
  maximum_days,
  target_strength,
  is_gameplay_assumption
from public.military_muster_rules
where reference_key like 'opening-%'
order by minimum_days, rule_name;
