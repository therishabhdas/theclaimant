"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CharacterAccountDetails } from "../../lib/account-world";
import type { AssignedCharacter } from "../../lib/character-assignment";
import { drawPlayableCharacter } from "./character-actions";

function formatRecord(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function CharacterDetails({
  character,
  details,
  detailsError,
}: {
  character: AssignedCharacter;
  details: CharacterAccountDetails | null;
  detailsError: string | null;
}) {
  return (
    <div className="assigned-character">
      <header className="assigned-character-hero" aria-live="polite">
        <div>
          <p className="eyebrow"><span />YOUR CHARACTER · NO. {String(character.id).padStart(2, "0")}</p>
          <h2>{character.displayName}</h2>
          {character.aliases.length > 0 && (
            <p className="draw-aliases">{character.aliases.join(" · ")}</p>
          )}
          {character.title && <p className="draw-title">{character.title}</p>}
          <p className="draw-status">{character.currentStatus}</p>
        </div>
        <div className="assigned-current-place">
          <span>YOUR CURRENT LOCATION</span>
          <strong>{details?.currentLocation ?? character.location ?? "Not recorded"}</strong>
          {character.region && <small>{character.region}</small>}
        </div>
      </header>

      <div className="assigned-character-sections">
        <section className="assigned-character-section">
          <p className="eyebrow">WHO AM I?</p>
          <h3>Identity and allegiance</h3>
          <dl className="assigned-character-facts">
            <div>
              <dt>Current house</dt>
              <dd>{details?.currentHouse?.name ?? character.house ?? "Not established"}</dd>
            </div>
            <div>
              <dt>Birth house</dt>
              <dd>{details?.birthHouse ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Liege</dt>
              <dd>{details?.liegeHouse ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt>Circle</dt>
              <dd>{character.group}</dd>
            </div>
            <div>
              <dt>Region</dt>
              <dd>{character.region ?? "Not specified"}</dd>
            </div>
            <div>
              <dt>Life status</dt>
              <dd>{character.lifeStatus.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Life status at opening</dt>
              <dd>{character.openingLifeStatus.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Current status</dt>
              <dd>{character.currentStatus}</dd>
            </div>
            <div>
              <dt>Opening presence</dt>
              <dd>{character.openingStatus}</dd>
            </div>
          </dl>
          {details?.currentHouse && (
            <dl className="assigned-character-facts assigned-house-resources">
              <div>
                <dt>House treasury</dt>
                <dd>{details.currentHouse.treasury_amount ?? "Not recorded"}</dd>
              </div>
              <div>
                <dt>Recorded army</dt>
                <dd>{details.currentHouse.army_size ?? "Not recorded"}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="assigned-character-section">
          <p className="eyebrow">FAMILY & RELATIONSHIPS</p>
          <h3>Your place among others</h3>
          <p>{character.openingRelationships || "No family or relationship details have been recorded."}</p>
        </section>

        <section className="assigned-character-section">
          <p className="eyebrow">CLAIM & POWER</p>
          <h3>{character.claimTarget ?? "Your political standing"}</h3>
          <dl className="assigned-character-facts">
            <div>
              <dt>Claim status</dt>
              <dd>{character.claimStatus.replaceAll("_", " ")}</dd>
            </div>
          </dl>
          {character.claimSummary && <p>{character.claimSummary}</p>}
          {character.currentClaimBasis && <p>{character.currentClaimBasis}</p>}
          {details && details.claims.length > 0 && (
            <ul className="account-detail-list">
              {details.claims.map((claim) => (
                <li key={claim.id}>
                  <strong>{claim.target_title}</strong>
                  <span>{claim.claim_status.replaceAll("_", " ")}</span>
                  {claim.summary && <p>{claim.summary}</p>}
                </li>
              ))}
            </ul>
          )}
          {(character.openingClaimTarget ||
            character.openingClaimSummary ||
            character.openingClaimBasis) && (
            <div className="account-opening-claim">
              <p className="eyebrow">AT THE OPENING</p>
              <strong>
                {character.openingClaimTarget ?? "Opening political standing"}
                {" · "}
                {character.openingClaimStatus.replaceAll("_", " ")}
              </strong>
              {character.openingClaimSummary && <p>{character.openingClaimSummary}</p>}
              {character.openingClaimBasis && <p>{character.openingClaimBasis}</p>}
            </div>
          )}
          <dl className="assigned-character-facts assigned-house-resources">
            {Object.entries(character.powerRatings)
              .filter((entry): entry is [string, number] => entry[1] !== null)
              .map(([name, rating]) => (
                <div key={name}>
                  <dt>{name.replaceAll(/([A-Z])/g, " $1")}</dt>
                  <dd>{rating} / 100</dd>
                </div>
              ))}
          </dl>
        </section>

        <section className="assigned-character-section">
          <p className="eyebrow">TEMPERAMENT & INTENT</p>
          <h3>Traits and ambitions</h3>
          {details?.traits.length ? (
            <ul className="account-detail-list">
              {details.traits.map((trait) => (
                <li key={trait.id}>
                  <strong>{trait.trait}</strong>
                  {trait.details && <span>{trait.details}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p>No character traits have been recorded.</p>
          )}
          {details?.ambitions.length ? (
            <ul className="account-detail-list account-ambitions">
              {details.ambitions.map((ambition) => (
                <li key={ambition.id}>
                  <strong>{ambition.ambition}</strong>
                  <span>{ambition.status.replaceAll("_", " ")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="account-detail-empty">No ambitions have been recorded.</p>
          )}
        </section>

        <section className="assigned-character-section">
          <p className="eyebrow">LOYALTIES & PRIVATE KNOWLEDGE</p>
          <h3>What binds you—and what you know</h3>
          {details?.loyalties.length ? (
            <ul className="account-detail-list">
              {details.loyalties.map((loyalty) => (
                <li key={loyalty.id}>
                  <strong>
                    {loyalty.loyalHouse?.name ??
                      loyalty.loyalCharacter?.display_name ??
                      "Recorded allegiance"}
                  </strong>
                  <span>{loyalty.description}</span>
                  {loyalty.strength !== null && (
                    <small>Recorded strength: {loyalty.strength}/100</small>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No character loyalties have been recorded.</p>
          )}
          {details?.knownSecrets.length ? (
            <ul className="account-detail-list account-secrets">
              {details.knownSecrets.map((knowledge, index) => (
                <li key={`${knowledge.knowledge_status}-${index}`}>
                  <strong>
                    {knowledge.knowledge_status === "suspects"
                      ? knowledge.secret.public_summary ?? "A suspicion"
                      : knowledge.secret.canonical_summary}
                  </strong>
                  <span>{knowledge.knowledge_status.replaceAll("_", " ")}</span>
                  {knowledge.details && <p>{knowledge.details}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="account-detail-empty">No private knowledge has been recorded for this character.</p>
          )}
        </section>

        <section className="assigned-character-section assigned-story-section">
          <p className="eyebrow">YOUR STORY</p>
          <h3>What may shape your path</h3>
          {character.gameplayFocus.length > 0 ? (
            <ul className="assigned-story-focus">
              {character.gameplayFocus.map((focus) => <li key={focus}>{focus}</li>)}
            </ul>
          ) : (
            <p>No story themes have been recorded.</p>
          )}
        </section>

        <section className="assigned-character-section assigned-story-section">
          <p className="eyebrow">YOUR RESOURCES & PERSONALITY</p>
          <h3>Player state</h3>
          {detailsError && <p className="account-details-error" role="alert">{detailsError}</p>}
          <dl className="assigned-character-facts">
            <div>
              <dt>Resources</dt>
              <dd>{details && Object.keys(details.resources).length > 0
                ? Object.entries(details.resources).map(([key, value]) => `${key.replaceAll("_", " ")}: ${formatRecord(value)}`).join(" · ")
                : "No resources recorded"}
              </dd>
            </div>
            <div>
              <dt>Personality</dt>
              <dd>{details && Object.keys(details.personality).length > 0
                ? Object.entries(details.personality).map(([key, value]) => `${key.replaceAll("_", " ")}: ${formatRecord(value)}`).join(" · ")
                : "No personality notes recorded"}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}

export default function CharacterDraw({
  initialCharacter,
  initialDetails,
  detailsError,
  setupError,
  initialError,
}: {
  initialCharacter: AssignedCharacter | null;
  initialDetails: CharacterAccountDetails | null;
  detailsError: string | null;
  setupError: string | null;
  initialError: string | null;
}) {
  const [drawnCharacter, setDrawnCharacter] = useState<AssignedCharacter | null>(null);
  const router = useRouter();
  const character = initialCharacter ?? drawnCharacter;
  const [rotation, setRotation] = useState(0);
  const [drawState, setDrawState] = useState<"idle" | "spinning" | "settling">("idle");
  const [error, setError] = useState(setupError ?? initialError);

  async function handleDraw() {
    if (drawState !== "idle" || character || setupError) return;

    setDrawState("spinning");
    setError(null);
    try {
      const drawPromise = drawPlayableCharacter();
      await new Promise((resolve) => setTimeout(resolve, 900));
      const result = await drawPromise;

      if (!result.success) {
        setError(result.error);
        setDrawState("idle");
        return;
      }

      const segmentAngle = 360 / 40;
      const segmentCenter = (result.character.id - 1) * segmentAngle;
      const targetRotation =
        rotation + 360 * 6 + ((360 - segmentCenter) % 360);
      setRotation(targetRotation);
      setDrawState("settling");
      await new Promise((resolve) => setTimeout(resolve, 3400));
      setDrawnCharacter(result.character);
      setDrawState("idle");
      router.refresh();
    } catch (cause) {
      console.error("Character draw request failed:", cause);
      setError("The draw could not be completed. Check your connection and try again.");
      setDrawState("idle");
    }
  }

  return (
    <section className={`character-draw-section${character ? " is-assigned" : ""}`}>
      {!character && (
        <div className="character-draw-heading">
          <p className="eyebrow"><span />YOUR PLACE IN THE REALM</p>
          <h2>Who will you become?</h2>
          <p>
            Draw once to receive a character from the playable roster. Your
            assignment is saved to your account and cannot be redrawn.
          </p>
        </div>
      )}

      {character ? (
        <CharacterDetails
          character={character}
          details={initialDetails}
          detailsError={detailsError}
        />
      ) : setupError || initialError ? (
        <div className="draw-assignment-error" role="alert">
          <p className="eyebrow">ASSIGNMENT NOT CONFIRMED</p>
          <h2>Your character could not be loaded.</h2>
          <p>{error}</p>
          <p>For your protection, the draw is unavailable until the saved assignment can be checked. Reload the page or try again later.</p>
        </div>
      ) : (
        <div className="draw-wheel-area">
          <div className="draw-wheel-frame">
            <span className="draw-wheel-pointer" aria-hidden="true" />
            <div
              className={`draw-wheel${drawState === "spinning" ? " is-spinning" : ""}${drawState === "settling" ? " has-result" : ""}`}
              style={
                { "--wheel-rotation": `${rotation}deg` } as CSSProperties & {
                  "--wheel-rotation": string;
                }
              }
              aria-hidden="true"
            >
              <div className="draw-wheel-center">
                <span>THE</span>
                <strong>CLAIMANT</strong>
                <span>40 FATES</span>
              </div>
            </div>
          </div>
          <p className="draw-wheel-caption">FORTY CHARACTERS · ONE DRAW</p>
          <button
            className="button-primary draw-button"
            disabled={drawState !== "idle" || Boolean(setupError)}
            onClick={handleDraw}
            type="button"
          >
            {drawState !== "idle" ? "The wheel is turning…" : "Draw your character"}
            <span aria-hidden="true">↗</span>
          </button>
          {error && <p className="auth-message auth-message-error" role="alert">{error}</p>}
          {setupError && (
            <p className="draw-setup-note">
              Run the character-assignment SQL provided with this feature in Supabase, then reload this page.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
