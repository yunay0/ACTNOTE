/**
 * Fernet encrypt compatible with Python `src.encryption.encrypt_token`
 * (same ACTNOTE_ENCRYPTION_KEY as the worker).
 */

export function encryptActnoteToken(plaintext: string): string {
  const key = process.env.ACTNOTE_ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error(
      "ACTNOTE_ENCRYPTION_KEY is not set (required to encrypt Notion tokens)"
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fernetApi = require("fernet") as {
    Secret: new (k: string) => unknown;
    Token: new (o: { secret: unknown; ttl: number }) => { encode: (p: string) => string };
  };
  const secret = new fernetApi.Secret(key);
  const token = new fernetApi.Token({ secret, ttl: 0 });
  return token.encode(plaintext);
}
