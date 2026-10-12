"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import type { AssignedCharacter } from "../../lib/character-assignment";
import { drawPlayableCharacter } from "./character-actions";

function CharacterDetails({ character }: { character: AssignedCharacter }) {
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
          <strong>{character.location ?? "Not recorded"}</strong>
          {character.region && <small>{character.region}</small>}
        </div>
      </header>

      <div className="assigned-character-sections">
        <section className="assigned-character-section">
          <p className="eyebrow">WHO AM I?</p>
          <h3>Identity and allegiance</h3>
          <dl className="assigned-character-facts">
            <div>
              <dt>House / family</dt>
              <dd>{character.house ?? "Not established"}</dd>
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
          </dl>
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
      </div>
    </div>
  );
}

export default function CharacterDraw({
  initialCharacter,
  setupError,
  initialError,
}: {
  initialCharacter: AssignedCharacter | null;
  setupError: string | null;
  initialError: string | null;
}) {
  const [drawnCharacter, setDrawnCharacter] = useState<AssignedCharacter | null>(null);
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
        <CharacterDetails character={character} />
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
