# The Claimant

The Claimant is an editorial landing site for a political role-playing game set
in Westeros. It introduces the realm at a deliberate moment of uncertainty:
immediately after King Robert I Baratheon's death, before Eddard Stark publicly
challenges the succession and before a war of succession has begun.

The site presents the opening political situation, the nine regions of
Westeros, and the principles that shape the game's world: power depends on
people and material resources, information takes time to travel, and no
character knows more than they could plausibly have learned.

> The website is an introduction to the game and its setting. It does not
> currently implement interactive gameplay.

## Pages

- **Home (`/`)** — Introduces the unsettled succession, key political
  pressures, and the nine regions of Westeros.
- **About (`/about`)** — Explains the opening state, centers of power, world
  principles, and the distinction between public and private knowledge.

Both pages share the same navigation and footer and are designed to adapt to
mobile and desktop screens.

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
Groq; no model calls are made by the site yet. The API key must only be used in
server-side code, never in a Client Component or a `NEXT_PUBLIC_` variable.

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
the opening event, and the royal-parentage secret with only the specified
characters marked as knowing or suspecting it. Existing character/location
catalog rows are linked when present. It does not fabricate playable character
or location catalog rows, a calendar date, season, resource totals, army sizes,
or private character ambitions.

The migration relates existing roster characters and locations to houses and
regions, and adds connected records for house lands, lieges, claims, character
traits, ambitions, loyalties and secrets, wars and participants, diplomacy,
and event participants and state changes. The existing character assignment
remains the player's current-character link; it gains linked current location,
resources, and personality fields. Existing character claim and location
control data is linked where it can be matched. Unspecified facts such as
treasury, army size, season, loyalties, or secret knowledge are left unknown
instead of being invented.

Copy `.env.example` to `.env.local` if needed and set
`SUPABASE_SERVICE_ROLE_KEY` from your Supabase project's API settings. This key
grants privileged database access: keep it secret and use it only in
server-side code. [`lib/game/events.ts`](./lib/game/events.ts) provides
`appendGameEvent()`, `getGameEvents()`, `loadWorldContext()`, and
`loadGroqGamePrompt(userId, playerRequest)`. The prompt helper reads the
starting reference, event history, and connected
Supabase state, then returns the system and user prompt messages using
[`lib/ai/prompt-template.ts`](./lib/ai/prompt-template.ts). It includes the
authenticated player's assigned character and marks roster characters with no
user assignment as AI-controlled. Call it only from trusted server-side code
and pass the authenticated user's ID. This prepares prompt content only; it
does not create a Groq client or send a model request. New events automatically
create foreign-keyed participant, location, knowledge, and structured
state-change records; state-change targets must identify a character, house,
location, war, or diplomacy record.

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
the public visibility fields used by the account overview. No page or gameplay
action writes events or calls Groq yet.

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
  game/                  Campaign state and character helpers
  supabase/              Supabase browser, server, and middleware clients
supabase/                SQL schema, event-log, and opening-state scripts
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
