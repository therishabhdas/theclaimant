begin;

do $$
declare
  world public.world_state%rowtype;
  actor_ids integer[];
  next_turn integer;
  throne_entity_id bigint;
  removal_position_id bigint;
  challenged_position_id bigint;
  delegation_id bigint;
  target_location_id bigint;
  actor_house_id bigint;
  controls_before bigint[];
  controls_after bigint[];
begin
  if to_regclass('public.political_authority_positions') is null
    or to_regclass('public.political_action_outcomes') is null
    or to_regclass('public.gameplay_npc_orders') is null then
    raise exception
      'Run global-turn-cycle.sql and political-authority.sql before this regression test.';
  end if;

  select * into world from public.world_state where id = 1;
  if not found then
    raise exception 'A world_state row with id 1 is required.';
  end if;
  next_turn := world.turn_number + 1;

  select array_agg(character.id order by character.id)
  into actor_ids
  from (
    select character.id
    from public.playable_characters as character
    where character.is_playable is true
      and not exists (
        select 1
        from public.user_character_assignments as assignment
        where assignment.character_id = character.id
      )
    order by character.id
    limit 6
  ) as character;
  if coalesce(array_length(actor_ids, 1), 0) <> 6 then
    raise exception 'Six unassigned playable characters are required for political regression.';
  end if;

  select entity.id into throne_entity_id
  from public.political_entities as entity
  where entity.entity_key = 'institution:iron-throne';
  if throne_entity_id is null then
    raise exception 'The canonical Iron Throne political entity is missing.';
  end if;

  insert into public.political_authority_positions (
    entity_id, character_id, position_name, appointment_basis,
    position_status, recognition_status, is_public
  )
  values
    (throne_entity_id, actor_ids[1], 'Regression removal office',
      'appointment', 'active', 'recognized', true),
    (throne_entity_id, actor_ids[4], 'Regression contested office',
      'appointment', 'active', 'recognized', true);

  select max(position.id) into removal_position_id
  from public.political_authority_positions as position
  where position.entity_id = throne_entity_id
    and position.position_name = 'Regression removal office'
    and position.character_id = actor_ids[1];
  select max(position.id) into challenged_position_id
  from public.political_authority_positions as position
  where position.entity_id = throne_entity_id
    and position.position_name = 'Regression contested office'
    and position.character_id = actor_ids[4];
  if removal_position_id is null or challenged_position_id is null then
    raise exception 'Political regression offices were not created.';
  end if;

  insert into public.political_delegations (
    authority_position_id, delegator_character_id, delegate_character_id,
    responsibilities, recognition_status, is_public, starts_turn
  )
  values (
    challenged_position_id, actor_ids[4], actor_ids[1],
    'Regression-only delegated responsibility.',
    'recognized', true, next_turn
  )
  returning id into delegation_id;

  select coalesce(character.current_house_id, character.starting_house_id)
  into actor_house_id
  from public.playable_characters as character
  where character.id = actor_ids[5];
  select location.id into target_location_id
  from public.playable_locations as location
  where location.is_playable is true
    and exists (
      select 1
      from public.house_location_relations as relation
      where relation.location_id = location.id
        and relation.relation_type = 'current_control'
        and relation.house_id is distinct from actor_house_id
    )
  order by location.id
  limit 1;
  if target_location_id is null then
    raise exception 'A playable location controlled by a different house is required.';
  end if;
  select array_agg(relation.house_id order by relation.house_id)
  into controls_before
  from public.house_location_relations as relation
  where relation.location_id = target_location_id
    and relation.relation_type = 'current_control';
  if coalesce(array_length(controls_before, 1), 0) = 0 then
    raise exception 'The contested seizure target must have recorded existing control.';
  end if;

  insert into public.gameplay_npc_orders (
    world_state_id, turn_number, character_id, action_data,
    resolution_status, resolution_note, resolution_outcome
  )
  values
    (1, next_turn, actor_ids[1],
      jsonb_build_array(jsonb_build_object(
        'type', 'political_action', 'actorCharacterId', actor_ids[1],
        'operation', 'claim_title', 'targetCharacterId', null,
        'targetHouseId', null, 'targetLocationId', null,
        'authorityPositionId', null, 'delegationId', null,
        'targetTitle', 'Regression contested claim', 'details', 'First simultaneous claim.',
        'isPublic', false
      )),
      'accepted', 'First competing claim.',
      jsonb_build_object('actorCharacterId', actor_ids[1], 'result', 'executed',
        'consequence', 'The claim was recorded as contested.', 'effects', '[]'::jsonb)),
    (1, next_turn, actor_ids[2],
      jsonb_build_array(jsonb_build_object(
        'type', 'political_action', 'actorCharacterId', actor_ids[2],
        'operation', 'claim_title', 'targetCharacterId', null,
        'targetHouseId', null, 'targetLocationId', null,
        'authorityPositionId', null, 'delegationId', null,
        'targetTitle', 'Regression contested claim', 'details', 'Second simultaneous claim.',
        'isPublic', false
      )),
      'accepted', 'Second competing claim.',
      jsonb_build_object('actorCharacterId', actor_ids[2], 'result', 'executed',
        'consequence', 'The claim was recorded as contested.', 'effects', '[]'::jsonb)),
    (1, next_turn, actor_ids[3],
      jsonb_build_array(jsonb_build_object(
        'type', 'political_action', 'actorCharacterId', actor_ids[3],
        'operation', 'remove', 'targetCharacterId', null,
        'targetHouseId', null, 'targetLocationId', null,
        'authorityPositionId', removal_position_id, 'delegationId', null,
        'targetTitle', null, 'details', 'Unauthorized removal attempt.',
        'isPublic', false
      )),
      'accepted', 'Unauthorized removal attempt.',
      jsonb_build_object('actorCharacterId', actor_ids[3], 'result', 'resisted',
        'consequence', 'The officeholder resisted the attempted removal.', 'effects', '[]'::jsonb)),
    (1, next_turn, actor_ids[4],
      jsonb_build_array(jsonb_build_object(
        'type', 'political_action', 'actorCharacterId', actor_ids[4],
        'operation', 'revoke_delegation', 'targetCharacterId', null,
        'targetHouseId', null, 'targetLocationId', null,
        'authorityPositionId', null, 'delegationId', delegation_id,
        'targetTitle', null, 'details', 'Revoke the recorded delegation.',
        'isPublic', false
      )),
      'accepted', 'Delegation revocation.',
      jsonb_build_object('actorCharacterId', actor_ids[4], 'result', 'executed',
        'consequence', 'The delegation was revoked.',
        'effects', jsonb_build_array(jsonb_build_object(
          'type', 'delegation', 'delegationId', delegation_id, 'status', 'revoked'
        )))),
    (1, next_turn, actor_ids[5],
      jsonb_build_array(jsonb_build_object(
        'type', 'political_action', 'actorCharacterId', actor_ids[5],
        'operation', 'seize_location', 'targetCharacterId', null,
        'targetHouseId', null, 'targetLocationId', target_location_id,
        'authorityPositionId', null, 'delegationId', null,
        'targetTitle', null, 'details', 'Seize the defended location.',
        'isPublic', true
      )),
      'accepted', 'Contested territorial seizure.',
      jsonb_build_object('actorCharacterId', actor_ids[5], 'result', 'executed',
        'consequence', 'The attempt met opposition.',
        'effects', '[]'::jsonb)),
    (1, next_turn, actor_ids[6],
      jsonb_build_array(jsonb_build_object(
        'type', 'political_action', 'actorCharacterId', actor_ids[6],
        'operation', 'challenge', 'targetCharacterId', null,
        'targetHouseId', null, 'targetLocationId', null,
        'authorityPositionId', challenged_position_id, 'delegationId', null,
        'targetTitle', null, 'details', 'Challenge the contested office.',
        'isPublic', true
      )),
      'accepted', 'Partial political challenge.',
      jsonb_build_object('actorCharacterId', actor_ids[6], 'result', 'partially_executed',
        'consequence', 'The office was formally disputed.',
        'effects', jsonb_build_array(jsonb_build_object(
          'type', 'position',
          'authorityPositionId', challenged_position_id,
          'positionStatus', 'contested',
          'recognitionStatus', 'contested',
          'isDisputed', true
        ))))
  on conflict (world_state_id, turn_number, character_id)
  do update set
    action_data = excluded.action_data,
    resolution_status = excluded.resolution_status,
    resolution_note = excluded.resolution_note,
    resolution_outcome = excluded.resolution_outcome;

  update public.world_state
  set turn_number = next_turn
  where id = 1;

  if (
    select count(*) from public.political_claims as claim
    where claim.target_title = 'Regression contested claim'
      and claim.claimant_character_id = any(actor_ids[1:2])
      and claim.claim_status = 'contested'
  ) <> 2 then
    raise exception 'Both conflicting claims must persist as contested without an order-list advantage.';
  end if;
  if (
    select count(*)
    from public.political_action_outcomes as outcome
    cross join lateral jsonb_array_elements(outcome.state_changes) as change(value)
    where outcome.turn_number = next_turn
      and outcome.actor_character_id = any(actor_ids[1:2])
      and change.value ->> 'type' = 'claim'
      and change.value -> 'previousState' = 'null'::jsonb
      and change.value #>> '{resultingState,claimStatus}' = 'contested'
  ) <> 2 then
    raise exception 'Conflicting claims must persist their exact created claim records.';
  end if;
  if not exists (
    select 1 from public.political_authority_positions as position
    where position.id = removal_position_id
      and position.position_status = 'active'
      and position.recognition_status = 'recognized'
  ) then
    raise exception 'A resisted unauthorized removal changed the office.';
  end if;
  if not exists (
    select 1 from public.political_action_outcomes as outcome
    where outcome.turn_number = next_turn
      and outcome.actor_character_id = actor_ids[3]
      and outcome.execution_status = 'resisted'
      and jsonb_array_length(outcome.state_changes) = 0
  ) then
    raise exception 'The resisted removal outcome does not reflect its uncommitted effect.';
  end if;
  if not exists (
    select 1 from public.political_delegations as delegation
    where delegation.id = delegation_id and delegation.status = 'revoked'
  ) then
    raise exception 'The adjudicated delegation revocation was not committed.';
  end if;
  if not exists (
    select 1
    from public.political_action_outcomes as outcome
    cross join lateral jsonb_array_elements(outcome.state_changes) as change(value)
    where outcome.turn_number = next_turn
      and outcome.actor_character_id = actor_ids[4]
      and change.value ->> 'type' = 'delegation'
      and (change.value ->> 'id')::bigint = delegation_id
      and change.value #>> '{previousState,status}' = 'active'
      and change.value #>> '{resultingState,status}' = 'revoked'
  ) then
    raise exception 'The delegation outcome omitted its precise previous and resulting states.';
  end if;
  if not exists (
    select 1 from public.political_action_outcomes as outcome
    where outcome.turn_number = next_turn
      and outcome.actor_character_id = actor_ids[5]
      and outcome.execution_status = 'attempted'
  ) then
    raise exception 'A seizure without battle resolution must remain an attempt.';
  end if;
  select array_agg(relation.house_id order by relation.house_id)
  into controls_after
  from public.house_location_relations as relation
  where relation.location_id = target_location_id
    and relation.relation_type = 'current_control';
  if controls_after is distinct from controls_before then
    raise exception 'A political seizure transferred territory without combat resolution.';
  end if;
  if not exists (
    select 1 from public.political_action_outcomes as outcome
    where outcome.turn_number = next_turn
      and outcome.actor_character_id = actor_ids[6]
      and outcome.execution_status = 'partially_executed'
      and exists (
        select 1 from jsonb_array_elements(outcome.state_changes) as change(value)
        where change.value ->> 'type' = 'position'
          and (change.value ->> 'id')::bigint = challenged_position_id
      )
  ) then
    raise exception 'The partial challenge was not recorded with its committed office change.';
  end if;
end
$$;

rollback;
