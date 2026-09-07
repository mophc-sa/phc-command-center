import { createHmac } from "node:crypto";
/** RFC 6238 SHA-1, 30-second period; used only with dedicated E2E accounts. */
export function totp(secret: string, now = Date.now(), digits = 6): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secret.toUpperCase().replace(/=+$/, "");
  if (!/^[A-Z2-7]+$/.test(clean)) throw new Error("Invalid test TOTP secret encoding");
  const bits = [...clean].map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, "0");
}
