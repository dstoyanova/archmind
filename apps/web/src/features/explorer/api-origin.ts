import { env } from "node:process";

export function apiOrigin(): string {
  const origin = env.ARCHMIND_API_ORIGIN ?? "http://127.0.0.1:3001";
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    origin !== url.origin
  ) {
    throw new Error("ARCHMIND_API_ORIGIN must be a loopback HTTP origin.");
  }
  return origin;
}
