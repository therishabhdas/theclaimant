-- Run this once in the Supabase SQL Editor.
-- Event records are available only to trusted server-side code using the
-- Supabase service-role key. Never expose that key to browser code.
create table if not exists public.game_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  event_type text not null check (
    event_type in ('political', 'military', 'personal', 'movement', 'information', 'other')
  ),
  title text not null check (length(trim(title)) > 0),
  canonical_summary text not null check (length(trim(canonical_summary)) > 0),
  public_summary text,
  character_knowledge jsonb not null default '{}'::jsonb
    check (jsonb_typeof(character_knowledge) = 'object'),
  affected_character_ids integer[] not null default '{}',
  location text,
  state_changes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(state_changes) = 'array')
);

create index if not exists game_events_timeline_idx
  on public.game_events (occurred_at, id);

alter table public.game_events enable row level security;

revoke all on table public.game_events from anon, authenticated;
grant select, insert on table public.game_events to service_role;
grant usage, select on sequence public.game_events_id_seq to service_role;
