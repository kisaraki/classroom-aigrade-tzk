/** Server-only primitives. Keys are injected from Secret storage, never persisted here. */
export type VersionedKey = { version: number; bytes: Uint8Array };
export type IdentityKeys = { encryption: VersionedKey; lookup: VersionedKey[] };
export type SealedIdentity = {
  encrypted: string;
  encryptionKeyVersion: number;
  lookupHashes: { keyVersion: number; hash: string }[];
};
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const bytes = (value: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(value);
const base64 = (value: Uint8Array) => btoa(String.fromCharCode(...value));
const unbase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));

function validateKey(key: VersionedKey) {
  if (
    !Number.isSafeInteger(key.version) ||
    key.version < 1 ||
    key.bytes.length !== 32
  )
    throw new Error("INVALID_IDENTITY_KEY");
}
function validateKeys(keys: IdentityKeys) {
  validateKey(keys.encryption);
  if (
    !keys.lookup.length ||
    new Set(keys.lookup.map((k) => k.version)).size !== keys.lookup.length
  )
    throw new Error("INVALID_LOOKUP_KEY_RING");
  for (const key of keys.lookup) {
    validateKey(key);
    if (key.bytes.every((byte, i) => byte === keys.encryption.bytes[i]))
      throw new Error("IDENTITY_KEYS_MUST_BE_INDEPENDENT");
  }
}
function validateInput(studentId: string, identity: string) {
  if (!studentId || !identity || identity.length > 256)
    throw new Error("INVALID_IDENTITY_INPUT");
}

export async function identityLookupHash(
  identity: string,
  key: VersionedKey,
): Promise<string> {
  validateKey(key);
  validateInput("lookup", identity);
  // Domain separator avoids reusing an identity HMAC as another token type.
  const imported = await crypto.subtle.importKey(
    "raw",
    bytes(key.bytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      imported,
      encoder.encode(`student-identity:v1:${identity}`),
    ),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function sealIdentity(
  studentId: string,
  identity: string,
  keys: IdentityKeys,
): Promise<SealedIdentity> {
  validateInput(studentId, identity);
  validateKeys(keys);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(keys.encryption.bytes),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(
          `student:${studentId}:key:${keys.encryption.version}`,
        ),
        tagLength: 128,
      },
      key,
      encoder.encode(identity),
    ),
  );
  return {
    encrypted: JSON.stringify({
      algorithm: "AES-256-GCM",
      iv: base64(iv),
      ciphertext: base64(ciphertext),
    }),
    encryptionKeyVersion: keys.encryption.version,
    lookupHashes: await Promise.all(
      keys.lookup.map(async (lookup) => ({
        keyVersion: lookup.version,
        hash: await identityLookupHash(identity, lookup),
      })),
    ),
  };
}

export async function openIdentity(
  studentId: string,
  encrypted: string,
  keyVersion: number,
  keys: VersionedKey[],
): Promise<string> {
  // All failure modes are redacted, including missing keys and authentication failures.
  try {
    const versioned = keys.find((key) => key.version === keyVersion);
    if (!versioned) throw new Error();
    validateKey(versioned);
    const value = JSON.parse(encrypted);
    if (
      value.algorithm !== "AES-256-GCM" ||
      typeof value.iv !== "string" ||
      typeof value.ciphertext !== "string"
    )
      throw new Error();
    const iv = unbase64(value.iv);
    const ciphertext = unbase64(value.ciphertext);
    if (iv.length !== 12 || ciphertext.length < 17) throw new Error();
    const key = await crypto.subtle.importKey(
      "raw",
      bytes(versioned.bytes),
      "AES-GCM",
      false,
      ["decrypt"],
    );
    return decoder.decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: encoder.encode(
            `student:${studentId}:key:${keyVersion}`,
          ),
          tagLength: 128,
        },
        key,
        ciphertext,
      ),
    );
  } catch {
    throw new Error("IDENTITY_UNAVAILABLE");
  }
}

/** Rotation is prepared in memory; the caller must atomically commit the cipher + ALL hashes. */
export async function rotateIdentity(
  studentId: string,
  current: Pick<SealedIdentity, "encrypted" | "encryptionKeyVersion">,
  oldEncryptionKeys: VersionedKey[],
  target: IdentityKeys,
): Promise<SealedIdentity> {
  const plaintext = await openIdentity(
    studentId,
    current.encrypted,
    current.encryptionKeyVersion,
    oldEncryptionKeys,
  );
  return sealIdentity(studentId, plaintext, target);
}

/** Masking is done after authenticated decryption, never by storing another plaintext field. */
export function maskIdentity(value: string): string {
  return value.length <= 4
    ? "****"
    : `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}
