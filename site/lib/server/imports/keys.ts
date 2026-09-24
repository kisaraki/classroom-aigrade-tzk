import { ImportError } from "../../domain/import-csv.ts";
import type { IdentityKeys, VersionedKey } from "../identity.ts";

/** Versioned JSON Secret values; do not infer or discard active lookup-key versions. */
export function importIdentityKeys(
  encryption: string | undefined,
  lookup: string | undefined,
): IdentityKeys {
  const fail = (): never => {
    throw new ImportError("IDENTITY_KEYS_NOT_CONFIGURED", 503);
  };
  try {
    const decode = (input: {
      version: number;
      base64: string;
    }): VersionedKey => {
      if (
        !input ||
        !Number.isSafeInteger(input.version) ||
        input.version < 1 ||
        typeof input.base64 !== "string"
      )
        return fail();
      const bytes = Uint8Array.from(atob(input.base64), (c) => c.charCodeAt(0));
      if (bytes.length !== 32) return fail();
      return { version: input.version, bytes };
    };
    const key = decode(JSON.parse(encryption ?? "null"));
    const ring = JSON.parse(lookup ?? "null");
    if (!Array.isArray(ring) || !ring.length) return fail();
    const hashes = ring.map(decode);
    if (
      new Set(hashes.map((k) => k.version)).size !== hashes.length ||
      hashes.some((k) => k.bytes.every((v, i) => v === key.bytes[i]))
    )
      return fail();
    return { encryption: key, lookup: hashes };
  } catch {
    return fail();
  }
}
