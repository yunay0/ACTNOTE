import { createClient } from "@supabase/supabase-js";

/**
 * Server-only client for routes that must bypass RLS (e.g. Notion OAuth callback
 * after encrypting token — INSERT policy expects encrypted blob from trusted path).
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
    );
  }
  return createClient(url, key);
}
