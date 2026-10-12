import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { SiteFooter, SiteHeader } from "../components/site-chrome";
import { createClient } from "../../lib/supabase/server";

export const metadata: Metadata = {
  title: "Playable Characters",
  description:
    "Meet the playable characters of The Claimant: their opening roles, relationships, current circumstances, claims, and gameplay themes.",
};

type Character = {
  id: number;
  slug: string;
  display_name: string;
  aliases: string[];
  playable_group: string;
  region: string | null;
  starting_house: string | null;
  birth_house: string | null;
  opening_title: string | null;
  opening_relationships: string;
  gameplay_focus: string[];
  opening_status: string;
  current_status: string;
  opening_life_status: string;
  current_life_status: string;
  opening_presence: string;
  is_playable: boolean;
  opening_location_id: number | null;
  current_location_id: number | null;
  opening_claim_target: string | null;
  current_claim_target: string | null;
  opening_claim_basis: string | null;
  current_claim_basis: string | null;
  opening_claim_status: string;
  current_claim_status: string;
  opening_claim_summary: string | null;
  current_claim_summary: string | null;
  political_power: number | null;
  military_power: number | null;
  economic_power: number | null;
  naval_power: number | null;
  intelligence_power: number | null;
  diplomatic_power: number | null;
  legitimacy_power: number | null;
  popular_support: number | null;
};

type CharacterLocation = { id: number; name: string };

const groupOrder = [
  "House Stark and its circle",
  "House Lannister and the royal court",
  "House Baratheon and its allies",
  "House Arryn and the Vale",
  "House Tully and the Riverlands",
  "House Greyjoy and the Iron Islands",
  "House Tyrell and the Reach",
  "Dorne and House Martell",
  "Other important Westerosi characters",
];

const powerRatings: Array<{ key: keyof Character; label: string }> = [
  { key: "political_power", label: "Political" },
  { key: "military_power", label: "Military" },
  { key: "economic_power", label: "Economic" },
  { key: "naval_power", label: "Naval" },
  { key: "intelligence_power", label: "Intelligence" },
  { key: "diplomatic_power", label: "Diplomatic" },
  { key: "legitimacy_power", label: "Legitimacy" },
  { key: "popular_support", label: "Popular support" },
];

function formatStatus(value: string) {
  return value.replaceAll("_", " ");
}

function CharacterCard({
  character,
  openingLocationName,
  locationName,
}: {
  character: Character;
  openingLocationName: string | null;
  locationName: string | null;
}) {
  const ratings = powerRatings
    .map(({ key, label }) => ({
      label,
      value: character[key],
    }))
    .filter(
      (rating): rating is { label: string; value: number } =>
        typeof rating.value === "number",
    );

  return (
    <article className="directory-card character-card">
      <div className="directory-card-meta">
        <span>CHARACTER {String(character.id).padStart(2, "0")}</span>
        <span>{formatStatus(character.opening_presence)}</span>
      </div>
      <h3>{character.display_name}</h3>
      {character.aliases.length > 0 && (
        <p className="character-aliases">Also known as {character.aliases.join(" · ")}</p>
      )}
      <p className="character-title">{character.opening_title ?? "Role not recorded"}</p>
      <p className="directory-description">{character.opening_status}</p>

      <dl className="directory-facts character-facts">
        <div>
          <dt>Opening claim status</dt>
          <dd>{formatStatus(character.opening_claim_status)}</dd>
        </div>
        <div>
          <dt>Opening claim target</dt>
          <dd>{character.opening_claim_target ?? "No claim recorded"}</dd>
        </div>
        <div>
          <dt>Current status</dt>
          <dd>{character.current_status}</dd>
        </div>
        <div>
          <dt>Opening location</dt>
          <dd>
            {character.opening_location_id
              ? openingLocationName ?? "Not recorded"
              : "Not established"}
          </dd>
        </div>
        <div>
          <dt>Current location</dt>
          <dd>{locationName ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Region</dt>
          <dd>{character.region ?? "Not specified"}</dd>
        </div>
        <div>
          <dt>Current life status</dt>
          <dd>{formatStatus(character.current_life_status)}</dd>
        </div>
        <div>
          <dt>Opening house</dt>
          <dd>{character.starting_house ?? "Not established"}</dd>
        </div>
        <div>
          <dt>Birth house</dt>
          <dd>{character.birth_house ?? "Not established"}</dd>
        </div>
        <div>
          <dt>Claim status</dt>
          <dd>{formatStatus(character.current_claim_status)}</dd>
        </div>
        <div>
          <dt>Claim target</dt>
          <dd>{character.current_claim_target ?? "No claim recorded"}</dd>
        </div>
      </dl>

      {character.current_claim_summary && (
        <div className="character-claim">
          <h4>Current claim and standing</h4>
          <p>{character.current_claim_summary}</p>
          {character.current_claim_basis && <p>{character.current_claim_basis}</p>}
        </div>
      )}

      {character.opening_claim_summary && (
        <div className="character-details">
          <h4>Opening claim and standing</h4>
          <p>{character.opening_claim_summary}</p>
          {character.opening_claim_basis && <p>{character.opening_claim_basis}</p>}
        </div>
      )}

      <div className="character-details">
        <h4>Relationships at the opening</h4>
        <p>{character.opening_relationships || "No opening relationships recorded."}</p>
      </div>

      <div className="character-focus">
        <h4>Gameplay themes</h4>
        <ul>
          {character.gameplay_focus.map((focus) => <li key={focus}>{focus}</li>)}
        </ul>
      </div>

      {ratings.length > 0 && (
        <dl className="character-ratings">
          {ratings.map(({ label, value }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd><span style={{ width: `${value}%` }} /><strong>{value}</strong></dd>
            </div>
          ))}
        </dl>
      )}
      {!character.is_playable && <p className="character-not-playable">Not currently playable</p>}
    </article>
  );
}

async function CharacterDirectory() {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("playable_characters")
    .select(
      "id, slug, display_name, aliases, playable_group, region, starting_house, birth_house, opening_title, opening_relationships, gameplay_focus, opening_status, current_status, opening_life_status, current_life_status, opening_presence, is_playable, opening_location_id, current_location_id, opening_claim_target, current_claim_target, opening_claim_basis, current_claim_basis, opening_claim_status, current_claim_status, opening_claim_summary, current_claim_summary, political_power, military_power, economic_power, naval_power, intelligence_power, diplomatic_power, legitimacy_power, popular_support",
    )
    .order("id", { ascending: true });

  if (error) {
    console.error("Unable to load playable characters:", error.message);
    return (
      <section className="directory-content">
        <p className="directory-error" role="alert">
          The character records could not be loaded. Check the Supabase table and its read policy.
        </p>
      </section>
    );
  }

  const characters = (data ?? []) as Character[];
  const locationIds = [...new Set(
    characters
      .flatMap((character) => [
        character.opening_location_id,
        character.current_location_id,
      ])
      .filter((id): id is number => id !== null),
  )];
  let locationNames = new Map<number, string>();

  if (locationIds.length > 0) {
    const { data: locations, error: locationsError } = await supabase
      .from("playable_locations")
      .select("id, name")
      .in("id", locationIds);

    if (locationsError) {
      console.error("Unable to load character location names:", locationsError.message);
      return (
        <section className="directory-content">
          <p className="directory-error" role="alert">
            Character records loaded, but current location names could not be retrieved.
          </p>
        </section>
      );
    }

    locationNames = new Map(
      ((locations ?? []) as CharacterLocation[]).map((location) => [location.id, location.name]),
    );
  }

  const knownGroups = groupOrder
    .map((name) => ({
      name,
      characters: characters.filter((character) => character.playable_group === name),
    }))
    .filter((group) => group.characters.length > 0);
  const additionalGroups = [...new Set(
    characters
      .map((character) => character.playable_group)
      .filter((name) => !groupOrder.includes(name)),
  )]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      name,
      characters: characters.filter((character) => character.playable_group === name),
    }));
  const groups = [...knownGroups, ...additionalGroups];
  const playableCount = characters.filter((character) => character.is_playable).length;

  return (
    <div className="directory-content">
      {characters.length === 0 ? (
        <p className="directory-empty">No playable characters have been added yet.</p>
      ) : (
        groups.map((group, groupIndex) => (
          <section
            className="directory-block character-group"
            key={group.name}
            aria-labelledby={`character-group-${groupIndex}`}
          >
            <div className="directory-section-heading">
              <p className="eyebrow"><span />CHARACTERS {String(groupIndex + 1).padStart(2, "0")}</p>
              <h2 id={`character-group-${groupIndex}`}>{group.name}</h2>
            </div>
            <div className="character-grid">
              {group.characters.map((character) => (
                <CharacterCard
                  key={character.id}
                  character={character}
                  openingLocationName={
                    character.opening_location_id
                      ? locationNames.get(character.opening_location_id) ?? null
                      : null
                  }
                  locationName={
                    character.current_location_id
                      ? locationNames.get(character.current_location_id) ?? null
                      : null
                  }
                />
              ))}
            </div>
          </section>
        ))
      )}
      <p className="directory-count">
        Showing {characters.length} character {characters.length === 1 ? "record" : "records"};{" "}
        {playableCount} currently marked playable.{" "}
        Individual knowledge and private facts are intentionally not displayed here.
      </p>
    </div>
  );
}

export default function CharactersPage() {
  return (
    <main>
      <SiteHeader current="characters" />
      <section className="directory-hero">
        <p className="eyebrow"><span />FORTY LIVES, NO SINGLE VERSION OF THE TRUTH</p>
        <h1>Power has<br /><em>a human face.</em></h1>
        <p>
          Each character begins with relationships, obligations, and a
          particular view of the realm. Their future status, location, and
          claims belong to the campaign—not to a predetermined ending.
        </p>
        <div className="directory-hero-stat">
          <strong>40</strong>
          <span>ROSTERED CHARACTERS<br />ACROSS THE POLITICAL MAP</span>
        </div>
      </section>
      <Suspense
        fallback={
          <section className="directory-content" aria-busy="true">
            <p className="directory-empty">Calling the court and the great houses…</p>
          </section>
        }
      >
        <CharacterDirectory />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
