"use client";

import { createClient } from "@/lib/supabase/client";
import { getSafeInternalReturnPath } from "@/lib/auth/safe-return-path";

/**
 * Supabase Auth Google OAuth. Requires Google provider to be enabled in the Supabase project.
 * Redirect lands on `/auth/callback` which exchanges the code and sends the user to `next`.
 */
export async function startGoogleSignIn(returnTo: string | null | undefined): Promise<void> {
  const supabase = createClient();
  const next = getSafeInternalReturnPath(returnTo) ?? "/workspace/select";
  const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
  if (error) {
    throw error;
  }
}
