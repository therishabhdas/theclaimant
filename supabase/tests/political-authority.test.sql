begin;

do $$
declare
  world public.world_state%rowtype;
  actor_id integer;
  next_turn integer;
  character_count integer;
  location_count integer;
begin
  if to_regclass('public.political_authority_positions') is null
    or to_regclass('public.political_action_outcomes') is null then
    raise exception
      'Run supabase/political-authority.sql before this regression test.';
  end if;

  select count(*) into character_count
  from public.playable_characters
  where is_playable is true;
  select count(*) into location_count
  from public.playable_locations
  where is_playable is true;
  if character_count <> 40 or location_count <> 30 then
    raise exception
      'The opening catalogue must contain exactly 40 playable characters and 30 playable locations.';
  end if;

  select * into world
  from public.world_state
  where id = 1;
  if not found then
    raise exception 'A world_state row with id 1 is required.';
  end if;
  next_turn := world.turn_number + 1;

  select character.id into actor_id
  from public.playable_characters as character
  where character.is_playable is true
  order by character.id
  limit 1;
  if actor_id is null then
    raise exception 'At least one playable character is required.';
  end if;

  insert into public.gameplay_npc_orders (
    world_state_id, turn_number, character_id, action_data,
    resolution_status, resolution_note, resolution_outcome
  )
  values (
    1,
    next_turn,
    actor_id,
    jsonb_build_array(jsonb_build_object(
      'type', 'political_action',
      'actorCharacterId', actor_id,
      'operation', 'claim_title',
      'targetCharacterId', null,
      'targetHouseId', null,
      'targetLocationId', null,
      'authorityPositionId', null,
      'delegationId', null,
      'targetTitle', 'Regression-test claim',
      'details', 'Verify that claims remain distinct from recognized authority.',
      'isPublic', false
    )),
    'accepted',
    'Regression-test political claim.',
    jsonb_build_object(
      'actorCharacterId', actor_id,
      'result', 'executed',
      'consequence', 'The claim was recorded without conferring recognized authority.',
      'effects', '[]'::jsonb
    )
  )
  on conflict (world_state_id, turn_number, character_id)
  do update set
    action_data = excluded.action_data,
    resolution_status = excluded.resolution_status,
    resolution_note = excluded.resolution_note,
    resolution_outcome = excluded.resolution_outcome;

  update public.world_state
  set turn_number = next_turn
  where id = 1;

  if not exists (
    select 1
    from public.political_action_outcomes as outcome
    where outcome.world_state_id = 1
      and outcome.turn_number = next_turn
      and outcome.actor_character_id = actor_id
      and outcome.action_operation = 'claim_title'
      and outcome.order_accepted is true
      and outcome.execution_status = 'executed'
      and outcome.authority_status = 'contested'
      and outcome.resolution_plan ->> 'result' = 'executed'
      and jsonb_typeof(outcome.state_changes) = 'array'
  ) then
    raise exception 'The accepted political attempt was not persisted with contested authority.';
  end if;
  if not exists (
    select 1
    from public.political_claims as claim
    where claim.claimant_character_id = actor_id
      and claim.target_title = 'Regression-test claim'
      and claim.claim_status = 'contested'
  ) then
    raise exception 'The political claim was not persisted as contested.';
  end if;

  if (
    select count(*) from public.playable_characters where is_playable is true
  ) <> character_count or (
    select count(*) from public.playable_locations where is_playable is true
  ) <> location_count then
    raise exception 'Political resolution changed the playable world catalogue.';
  end if;
end
$$;

rollback;
