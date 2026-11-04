import { createHash, timingSafeEqual } from "crypto";

export const productionAuth = process.env.NODE_ENV === "production";

export function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase();
}

export function validUsername(value: string) {
  return /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value);
}

export function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function configuredCodeHashes(): Buffer[] {
  const raw = process.env.ACCESS_CODES;
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("ACCESS_CODES must be a JSON array."); }
  if (!Array.isArray(parsed) || parsed.some((code) => typeof code !== "string" || !/^\d{5}$/.test(code))) {
    throw new Error("ACCESS_CODES must be an array of five-digit numeric strings.");
  }
  const hashes = parsed.map((code: string) => createHash("sha256").update(code).digest());
  if (new Set(hashes.map((hash) => hash.toString("hex"))).size !== hashes.length) throw new Error("ACCESS_CODES contains duplicate codes.");
  return hashes;
}

export function accessCodesConfigured() {
  return configuredCodeHashes().length > 0;
}

export function verifiedCodeHash(code: string) {
  const actualHash = createHash("sha256").update(code).digest();
  const match = configuredCodeHashes().find((expected) => timingSafeEqual(actualHash, expected));
  return match?.toString("hex") || null;
}

export function isActiveCodeHash(hash: string | null) {
  return Boolean(hash && configuredCodeHashes().some((configured) => configured.toString("hex") === hash));
}
