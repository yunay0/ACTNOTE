import type { NextRequest } from "next/server";

/**
 * Normalize NEXT_PUBLIC_APP_URL values that accidentally include inline comments
 * (e.g. pasted `https://app.example.com # note`) or wrapping quotes.
 */
export function sanitizePublicAppOrigin(raw: string | undefined): string {
  if (!raw) return "";
  let s = raw
    .replace(/\uFEFF/g, "")
    .replace(/[\u200B-\u200D]/g, "")
    .trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  const commentAt = s.search(/\s#/);
  if (commentAt !== -1) {
    s = s.slice(0, commentAt).trim();
  }
  return s.replace(/\/$/, "");
}

/**
 * Absolute app origin for redirects and invite links.
 * Prefer NEXT_PUBLIC_APP_URL; fall back to request Host (local dev without env).
 */
export function resolvePublicAppUrl(req: NextRequest): string {
  const env = sanitizePublicAppOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (env) return env;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const rawProto = req.headers.get("x-forwarded-proto") ?? "http";
  const proto = rawProto.split(",")[0]?.trim() || "http";
  if (host) return `${proto}://${host}`;
  return "";
}
