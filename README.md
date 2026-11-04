# The Claimant

The Claimant is an editorial landing site for a political role-playing game set
in Westeros. It introduces the realm at a deliberate moment of uncertainty:
immediately after King Robert I Baratheon's death, before Eddard Stark publicly
challenges the succession and before a war of succession has begun.

The site presents the opening political situation, the nine regions of
Westeros, and the principles that shape the game's world: power depends on
people and material resources, information takes time to travel, and no
character knows more than they could plausibly have learned.

> The website remains an introduction to the game and its setting. A
> server-side gameplay turn endpoint is available; an interactive gameplay
> interface is not yet included.

## Pages

- **Home (`/`)** — Introduces the unsettled succession, key political
  pressures, and the nine regions of Westeros.
- **About (`/about`)** — Explains the opening state, centers of power, world
  principles, and the distinction between public and private knowledge.
- **System check (`/inspect`)** — An intentionally unlinked, public read-only
  diagnostic page. It checks the registered application tables and their
  expected columns, reports estimated row counts except for private tables,
  and verifies that the configured Groq model is available without running
  an inference request. Never add record contents or credential values to its
  output.

The home and About pages share navigation and a footer and adapt to mobile and
desktop screens.

## Getting started

### Requirements

- Node.js compatible with the installed Next.js version
- npm

Install the project dependencies:

```bash
npm install
```

### Connect Groq

The Groq SDK is installed and the server-only client is available in
[`lib/ai/groq.ts`](./lib/ai/groq.ts). To configure it locally:

1. Create an API key in the [Groq Console](https://console.groq.com/keys).
2. Copy `.env.example` to `.env.local` and replace
   `your_groq_api_key` with your Groq API key. Keep `.env.local`
   private; it is ignored by Git.
3. Restart the development server after adding the key.

`createGroqClient()` creates an SDK client using that key, and `GROQ_MODEL` is
set to `openai/gpt-oss-120b`. Creating the client does not send a request to
Groq; an authenticated gameplay turn sends a server-side inference request.
The API key must only be used in server-side code, never in a Client Component
or a `NEXT_PUBLIC_` variable.

### World state and event log

The starting reference is the opening canon; the database holds the current
world state and the event log records what changes. In the Supabase SQL Editor,
run [`supabase/event-log.sql`](./supabase/event-log.sql) if the `game_events`
table has not already been created, then run
[`supabase/world-state-schema.sql`](./supabase/world-state-schema.sql). The
second script is an additive, rerunnable migration. It expects the existing
`playable_characters`, `playable_locations`, and `user_character_assignments`
tables used by the site.

Then run [`supabase/opening-state-seed.sql`](./supabase/opening-state-seed.sql)
to populate the opening snapshot from the starting reference. It seeds the nine
regions, the Great Houses and named major houses, opening regional summaries,
known historical wars, explicitly established betrothals and hostage status,
the summer 298 AC clock (without inventing an exact day), opening treasury
balances, regional military potential estimates, the opening event, and the
royal-parentage secret with only the specified characters marked as knowing or
suspecting it. Military estimates are regional potential, not troops already
mustered; regional totals are not duplicated into individual house army counts.
The Crown's zero liquid treasury is accompanied by a qualitative debt note;
world-level financial records separately represent the reported debt lower
bound, approximate Lannister creditor amount, and creditors whose allocations
are unknown. The house balances are explicitly marked as game-balance estimates;
they are not canon treasury figures. Force figures are approximate planning
estimates, not verified canonical muster rolls. Fleet inventories, the
Kingsguard, the low-confidence Dragonstone garrison, and muster timing rules are
recorded separately; overlapping fleet estimates and the Iron Fleet subset are
labelled so they are not added twice. Muster timing and liquid balances are
gameplay assumptions rather than lore facts.
Existing character/location catalog rows are linked when present. The scripts
do not create playable character or location catalog rows, player assignments,
player resource totals, annual revenue values, house-by-house troop
allocations, or private character ambitions.

The migration relates existing roster characters and locations to houses and
regions, and adds connected records for house lands, lieges, claims, character
traits, ambitions, loyalties and secrets, wars and participants, diplomacy,
and event participants and state changes. It also creates
`regional_military_estimates` to distinguish estimated levy potential from
standing forces such as the City Watch; `military_muster_rules` records
gameplay timing assumptions; and `world_financial_records` stores Crown-level
debt and treasury information without folding it into a house treasury.
Regional force rows carry confidence labels and distinguish source estimates
from explicit gameplay assumptions. The
existing character assignment
remains the player's current-character link; it gains linked current location,
resources, and personality fields. Existing character claim and location
control data is linked where it can be matched. Unspecified facts such as
exact calendar day, per-house levy allocations, the exact opening royal fleet
distribution, most exact garrison counts, and unrecorded character knowledge
remain unknown instead of being invented.

### Travel network and journeys

After running `event-log.sql`, `world-state-schema.sql`, and
`opening-state-seed.sql` in that order, run each travel script below
individually in the Supabase SQL Editor, in numerical order. Do not paste the
scripts together; each is sized for the SQL Editor and can be rerun safely if
an individual step needs retrying.

1. [`travel-system-00-schema.sql`](./supabase/travel-system-00-schema.sql)
2. [`travel-system-01-seed.sql`](./supabase/travel-system-01-seed.sql)
3. [`travel-system-02-seed.sql`](./supabase/travel-system-02-seed.sql)
4. [`travel-system-03-seed.sql`](./supabase/travel-system-03-seed.sql)
5. [`travel-system-04-seed.sql`](./supabase/travel-system-04-seed.sql)
6. [`travel-system-05-seed.sql`](./supabase/travel-system-05-seed.sql)
7. [`travel-system-06-seed.sql`](./supabase/travel-system-06-seed.sql)
8. [`travel-system-07-seed.sql`](./supabase/travel-system-07-seed.sql)

After the travel scripts, run
[`supabase/gameplay-engine.sql`](./supabase/gameplay-engine.sql). It adds
the deterministic action-commit procedure, travel arrival and muster
progression, and private gameplay-turn and muster-order records. Then run
[`supabase/global-turn-cycle.sql`](./supabase/global-turn-cycle.sql). It adds
the shared planning and resolution phases, one order per assigned player for
each global turn, AI order storage for unassigned characters, and the atomic
weekly resolution procedure. Run both after the world-state, opening-state,
and travel migrations.

The scripts create the workbook-backed route graph, linked route alternatives
and legs, waypoint and source records, travel assumptions, and campaign
journey tables, and archive the workbook rows. They expect the 30 workbook
location names to match the existing `playable_locations` catalogue.

Distances are approximate map-calibrated ranges, not official canon
measurements. Pairwise route choices minimize edge midpoint distance; they do
not automatically optimize travel time, risk, cost, capacity, permission, or
current availability. Route availability starts as unknown. In particular,
the Kingsroad option from King's Landing to Winterfell does not require the
Twins; preserve alternative routes rather than treating one itinerary as
mandatory.

Copy `.env.example` to `.env.local` if needed and set
`SUPABASE_SERVICE_ROLE_KEY` from your Supabase project's API settings. This key
grants privileged database access: keep it secret and use it only in
server-side code. [`lib/game/events.ts`](./lib/game/events.ts) provides
`appendGameEvent()`, `getGameEvents()`, `loadWorldContext()`, and
`loadGroqGamePrompt(userId, playerRequest)`. Player prompts contain public
context, the assigned character's own knowledge and history, and relevant
travel routes and journey status. AI-controlled characters receive the same
character-scoped context for their own decisions. Call these helpers only from
trusted server-side code. New events automatically create foreign-keyed
participant, location, knowledge, and structured state-change records;
state-change targets must identify a character, house, location, war, or
diplomacy record.

`loadWorldContext()` combines the starting reference, chronological history,
and connected current database records. It returns canonical and secret
information for trusted server-side use only; do not expose it directly to
players. Passing a user ID includes that player's assignment, resources,
location, and personality, but does not filter the wider canonical context.
The account page displays the signed-in character's profile, recorded traits,
ambitions, loyalties, claims, and only that character's known or suspected
secrets. Its realm overview uses public events and diplomacy records marked
`is_public`; keep private political information out of those public summaries.
If the world-state migration was already run, rerun its latest version to add
the public visibility fields used by the account overview.

### Shared gameplay turns

The authenticated, same-origin `POST /api/game/turn` endpoint accepts:

```json
{
  "requestId": "a-unique-uuid",
  "playerRequest": "The player's in-character request"
}
```

Each global turn has a 48-hour planning window. Every assigned player may
submit exactly one primary order; an explicit wait counts as that order. Orders
are stored without advancing the clock. When all players submit, or after the
deadline, the resolver generates orders for unassigned characters and gives
all player and AI orders together to the master adjudicator. Missing players
become wait/pass orders. The engine independently validates simultaneous
conflicts and commits accepted orders, travel/muster progress, and one
seven-day clock advance atomically. It then opens the next planning window.
The participant list is snapshotted when a planning window opens; newly
assigned characters join the following window.

The authenticated `GET /api/game/turn` endpoint is read-only. It reports the
current phase, deadline, and only the signed-in player's order status and
previous resolved status; it never runs inference or changes the world. The
`POST` response likewise contains no other player's result.

Global resolution runs through a separate, continuously running Node worker.
It polls `POST /api/internal/game-turn/resolve`, which requires the shared
`GAME_WORKER_SECRET`. The database stores each worker lease, its expiry, NPC
orders, and the master-resolution checkpoint, so another worker can reclaim
an expired lease and resume after a process restart. The RPCs fence every
write and commit with the current lease token; stale workers cannot overwrite
newer progress. This worker is independent of player traffic and does not rely
on Vercel Cron or an in-memory queue.

To run it:

1. Generate a random secret of at least 32 characters, for example with
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
2. Set `GAME_WORKER_SECRET` to the same secret in the Next.js server environment
   and in the worker process environment. Never expose it as a `NEXT_PUBLIC_`
   variable or commit it.
3. Set `GAME_TURN_WORKER_ENDPOINT` in the worker environment to the reachable
   app URL ending in `/api/internal/game-turn/resolve`. Use HTTPS except for a
   local development endpoint. `GAME_TURN_WORKER_POLL_INTERVAL_MS` defaults to
   30000 and may be increased if less frequent deadline checks are acceptable.
4. Keep the worker process running under the host's process manager or
   container orchestration with automatic restart enabled. Start it with
   `npm run worker:game-turns`. Configure its logs and health monitoring using
   the host's normal process-management tools.

If the worker is stopped, world turns remain persisted and will be resolved
after it restarts; deadline resolution is not guaranteed while no worker is
running. The app server needs its normal Supabase and Groq environment
variables. The worker needs only its endpoint, secret, and optional polling
interval.

The engine supports character travel on routes with available travel
estimates, regional levy muster orders, private diplomacy proposals and
responses, war declarations and joining an active war, and waiting. Travel and
muster progress advance once per global turn, not once per player request.
Exact calendar dates remain unknown.

Regional muster capacity is a gameplay use of the seeded regional potential
estimates; it does not allocate or infer an opening army size for an individual
house. Wars do not yet resolve battles, casualties, supply, or troop movement.
Unknown route availability remains unknown, and a route action uses its
recorded party travel estimate rather than inventing a route or speed. Known
closed, restricted, blockaded, destroyed, and permission-gated legs are rejected.

The endpoint requires one assigned character, the Groq and Supabase server
environment variables above, and all listed SQL migrations including
`gameplay-engine.sql` and `global-turn-cycle.sql`. Each order needs a unique
UUID; retries with the same ID return the original status. Concurrent
submissions are serialized against one planning snapshot and stale world
revisions are rejected. Events and diplomacy proposals remain private by
default.

Run the focused deterministic engine tests with `npm run test:game`.
After applying the gameplay migrations, the rollback-only lease fencing
regression in [`supabase/tests/global-turn-leases.test.sql`](./supabase/tests/global-turn-leases.test.sql)
can be run in the Supabase SQL editor. It checks active-lease exclusion,
expired-lease reclamation, token rotation, idempotent NPC-order retries,
renewal, and stale-worker write, release, and commit rejection; it rolls back
all setup changes.

Start the local development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in a browser. Changes to
files in `app/` are reflected during development.

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve the production build locally. Run `npm run build` first. |
| `npm run lint` | Run ESLint across the project. |
| `npm run test:game` | Run deterministic engine tests (requires Node.js TypeScript stripping support). |

## Project structure

```text
app/
  about/
    page.tsx             About page
  components/
    site-chrome.tsx      Shared site header and footer
  globals.css            Global styles and responsive layouts
  layout.tsx             Root layout and site-wide metadata
  page.tsx               Home page
lib/
  ai/                    Groq client and prompt formatting
  game/                  Gameplay engine, turn service, and campaign helpers
  supabase/              Supabase browser, server, and middleware clients
supabase/                SQL schemas, seeds, and the travel-system migration
public/                   Static assets
theclaimant_starting_reference.txt
                          World-state reference for the opening setting
```

The primary content for each route lives in its `page.tsx` file. Shared
navigation and footer components are in `app/components/site-chrome.tsx`, and
the visual system is defined in `app/globals.css`. Runtime code is grouped in
`lib/` by responsibility; database SQL stays in the root `supabase/` folder
instead of being mixed into runtime source code.

## Technology

- [Next.js](https://nextjs.org/) App Router
- [React](https://react.dev/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) v4 tooling, alongside the site's
  custom CSS

## Content and continuity

The site's setting follows the supplied starting-state reference. The opening
is a freeze-frame after Robert's death: the court treats Joffrey as heir,
Eddard Stark is Hand, Stannis is at Dragonstone, and the legitimacy dispute
has not yet been publicly resolved.

Later events are not presented as established history. Private intentions,
alliances, and character knowledge should remain uncertain unless the
reference establishes otherwise or events in the game reveal them. The
reference file is the source for setting details and continuity.

## Deployment

Build the site with `npm run build`, then run it with `npm run start`. The
project can also be deployed to a Next.js-compatible hosting provider. See the
[Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying)
for available deployment options.
