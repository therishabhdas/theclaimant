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
public/                   Static assets
theclaimant_starting_reference.txt
                          World-state reference for the opening setting
```

The primary content for each route lives in its `page.tsx` file. Shared
navigation and footer components are in `app/components/site-chrome.tsx`, and
the visual system is defined in `app/globals.css`.

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
