const endpoint = process.env.GAME_TURN_WORKER_ENDPOINT;
const secret = process.env.GAME_WORKER_SECRET;
const configuredInterval = Number(process.env.GAME_TURN_WORKER_POLL_INTERVAL_MS ?? 30000);

if (!endpoint) throw new Error("Missing GAME_TURN_WORKER_ENDPOINT.");
if (!secret || secret.length < 32) {
  throw new Error("GAME_WORKER_SECRET must contain at least 32 characters.");
}
if (!Number.isSafeInteger(configuredInterval) || configuredInterval < 1000) {
  throw new Error("GAME_TURN_WORKER_POLL_INTERVAL_MS must be an integer of at least 1000.");
}

const workerUrl = new URL(endpoint);
if (
  workerUrl.protocol !== "https:" &&
  !(workerUrl.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(workerUrl.hostname))
) {
  throw new Error("GAME_TURN_WORKER_ENDPOINT must use HTTPS except for localhost.");
}

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

while (!stopping) {
  try {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(240000),
    });
    if (!response.ok) {
      throw new Error(`Worker endpoint returned HTTP ${response.status}.`);
    }
    const result = await response.json();
    console.info(JSON.stringify({
      at: new Date().toISOString(),
      resolved: result.resolved === true,
      turnNumber: result.turnNumber,
    }));
  } catch (error) {
    console.error(
      "Game-turn worker poll failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }

  if (!stopping) await sleep(configuredInterval);
}
