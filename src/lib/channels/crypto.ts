import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function key(): Buffer {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes, got ${buf.length}.`);
  }
  return buf;
}

/**
 * Encrypts a channel credential before it is stored.
 *
 * Channel access tokens are bearer credentials for a merchant's live store — a
 * leaked one can read customer PII and mutate orders. Encrypting at the
 * application layer means a database compromise alone does not yield usable
 * tokens; the attacker also needs the app's key.
 *
 * Format: base64(iv) . base64(authTag) . base64(ciphertext)
 */
export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptCredential(encoded: string): string {
  const [ivB64, tagB64, dataB64] = encoded.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted credential.');
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function tryDecryptCredential(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  try {
    return decryptCredential(encoded);
  } catch {
    return null;
  }
}

/**
 * Constant-time comparison of a computed HMAC against a provided one.
 *
 * A plain `===` here would leak the correct digest byte by byte through timing,
 * letting an attacker forge webhook signatures. Length is checked first because
 * timingSafeEqual throws on mismatched lengths.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256, base64-encoded — the scheme Shopify uses for webhook signatures. */
export function hmacBase64(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('base64');
}

export function hmacHex(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}
