type CryptoUuidSource = {
  getRandomValues?: Crypto["getRandomValues"];
  randomUUID?: () => string;
};

export function createIdempotencyKey(
  cryptoSource: CryptoUuidSource | undefined = globalThis.crypto,
): string {
  if (typeof cryptoSource?.randomUUID === "function") return cryptoSource.randomUUID();
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== "function") {
    throw new Error("Secure random values are unavailable. Use a secure connection and try again.");
  }

  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
