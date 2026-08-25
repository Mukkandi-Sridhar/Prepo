import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "crypto";

/**
 * Provider API keys are the most sensitive thing this application touches:
 * people are pasting a billable credential into software they downloaded from
 * a stranger. AES-256-GCM, a random IV per record, and a per-user subkey
 * derived via HKDF so that one leaked ciphertext cannot be replayed against
 * another user's row.
 */

const ALG = "aes-256-gcm";
const IV_BYTES = 12;

function masterKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with `pnpm keygen` and put it in .env",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must be 32 bytes base64-encoded (got ${key.length}). Run \`pnpm keygen\`.`,
    );
  }
  return key;
}

/** Per-user subkey. Salt is the user id, so ciphertexts are not portable. */
function subkey(salt: string): Buffer {
  return Buffer.from(hkdfSync("sha256", masterKey(), Buffer.from(salt), Buffer.from("prepo:provider-key"), 32));
}

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function seal(plaintext: string, salt: string): SealedSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, subkey(salt), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: enc.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function open(sealed: SealedSecret, salt: string): string {
  const decipher = createDecipheriv(ALG, subkey(salt), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Only the last four characters of a key are ever stored in plaintext. */
export function last4(key: string): string {
  return key.slice(-4);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
