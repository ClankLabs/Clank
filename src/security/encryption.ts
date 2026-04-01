/**
 * Encryption utilities for API key storage.
 *
 * Uses AES-256-GCM with PBKDF2-derived keys (100K iterations, SHA-256).
 * API keys are encrypted before writing to config.json5 and decrypted
 * in memory when needed for API calls.
 *
 * The encryption key is derived from a user-provided PIN or a
 * machine-specific secret. Keys are never stored in plaintext on disk.
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha256";

/** Encrypted value format: salt:iv:authTag:ciphertext (all hex) */
export interface EncryptedValue {
  encrypted: true;
  value: string; // salt:iv:authTag:ciphertext
}

/** Derive an encryption key from a passphrase */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

/** Encrypt a string value */
export function encrypt(plaintext: string, passphrase: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: salt:iv:authTag:ciphertext (all hex)
  return [
    salt.toString("hex"),
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/** Decrypt an encrypted string */
export function decrypt(encryptedStr: string, passphrase: string): string {
  const parts = encryptedStr.split(":");
  if (parts.length !== 4) {
    throw new Error("Invalid encrypted value format");
  }

  const [saltHex, ivHex, authTagHex, ciphertextHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const key = deriveKey(passphrase, salt);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/** Check if a value looks like an encrypted string */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  return parts.length === 4 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

/** Hash a PIN for verification (PBKDF2 with random salt, timing-safe) */
export function hashPin(pin: string, salt?: string): { hash: string; salt: string } {
  const pinSalt = salt || randomBytes(SALT_LENGTH).toString("hex");
  const hash = pbkdf2Sync(pin, pinSalt, PBKDF2_ITERATIONS, 32, PBKDF2_DIGEST).toString("hex");
  return { hash, salt: pinSalt };
}

/** Verify a PIN against a stored hash (timing-safe comparison) */
export function verifyPin(pin: string, storedHash: string, salt: string): boolean {
  const { hash } = hashPin(pin, salt);
  if (hash.length !== storedHash.length) return false;

  // Timing-safe comparison
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}
