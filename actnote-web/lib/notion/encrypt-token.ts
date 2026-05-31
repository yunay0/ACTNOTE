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

/**
 * Fernet decrypt (mirror of {@link encryptActnoteToken}, Python `src.encryption` 호환).
 * settings 에서 DB URL 변경 시 저장된 토큰으로 verify 하기 위해 **서버에서만** 사용.
 * 클라이언트 컴포넌트로 import 금지 (ACTNOTE_ENCRYPTION_KEY 노출 위험).
 */
export function decryptActnoteToken(encoded: string): string {
  const key = process.env.ACTNOTE_ENCRYPTION_KEY?.trim();
  if (!key) {
    throw new Error(
      "ACTNOTE_ENCRYPTION_KEY is not set (required to decrypt Notion tokens)"
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fernetApi = require("fernet") as {
    Secret: new (k: string) => unknown;
    Token: new (o: {
      secret: unknown;
      token?: string;
      ttl?: number;
    }) => { decode: (token: string) => string };
  };
  const secret = new fernetApi.Secret(key);
  // ttl: 0 → 만료 검사 비활성 (Notion 토큰은 장기 보관).
  // fernet@0.4.0 decode 는 토큰을 인자로 받아야 동작한다 (생성자 token 만으론 throw).
  const token = new fernetApi.Token({ secret, token: encoded, ttl: 0 });
  return token.decode(encoded);
}
