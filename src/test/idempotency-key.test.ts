import { describe, expect, it, vi } from "vitest";
import { createIdempotencyKey } from "@/lib/idempotency-key";

describe("createIdempotencyKey", () => {
  it("uses the native UUID API when available", () => {
    const randomUUID = vi.fn(() => "native-uuid");
    const cryptoSource = {
      randomUUID,
      getRandomValues: <T extends ArrayBufferView>(array: T) => array,
    };

    expect(createIdempotencyKey(cryptoSource)).toBe("native-uuid");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates an RFC 4122 UUID from secure random bytes when randomUUID is unavailable", () => {
    const cryptoSource: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = {
      getRandomValues: <T extends ArrayBufferView>(array: T): T => {
        new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0);
        return array;
      },
    };

    expect(createIdempotencyKey(cryptoSource)).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("fails explicitly when secure random values are unavailable", () => {
    expect(() => createIdempotencyKey({})).toThrow("Secure random values are unavailable");
  });
});
