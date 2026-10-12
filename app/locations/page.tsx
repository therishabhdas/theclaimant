import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { SiteFooter, SiteHeader } from "../components/site-chrome";
import { createClient } from "../../lib/supabase/server";

export const metadata: Metadata = {
  title: "Playable Locations",
  description:
    "Explore the 30 playable locations of Westeros, their strategic importance, regions, and current house affiliations.",
};

type Location = {
  id: number;
  slug: string;
  name: string;
  region: string;
  location_type: string;
  description: string;
  starting_house: string | null;
  house: string | null;
  top_10_rank: number | null;
  is_top_10: boolean;
  is_playable: boolean;
};

const regionOrder = [
  "The North",
  "The Vale",
  "The Riverlands",
  "The Iron Islands",
  "The Westerlands",
  "The Reach",
  "The Stormlands",
  "The Crownlands",
  "Dorne",
];

function LocationCard({ location }: { location: Location }) {
  return (
    <article className={`directory-card location-card${location.is_top_10 ? " location-card-featured" : ""}`}>
      <div className="directory-card-meta">
        <span>{location.is_top_10 ? `PRIORITY ${String(location.top_10_rank).padStart(2, "0")}` : location.region.toUpperCase()}</span>
        <span>{location.location_type.replaceAll("_", " ")}</span>
      </div>
      <h3>{location.name}</h3>
      <p className="directory-description">{location.description}</p>
      <dl className="directory-facts">
        <div>
          <dt>Region</dt>
          <dd>{location.region}</dd>
        </div>
        <div>
          <dt>Current house</dt>
          <dd>{location.house ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Opening house</dt>
          <dd>{location.starting_house ?? "Not established"}</dd>
        </div>
        <div>
          <dt>Map status</dt>
          <dd>{location.is_playable ? "Playable" : "Not currently playable"}</dd>
        </div>
      </dl>
    </article>
  );
}

async function LocationDirectory() {
  const supabase = createClient(await cookies());
  const { data, error } = await supabase
    .from("playable_locations")
    .select(
      "id, slug, name, region, location_type, description, starting_house, house, top_10_rank, is_top_10, is_playable",
    );

  if (error) {
    console.error("Unable to load playable locations:", error.message);
    return (
      <section className="directory-content">
        <p className="directory-error" role="alert">
          The location records could not be loaded. Check the Supabase table and its read policy.
        </p>
      </section>
    );
  }

  const locations = ((data ?? []) as Location[]).sort((a, b) => {
    if (a.top_10_rank && b.top_10_rank) return a.top_10_rank - b.top_10_rank;
    if (a.top_10_rank) return -1;
    if (b.top_10_rank) return 1;
    const regionDifference =
      regionOrder.indexOf(a.region) - regionOrder.indexOf(b.region);
    return regionDifference || a.id - b.id;
  });
  const featured = locations.filter((location) => location.is_top_10);
  const remaining = locations.filter((location) => !location.is_top_10);
  const remainingRegions = regionOrder
    .map((region) => ({
      name: region,
      locations: remaining.filter((location) => location.region === region),
    }))
    .filter((region) => region.locations.length > 0);

  return (
    <div className="directory-content">
      {locations.length === 0 ? (
        <p className="directory-empty">No playable locations have been added yet.</p>
      ) : (
        <>
          {featured.length > 0 && (
          <section className="directory-block" aria-labelledby="priority-locations">
            <div className="directory-section-heading">
              <p className="eyebrow"><span />THE TEN STRATEGIC CENTRES</p>
              <h2 id="priority-locations">Where the balance<br /><em>of power turns.</em></h2>
            </div>
            <div className="directory-grid">
              {featured.map((location) => (
                <LocationCard key={location.id} location={location} />
              ))}
            </div>
          </section>
          )}

          {remainingRegions.length > 0 && (
            <section className="directory-block directory-secondary" aria-labelledby="other-locations">
              <div className="directory-section-heading">
                <p className="eyebrow"><span />THE WIDER REALM</p>
                <h2 id="other-locations">Thirty destinations.<br /><em>Many kinds of leverage.</em></h2>
              </div>
              {remainingRegions.map((region) => (
                <section className="directory-region" key={region.name} aria-labelledby={`region-${region.name}`}>
                  <div className="directory-region-heading">
                    <h3 id={`region-${region.name.toLowerCase().replaceAll(" ", "-")}`}>{region.name}</h3>
                    <span>{region.locations.length} {region.locations.length === 1 ? "location" : "locations"}</span>
                  </div>
                  <div className="directory-grid">
                    {region.locations.map((location) => (
                      <LocationCard key={location.id} location={location} />
                    ))}
                  </div>
                </section>
              ))}
            </section>
          )}
        </>
      )}
      <p className="directory-count">Showing {locations.length} playable {locations.length === 1 ? "location" : "locations"}.</p>
    </div>
  );
}

export default function LocationsPage() {
  return (
    <main>
      <SiteHeader current="locations" />
      <section className="directory-hero">
        <p className="eyebrow"><span />THE MAP IS NOT A PROMISE OF OBEDIENCE</p>
        <h1>Thirty places.<br /><em>Countless pressures.</em></h1>
        <p>
          Ports, castles, crossings, and seats of power shape what characters
          can command—and how far their influence can reach. Control and
          allegiance can change as the story unfolds.
        </p>
        <div className="directory-hero-stat">
          <strong>30</strong>
          <span>PLAYABLE LOCATIONS<br />ACROSS NINE REGIONS</span>
        </div>
      </section>
      <Suspense
        fallback={
          <section className="directory-content" aria-busy="true">
            <p className="directory-empty">Unfolding the map…</p>
          </section>
        }
      >
        <LocationDirectory />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
