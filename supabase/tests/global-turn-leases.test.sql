begin;

do $$
declare
  world public.world_state%rowtype;
  first_claim jsonb;
  second_claim jsonb;
  previous_token uuid;
  active_token uuid;
  turn_to_resolve integer;
  npc_actor integer;
  saved_count integer;
  npc_action jsonb;
begin
  if exists (
    select required.column_name
    from (values
      ('turn_phase'),
      ('resolution_started_at'),
      ('resolution_lease_token'),
      ('resolution_lease_owner'),
      ('resolution_lease_expires_at'),
      ('resolution_checkpoint')
    ) as required(column_name)
    where not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'world_state'
        and column_name = required.column_name
    )
  ) then
    raise exception
      'The global turn lease schema is missing. Run the latest supabase/global-turn-cycle.sql, then rerun this test.';
  end if;

  select * into world
  from public.world_state
  where id = 1;
  if not found then
    raise exception 'A world_state row with id 1 is required.';
  end if;

  turn_to_resolve := world.turn_number + 1;
  previous_token := gen_random_uuid();
  update public.world_state
  set turn_phase = 'resolving',
      resolution_started_at = clock_timestamp() - interval '1 minute',
      resolution_lease_token = previous_token,
      resolution_lease_owner = 'lease-regression-previous',
      resolution_lease_expires_at = clock_timestamp() - interval '1 second'
  where id = 1;

  first_claim := public.claim_game_turn_resolution(
    'lease-regression-first', 60
  );
  if first_claim ->> 'claimed' is distinct from 'true' then
    raise exception 'The first worker did not claim the expired lease.';
  end if;
  active_token := (first_claim ->> 'leaseToken')::uuid;

  second_claim := public.claim_game_turn_resolution(
    'lease-regression-second', 60
  );
  if second_claim ->> 'claimed' is distinct from 'false' then
    raise exception 'A second worker claimed an unexpired lease.';
  end if;

  update public.world_state
  set resolution_lease_expires_at = clock_timestamp() - interval '1 second'
  where id = 1;
  second_claim := public.claim_game_turn_resolution(
    'lease-regression-second', 60
  );
  if second_claim ->> 'claimed' is distinct from 'true' then
    raise exception 'A worker could not reclaim an expired lease.';
  end if;
  if (second_claim ->> 'leaseToken') is null
    or (second_claim ->> 'leaseToken')::uuid = active_token then
    raise exception 'Reclaiming an expired lease did not rotate its token.';
  end if;

  select id into npc_actor
  from public.playable_characters
  order by id
  limit 1;
  if not found then
    raise exception 'At least one playable character is required.';
  end if;
  npc_action := jsonb_build_array(jsonb_build_object(
    'type', 'wait',
    'actorCharacterId', npc_actor,
    'reason', 'Retry-safe NPC order test.'
  ));
  insert into public.gameplay_npc_orders (
    world_state_id, turn_number, character_id, action_data, resolution_status
  )
  values (1, turn_to_resolve, npc_actor, null, 'pending')
  on conflict (world_state_id, turn_number, character_id)
  do update set action_data = null, resolution_status = 'pending';
  saved_count := public.save_npc_game_orders(
    turn_to_resolve,
    (second_claim ->> 'leaseToken')::uuid,
    'lease-regression-second',
    jsonb_build_array(jsonb_build_object(
      'actorCharacterId', npc_actor,
      'actionData', npc_action
    ))
  );
  if saved_count <> 1 then
    raise exception 'The initial NPC order was not saved.';
  end if;
  saved_count := public.save_npc_game_orders(
    turn_to_resolve,
    (second_claim ->> 'leaseToken')::uuid,
    'lease-regression-second',
    jsonb_build_array(jsonb_build_object(
      'actorCharacterId', npc_actor,
      'actionData', npc_action
    ))
  );
  if saved_count <> 0 then
    raise exception 'Retrying an NPC order created a duplicate write.';
  end if;

  begin
    perform public.save_npc_game_orders(
      turn_to_resolve, active_token, 'lease-regression-first', '[]'::jsonb
    );
    raise exception 'A stale worker saved NPC orders.';
  exception when others then
    if sqlerrm not like 'GAME_LEASE_LOST:%' then raise; end if;
  end;

  begin
    perform public.save_game_turn_checkpoint(
      turn_to_resolve, active_token, 'lease-regression-first', '{}'::jsonb
    );
    raise exception 'A stale worker saved a resolution checkpoint.';
  exception when others then
    if sqlerrm not like 'GAME_LEASE_LOST:%' then raise; end if;
  end;

  begin
    perform public.release_game_turn_resolution(
      turn_to_resolve, active_token, 'lease-regression-first'
    );
    raise exception 'A stale worker released a newer lease.';
  exception when others then
    if sqlerrm not like 'GAME_LEASE_LOST:%' then raise; end if;
  end;

  begin
    perform public.resolve_game_turn(
      turn_to_resolve,
      world.gameplay_revision,
      active_token,
      'lease-regression-first',
      '[]'::jsonb,
      'stale resolution',
      'other',
      'A stale worker must not commit this resolution.'
    );
    raise exception 'A stale worker committed a world turn.';
  exception when others then
    if sqlerrm not like 'GAME_LEASE_LOST:%' then raise; end if;
  end;

  if not exists (
    select 1
    from public.world_state
    where id = 1
      and resolution_lease_token = (second_claim ->> 'leaseToken')::uuid
      and resolution_lease_owner = 'lease-regression-second'
      and resolution_lease_expires_at > clock_timestamp()
  ) then
    raise exception 'A stale worker changed the current lease.';
  end if;

  perform public.renew_game_turn_resolution(
    turn_to_resolve,
    (second_claim ->> 'leaseToken')::uuid,
    'lease-regression-second',
    60
  );
  perform public.release_game_turn_resolution(
    turn_to_resolve,
    (second_claim ->> 'leaseToken')::uuid,
    'lease-regression-second'
  );
end
$$;

rollback;
