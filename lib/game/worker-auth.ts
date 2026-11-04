import { timingSafeEqual } from "node:crypto";

export function isAuthorizedGameWorkerRequest(
  authorization: string | null,
  secret: string | undefined,
) {
  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
