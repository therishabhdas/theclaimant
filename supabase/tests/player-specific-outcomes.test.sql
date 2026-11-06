begin;

do $$
declare
  world public.world_state%rowtype;
  turn_to_resolve integer;
  lease_token uuid := gen_random_uuid();
  player_user uuid;
  player_character integer;
  actor_id integer;
  expected_outcomes integer;
  actual_outcomes integer;
  resolved_summary text;
  resolution_result jsonb;
  outcome public.gameplay_order_outcomes%rowtype;
  event_knowledge jsonb;
begin
  if to_regclass('public.gameplay_order_outcomes') is null then
    raise exception
      'Run the latest supabase/global-turn-cycle.sql before this regression test.';
  end if;
  if to_regclass('public.political_action_outcomes') is null then
    raise exception
      'Run supabase/political-authority.sql before this political outcome regression.';
  end if;

  select * into world
  from public.world_state
  where id = 1;
  if not found then
    raise exception 'A world_state row with id 1 is required.';
  end if;

  select assignment.user_id, assignment.character_id
  into player_user, player_character
  from public.user_character_assignments as assignment
  order by assignment.user_id
  limit 1;
  if player_user is null or player_character is null then
    raise exception 'At least one player character assignment is required.';
  end if;

  turn_to_resolve := world.turn_number + 1;

  insert into public.gameplay_turn_participants (
    world_state_id, turn_number, user_id, character_id
  )
  select 1, turn_to_resolve, assignment.user_id, assignment.character_id
  from public.user_character_assignments as assignment
  on conflict do nothing;

  insert into public.gameplay_turn_orders (
    request_id, world_state_id, turn_number, user_id, character_id,
    player_request, action_data, resolution_status, resolution_note
  )
  select
    md5('outcome-regression:' || turn_to_resolve || ':' || participant.user_id)::uuid,
    1,
    turn_to_resolve,
    participant.user_id,
    participant.character_id,
    'Outcome persistence regression order.',
    case when participant.character_id = player_character then
      jsonb_build_array(jsonb_build_object(
        'type', 'political_action',
        'actorCharacterId', participant.character_id,
        'operation', 'claim_title',
        'targetCharacterId', null,
        'targetHouseId', null,
        'targetLocationId', null,
        'authorityPositionId', null,
        'delegationId', null,
        'targetTitle', 'Player-specific regression claim',
        'details', 'Verify the political result is persisted privately.',
        'isPublic', false
      ))
    else
      jsonb_build_array(jsonb_build_object(
        'type', 'wait',
        'actorCharacterId', participant.character_id,
        'reason', 'Verify player-specific outcome persistence.'
      ))
    end,
    'pending',
    null
  from public.gameplay_turn_participants as participant
  where participant.world_state_id = 1
    and participant.turn_number = turn_to_resolve
  on conflict (world_state_id, turn_number, user_id)
  do update set
    action_data = excluded.action_data,
    resolution_status = excluded.resolution_status,
    resolution_note = excluded.resolution_note;

  insert into public.gameplay_npc_orders (
    world_state_id, turn_number, character_id, action_data, resolution_status
  )
  select
    1,
    turn_to_resolve,
    character.id,
    jsonb_build_array(jsonb_build_object(
      'type', 'wait',
      'actorCharacterId', character.id,
      'reason', 'Outcome persistence regression order.'
    )),
    'proposed'
  from public.playable_characters as character
  where not exists (
    select 1
    from public.user_character_assignments as assignment
    where assignment.character_id = character.id
  )
  on conflict (world_state_id, turn_number, character_id)
  do update set
    action_data = excluded.action_data,
    resolution_status = excluded.resolution_status;

  select count(*) into expected_outcomes
  from (
    select participant.character_id
    from public.gameplay_turn_participants as participant
    where participant.world_state_id = 1
      and participant.turn_number = turn_to_resolve
    union all
    select npc.character_id
    from public.gameplay_npc_orders as npc
    where npc.world_state_id = 1
      and npc.turn_number = turn_to_resolve
  ) as actors;

  update public.world_state
  set turn_phase = 'resolving',
      resolution_started_at = clock_timestamp(),
      resolution_lease_token = lease_token,
      resolution_lease_owner = 'outcome-regression',
      resolution_lease_expires_at = clock_timestamp() + interval '5 minutes',
      resolution_checkpoint = null
  where id = 1;

  select jsonb_agg(case when actors.character_id = player_character then
    jsonb_build_object(
      'actorCharacterId', actors.character_id,
      'decision', 'accept',
      'reason', 'The claim was contextually accepted as an attempt.',
      'politicalOutcome', jsonb_build_object(
        'actorCharacterId', actors.character_id,
        'result', 'executed',
        'consequence', 'The contested claim was recorded.',
        'effects', jsonb_build_array()
      )
    )
    else jsonb_build_object(
      'actorCharacterId', actors.character_id,
      'decision', 'accept',
      'reason', 'The regression order is a non-state-changing pass.'
    )
  end order by actors.character_id)
  into resolution_result
  from (
    select participant.character_id
    from public.gameplay_turn_participants as participant
    where participant.world_state_id = 1
      and participant.turn_number = turn_to_resolve
    union all
    select npc.character_id
    from public.gameplay_npc_orders as npc
    where npc.world_state_id = 1
      and npc.turn_number = turn_to_resolve
  ) as actors;

  resolution_result := public.resolve_game_turn(
    turn_to_resolve,
    world.gameplay_revision,
    lease_token,
    'outcome-regression',
    resolution_result,
    'Outcome persistence regression',
    'other',
    'Regression-only shared-turn resolution.'
  );

  select * into outcome
  from public.gameplay_order_outcomes
  where world_state_id = 1
    and turn_number = turn_to_resolve
    and actor_character_id = player_character;
  if not found then
    raise exception 'The player's action outcome was not persisted.';
  end if;
  if outcome.original_order ->> 'type' <> 'political_action'
    or outcome.decision_status <> 'accepted'
    or outcome.execution_status <> 'executed'
    or outcome.outcome_summary not like '%claim was recorded%'
    or jsonb_typeof(outcome.state_changes) <> 'array'
    or jsonb_array_length(outcome.state_changes) = 0
    or not exists (
      select 1
      from jsonb_array_elements(outcome.state_changes) as wrapper(value)
      cross join lateral jsonb_array_elements(
        wrapper.value #> '{structuredChange,stateChanges}'
      ) as change(value)
      where change.value ->> 'type' = 'claim'
        and change.value #>> '{resultingState,claimantCharacterId}' =
          player_character::text
        and change.value #>> '{resultingState,claimStatus}' = 'contested'
    )
    or outcome.event_id is null then
    raise exception 'The persisted player outcome does not match the committed political claim.';
  end if;

  select count(*) into actual_outcomes
  from public.gameplay_order_outcomes as saved
  where saved.world_state_id = 1
    and saved.turn_number = turn_to_resolve;
  if actual_outcomes <> expected_outcomes then
    raise exception 'Not every player and NPC order received a persisted outcome.';
  end if;

  select event.character_knowledge into event_knowledge
  from public.game_events as event
  where event.id = outcome.event_id;
  if event_knowledge ->> player_character::text <> outcome.outcome_summary then
    raise exception 'The event log did not preserve the character-scoped outcome.';
  end if;

  select resolution.canonical_summary into resolved_summary
  from public.gameplay_turn_resolutions as resolution
  where resolution.world_state_id = 1
    and resolution.turn_number = turn_to_resolve;
  if resolved_summary is null
    or resolved_summary not like '%claim was recorded%'
    or resolved_summary like '%Regression-only shared-turn resolution.%' then
    raise exception 'The canonical turn summary was not rebuilt from persisted outcomes.';
  end if;

  if has_table_privilege('authenticated', 'public.gameplay_order_outcomes', 'SELECT') then
    raise exception 'Authenticated clients must not directly read private order outcomes.';
  end if;
end
$$;

rollback;
