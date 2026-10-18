import type { Metadata } from "next";
import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "../auth/actions";
import { SiteFooter, SiteHeader } from "../components/site-chrome";
import CharacterDraw from "./character-draw";
import {
  getAssignedCharacter,
  type AssignedCharacter,
} from "../../lib/game/character-assignment";
import {
  getCharacterAccountDetails,
  getRealmOverview,
  type CharacterAccountDetails,
  type RealmOverview,
} from "../../lib/game/account-world";
import { createClient } from "../../lib/supabase/server";

export const metadata: Metadata = {
  title: "Your account",
  description: "Draw and keep your character in The Claimant.",
};

function formatMilitaryEstimate(estimate: RealmOverview["regions"][number]["militaryEstimates"][number]) {
  if (estimate.minimumStrength === null || estimate.maximumStrength === null) {
    return "Strength unknown";
  }

  const range = estimate.minimumStrength === estimate.maximumStrength
    ? estimate.minimumStrength.toLocaleString()
    : `${estimate.minimumStrength.toLocaleString()}–${estimate.maximumStrength.toLocaleString()}`;
  return `${range} ${estimate.strengthUnit}`;
}

function formatTreasury(amount: number | null) {
  return amount === null ? "not recorded" : `${amount.toLocaleString()} gold dragons`;
}

async function AccountDetails() {
  const supabase = createClient(await cookies());
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError && userError.name !== "AuthSessionMissingError") {
    throw new Error(`Unable to verify the current account: ${userError.message}`);
  }

  if (!user) {
    redirect("/auth?next=%2Faccount");
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from("user_character_assignments")
    .select("character_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let assignedCharacter: AssignedCharacter | null = null;
  let characterDetails: CharacterAccountDetails | null = null;
  let characterDetailsError: string | null = null;
  let assignmentErrorMessage: string | null = null;
  let assignmentSetupError: string | null = null;

  if (assignmentError) {
    console.error("Unable to load the user's character assignment:", assignmentError.message);
    assignmentSetupError = "The character assignment database setup is not available.";
  } else if (assignment) {
    const result = await getAssignedCharacter(supabase, assignment.character_id);
    assignedCharacter = result.character;
    assignmentErrorMessage = result.error;

    if (assignedCharacter) {
      try {
        characterDetails = await getCharacterAccountDetails(
          user.id,
          assignedCharacter.id,
        );
      } catch (cause) {
        console.error("Unable to load the character's account details:", cause);
        characterDetailsError =
          "Some character details could not be loaded. Check that the world-state database setup is complete.";
      }
    }
  }

  let realmOverview: RealmOverview | null = null;
  let realmOverviewError: string | null = null;
  try {
    realmOverview = await getRealmOverview();
  } catch (cause) {
    console.error("Unable to load the realm overview:", cause);
    realmOverviewError =
      "The current realm overview could not be loaded. Check that the world-state database setup is complete.";
  }

  return (
    <>
      <section className="account-intro">
        <p className="eyebrow"><span />YOUR PLACE IN THE REALM</p>
        <h1>Your account.</h1>
        <p>Signed in as <strong>{user.email}</strong></p>
      </section>
      <CharacterDraw
        key={user.id}
        initialCharacter={assignedCharacter}
        initialDetails={characterDetails}
        detailsError={characterDetailsError}
        setupError={assignmentSetupError}
        initialError={assignmentErrorMessage}
      />
      <RealmOverviewSection overview={realmOverview} error={realmOverviewError} />
      <section className="account-actions">
        <form action={signOut}>
          <button className="button-outline" type="submit">
            Sign out <span aria-hidden="true">↗</span>
          </button>
        </form>
      </section>
    </>
  );
}

function RealmOverviewSection({
  overview,
  error,
}: {
  overview: RealmOverview | null;
  error: string | null;
}) {
  return (
    <section className="account-realm" aria-labelledby="account-realm-heading">
      <header className="account-realm-heading">
        <p className="eyebrow"><span />THE REALM IN MOTION</p>
        <h2 id="account-realm-heading">Across Westeros.</h2>
        {overview && (
          <p>
            {overview.dateDescription}
            {overview.season ? ` · ${overview.season}` : ""}
          </p>
        )}
        {overview && <p>{overview.currentSituation}</p>}
      </header>

      {error ? (
        <p className="account-realm-error" role="alert">{error}</p>
      ) : overview ? (
        <>
          <div className="account-region-grid">
            {overview.regions.map((region) => {
              const currentLocationHouses = new Set(
                region.locations
                  .map((location) => location.house)
                  .filter((house): house is string => Boolean(house)),
              );
              const relevantHouses = region.houses.filter(
                (house) => currentLocationHouses.has(house.name),
              );

              return (
                <article className="account-region-card" key={region.id}>
                  <div className="account-region-card-top">
                    <span>REGION</span>
                    <span>{region.locations.length} {region.locations.length === 1 ? "LOCATION" : "LOCATIONS"}</span>
                  </div>
                  <h3>{region.name}</h3>
                  {relevantHouses.length > 0 && (
                    <ul>
                      {relevantHouses.map((house) => (
                        <li key={house.id}>
                          <span>{house.name}</span>
                          <small>
                            {house.treasuryIsEstimate ? "Estimated treasury: " : "Treasury: "}
                            {formatTreasury(house.treasuryAmount)}
                            {house.treasurySourceNote ? ` · ${house.treasurySourceNote}` : ""}
                            {house.debtSummary ? ` · ${house.debtSummary}` : ""}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                  {region.militaryEstimates.length > 0 && (
                    <div className="account-region-events">
                      <span>FORCE ESTIMATES</span>
                      {region.militaryEstimates.map((estimate) => (
                        <p key={estimate.id}>
                          <strong>{estimate.forceName}: {formatMilitaryEstimate(estimate)}</strong>
                          {` · ${estimate.readinessStatus.replaceAll("_", " ")}`}
                          {` · ${estimate.confidenceLevel.replaceAll("_", " ")} confidence`}
                          {estimate.isGameplayAssumption ? " · gameplay estimate" : ""}
                          {estimate.summary && ` — ${estimate.summary}`}
                        </p>
                      ))}
                    </div>
                  )}
                  {region.locations.length > 0 ? (
                    <ul>
                      {region.locations.slice(0, 5).map((location) => (
                        <li key={location.id}>
                          <span>{location.name}</span>
                          <small>{location.house ?? location.locationType.replaceAll("_", " ")}</small>
                        </li>
                      ))}
                      {region.locations.length > 5 && (
                        <li className="account-region-more">
                          +{region.locations.length - 5} more recorded locations
                        </li>
                      )}
                    </ul>
                  ) : (
                    <p className="account-region-empty">No locations have been recorded for this region.</p>
                  )}
                  {region.recentEvents.length > 0 && (
                    <div className="account-region-events">
                      <span>RECENTLY REPORTED</span>
                      {region.recentEvents.map((event) => (
                        <p key={event.id}>
                          <strong>{event.title}</strong>
                          {event.publicSummary && ` — ${event.publicSummary}`}
                        </p>
                      ))}
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="account-realm-details">
            <section className="account-realm-panel">
              <p className="eyebrow">ARMED CONFLICT</p>
              <h3>Wars</h3>
              {overview.activeWars.length > 0 ? (
                <ul>
                  {overview.activeWars.map((war) => (
                    <li key={war.id}>
                      <strong>{war.name}</strong>
                      {war.publicSummary && <span>{war.publicSummary}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No active wars are recorded in the current world state.</p>
              )}
            </section>

            <section className="account-realm-panel">
              <p className="eyebrow">PLEDGES & PRESSURES</p>
              <h3>Diplomacy</h3>
              {overview.diplomacy.length > 0 ? (
                <ul>
                  {overview.diplomacy.map((record, index) => (
                    <li key={`${record.type}-${record.parties}-${index}`}>
                      <strong>{record.parties || "Unspecified parties"} · {record.type}</strong>
                      <span>
                        {record.status}
                        {record.publicSummary ? ` — ${record.publicSummary}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No active or proposed diplomatic records are available.</p>
              )}
            </section>

            <section className="account-realm-panel account-recent-events">
              <p className="eyebrow">WHAT HAS CHANGED</p>
              <h3>Recent events</h3>
              {overview.recentEvents.length > 0 ? (
                <ol>
                  {overview.recentEvents.map((event) => (
                    <li key={event.id}>
                      <time dateTime={event.occurredAt}>
                        {new Date(event.occurredAt).toLocaleDateString("en", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </time>
                      <div>
                        <strong>{event.title}</strong>
                        <p>{event.publicSummary}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No public events have been recorded since the opening of the game.</p>
              )}
            </section>
          </div>
        </>
      ) : null}
    </section>
  );
}

export default function AccountPage() {
  return (
    <main>
      <SiteHeader current="account" />
      <Suspense
        fallback={
          <section className="auth-page">
            <div className="auth-card">Checking your account…</div>
          </section>
        }
      >
        <AccountDetails />
      </Suspense>
      <SiteFooter />
    </main>
  );
}
