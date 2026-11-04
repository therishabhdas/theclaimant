"use client";

import { useCallback, useState } from "react";
import type { FormEvent } from "react";
import type { PlayerTurnStatus } from "../../lib/game/turn-service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTurnStatus(value: unknown): PlayerTurnStatus {
  if (
    !isRecord(value) ||
    typeof value.turnNumber !== "number" ||
    !Number.isInteger(value.turnNumber) ||
    (value.phase !== "planning" && value.phase !== "resolving") ||
    typeof value.deadlineAt !== "string" ||
    Number.isNaN(Date.parse(value.deadlineAt)) ||
    typeof value.participating !== "boolean" ||
    typeof value.ownOrderStatus !== "string" ||
    !(typeof value.previousTurnStatus === "string" || value.previousTurnStatus === null)
  ) {
    throw new Error("The turn status response was incomplete. Refresh and try again.");
  }

  return {
    turnNumber: value.turnNumber,
    phase: value.phase,
    deadlineAt: value.deadlineAt,
    participating: value.participating,
    ownOrderStatus: value.ownOrderStatus,
    previousTurnStatus: value.previousTurnStatus,
  };
}

function responseError(value: unknown, fallback: string) {
  if (!isRecord(value)) return fallback;
  if (typeof value.error === "string") {
    const details = Array.isArray(value.details)
      ? value.details.filter((detail): detail is string => typeof detail === "string")
      : [];
    return details.length > 0
      ? `${value.error} ${details.join(" ")}`
      : value.error;
  }
  return fallback;
}

function orderStatusLabel(status: string) {
  switch (status) {
    case "not_submitted":
      return "No order submitted";
    case "pending":
      return "Submitted · awaiting resolution";
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    case "pass":
      return "Passed";
    case "not_participating":
      return "Not participating this turn";
    default:
      return status.replaceAll("_", " ");
  }
}

function formatDeadline(deadlineAt: string) {
  return `${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(deadlineAt))} UTC`;
}

export default function WorldTurnPanel({
  initialStatus,
  initialError,
}: {
  initialStatus: PlayerTurnStatus | null;
  initialError: string | null;
}) {
  const [status, setStatus] = useState<PlayerTurnStatus | null>(initialStatus);
  const [statusError, setStatusError] = useState<string | null>(initialError);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [order, setOrder] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [orderSubmitted, setOrderSubmitted] = useState(false);

  const refreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    setStatusError(null);
    try {
      const response = await fetch("/api/game/turn", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(responseError(body, "The turn status could not be loaded."));
      }
      setStatus(parseTurnStatus(body));
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : "The turn status could not be loaded.",
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!status || !canSubmit || isSubmitting) return;

    setIsSubmitting(true);
    setSubmissionError(null);
    setSubmissionMessage(null);
    const submissionId = requestId ?? window.crypto.randomUUID();
    setRequestId(submissionId);

    try {
      const response = await fetch("/api/game/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: submissionId,
          playerRequest: order.trim(),
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        throw new Error(responseError(body, "Your order could not be submitted."));
      }
      if (!isRecord(body) || typeof body.turnNumber !== "number") {
        throw new Error("The submission response was incomplete. Refresh turn status.");
      }

      setSubmissionMessage(
        `Your order for World Turn ${body.turnNumber} was submitted. Resolution happens for the whole realm, not per player.`,
      );
      setOrderSubmitted(true);
      setOrder("");
      await refreshStatus();
    } catch (error) {
      setSubmissionError(
        error instanceof Error ? error.message : "Your order could not be submitted.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = Boolean(
    status?.participating &&
    status.phase === "planning" &&
    status.ownOrderStatus === "not_submitted" &&
    !statusError &&
    !orderSubmitted,
  );
  const deadlineLabel = status ? formatDeadline(status.deadlineAt) : null;

  return (
    <section className="world-turn-panel" aria-labelledby="world-turn-heading">
      <header className="world-turn-heading">
        <div>
          <p className="eyebrow"><span />THE SHARED WORLD</p>
          <h2 id="world-turn-heading">World Turn {status ? String(status.turnNumber).padStart(3, "0") : "—"}</h2>
        </div>
        <span className={`world-turn-phase${status?.phase === "resolving" ? " is-resolving" : ""}`}>
          {status ? (status.phase === "planning" ? "Planning" : "Resolving") : "Loading"}
        </span>
      </header>

      {statusError && <p className="world-turn-error" role="alert">{statusError}</p>}

      {status ? (
        <>
          <div className="world-turn-status">
            <div>
              <span>YOUR ORDER</span>
              <strong>{orderStatusLabel(status.ownOrderStatus)}</strong>
            </div>
            <div>
              <span>PLANNING DEADLINE</span>
              <strong>{deadlineLabel}</strong>
            </div>
          </div>

          {status.phase === "resolving" && (
            <p className="world-turn-note">
              Player orders and scheduled events are being resolved together. The shared clock advances once when resolution completes.
            </p>
          )}
          {status.previousTurnStatus && (
            <p className="world-turn-previous">
              Previous turn: {orderStatusLabel(status.previousTurnStatus)}.
            </p>
          )}

          {canSubmit ? (
            <form className="world-turn-form" onSubmit={submitOrder}>
              <label htmlFor="world-turn-order">Your primary order</label>
              <p id="world-turn-help">
                Describe one order for your assigned character. It will be checked against the current world state before it is recorded.
              </p>
              <textarea
                id="world-turn-order"
                maxLength={6000}
                onChange={(event) => setOrder(event.target.value)}
                placeholder="Describe the action your character intends to take…"
                required
                rows={4}
                value={order}
                aria-describedby="world-turn-help"
              />
              <div className="world-turn-submit-row">
                <span>{order.length}/6000</span>
                <button
                  className="button-primary"
                  disabled={isSubmitting || order.trim().length === 0}
                  type="submit"
                >
                  {isSubmitting ? "Submitting order…" : "Submit this turn"}
                  <span aria-hidden="true">↗</span>
                </button>
              </div>
              {submissionError && <p className="world-turn-error" role="alert">{submissionError}</p>}
              {submissionMessage && <p className="world-turn-success" role="status">{submissionMessage}</p>}
            </form>
          ) : (
            <p className="world-turn-note">
              {statusError
                ? "Refresh the current status before submitting an order."
                : status.ownOrderStatus === "not_submitted" && status.phase === "resolving"
                  ? "The planning window is closed. The worker will resolve the turn without requiring another player visit."
                  : status.ownOrderStatus === "not_participating"
                    ? "Your character is not listed as a participant in this world turn."
                    : "Your order is recorded. You may refresh this read-only status while the shared turn resolves."}
            </p>
          )}
        </>
      ) : !statusError ? (
        <p className="world-turn-note">Loading the current shared-turn status…</p>
      ) : null}

      <button
        className="world-turn-refresh"
        disabled={isRefreshing}
        onClick={() => void refreshStatus()}
        type="button"
      >
        {isRefreshing ? "Checking status…" : "Refresh status"}
      </button>
    </section>
  );
}
