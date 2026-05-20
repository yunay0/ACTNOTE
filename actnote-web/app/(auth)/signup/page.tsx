"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthMarketingPanel } from "@/components/auth/AuthMarketingPanel";
import { englishFieldInvalidMessage, clearNativeValidity } from "@/lib/auth-native-validation";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "@/lib/legal-links";
import { getSafeInternalReturnPath } from "@/lib/auth/safe-return-path";
import { startGoogleSignIn } from "@/lib/auth/start-google-sign-in";
import { AuthLegalFooter } from "@/components/auth/AuthLegalFooter";
import { GoogleMark } from "@/components/auth/GoogleMark";

const PLACEHOLDER_FIRST = "Lucy";
const PLACEHOLDER_LAST = "Lee";
const PLACEHOLDER_EMAIL = "lucy@actnote.com";
const PLACEHOLDER_PASSWORD = "Enter your password";

function passwordMeetsPolicy(p: string): boolean {
  if (p.length < 8) return false;
  if (!/[A-Z]/.test(p)) return false;
  if (!/[0-9]/.test(p)) return false;
  if (!/[^A-Za-z0-9]/.test(p)) return false;
  return true;
}

const inputCls =
  "w-full rounded-[10px] border-2 border-[#e2e8f0] px-[18px] py-[14px] text-[15px] text-[#0f172a] placeholder-[#94a3b8] outline-none transition-colors focus:border-[#2e5c8a]";

function SignupForm() {
  const searchParams = useSearchParams();
  const returnTo = getSafeInternalReturnPath(searchParams.get("next"));
  const loginHref = returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : "/login";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!passwordMeetsPolicy(password)) {
      setError("Your password must meet all requirements listed below.");
      return;
    }

    setLoading(true);

    const em = email.trim();
    const supabase = createClient();
    const displayName = `${firstName.trim()} ${lastName.trim()}`.trim();
    const { data, error: signErr } = await supabase.auth.signUp({
      email: em,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/email-verified`,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          full_name: displayName,
          name: displayName,
        },
      },
    });

    if (signErr) {
      setError(signErr.message);
      setLoading(false);
      return;
    }

    if (data.session) {
      window.location.assign(returnTo ?? "/workspace/select");
      return;
    }

    setDone(true);
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen w-full bg-[#f8fafc]">
      <AuthMarketingPanel />

      <div className="relative z-[1] flex flex-1 items-center justify-center p-10">
        <div className="w-full max-w-[480px] rounded-2xl bg-white p-[60px] shadow-[0px_4px_6px_rgba(0,0,0,0.1)]">
          {done ? (
            <div className="text-center">
              <div className="mb-4 text-5xl">📬</div>
              <h2 className="mb-2 text-[28px] font-bold text-[#0f172a]">Verify your email</h2>
              <p className="text-[14px] leading-relaxed text-[#64748b]">
                We sent a link to <strong className="text-[#0f172a]">{email}</strong>. Open it to confirm you own this
                inbox.
                <br />
                <br />
                After verifying, come back and <strong>sign in with your password</strong>.
              </p>
              <Link href={loginHref} className="mt-6 inline-block text-sm font-bold text-[#ff6b35] hover:underline">
                Sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-[28px] font-bold text-[#0f172a]">Create your account</h2>
              <p className="mt-2 text-sm text-[#475569]">Start transforming your meetings into actions</p>

              <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-[18px]">
                <button
                  type="button"
                  disabled={googleLoading || loading}
                  onClick={() => {
                    setError(null);
                    setGoogleLoading(true);
                    void startGoogleSignIn(returnTo)
                      .catch((e) => {
                        setError(e instanceof Error ? e.message : "Google sign-up could not start.");
                      })
                      .finally(() => setGoogleLoading(false));
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-[10px] border-2 border-[#e2e8f0] bg-white py-[14px] text-[15px] font-bold text-[#0f172a] transition-colors hover:bg-[#f8fafc] disabled:opacity-60"
                >
                  {googleLoading ? (
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-[#0f172a] border-t-transparent" />
                  ) : (
                    <>
                      <GoogleMark />
                      Continue with Google
                    </>
                  )}
                </button>

                <div className="flex items-center gap-4">
                  <div className="h-px flex-1 bg-[#e2e8f0]" />
                  <span className="shrink-0 text-[13px] text-[#94a3b8]">or sign up with email</span>
                  <div className="h-px flex-1 bg-[#e2e8f0]" />
                </div>
                <div className="flex gap-5">
                  <div className="flex flex-1 flex-col gap-2">
                    <label htmlFor="signup-first" className="text-sm font-bold text-[#0f172a]">
                      First Name
                    </label>
                    <input
                      id="signup-first"
                      autoComplete="given-name"
                      value={firstName}
                      onInvalid={englishFieldInvalidMessage}
                      onInput={(e) => clearNativeValidity(e.currentTarget)}
                      onChange={(e) => {
                        setFirstName(e.target.value);
                        setError(null);
                      }}
                      placeholder={PLACEHOLDER_FIRST}
                      required
                      className={inputCls}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <label htmlFor="signup-last" className="text-sm font-bold text-[#0f172a]">
                      Last Name
                    </label>
                    <input
                      id="signup-last"
                      autoComplete="family-name"
                      value={lastName}
                      onInvalid={englishFieldInvalidMessage}
                      onInput={(e) => clearNativeValidity(e.currentTarget)}
                      onChange={(e) => {
                        setLastName(e.target.value);
                        setError(null);
                      }}
                      placeholder={PLACEHOLDER_LAST}
                      required
                      className={inputCls}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="signup-email" className="text-sm font-bold text-[#0f172a]">
                    Email Address
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onInvalid={englishFieldInvalidMessage}
                    onInput={(e) => clearNativeValidity(e.currentTarget)}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                    placeholder={PLACEHOLDER_EMAIL}
                    required
                    className={inputCls}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="signup-password" className="text-sm font-bold text-[#0f172a]">
                    Password
                  </label>
                  <input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onInvalid={englishFieldInvalidMessage}
                    onInput={(e) => clearNativeValidity(e.currentTarget)}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setError(null);
                    }}
                    placeholder={PLACEHOLDER_PASSWORD}
                    required
                    minLength={8}
                    className={inputCls}
                  />
                  <ul className="flex flex-col gap-1 text-xs text-[#94a3b8]">
                    <li className="flex items-center gap-1.5">
                      <span aria-hidden>○</span> At least 8 characters
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span aria-hidden>○</span> One uppercase letter
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span aria-hidden>○</span> One number
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span aria-hidden>○</span> One special character
                    </li>
                  </ul>
                </div>

                <div className="flex flex-col gap-3 pt-1">
                  <div className="flex gap-3">
                    <input
                      id="agree-terms"
                      type="checkbox"
                      checked={agreeTerms}
                      required
                      onInvalid={englishFieldInvalidMessage}
                      onChange={(e) => {
                        clearNativeValidity(e.currentTarget);
                        setAgreeTerms(e.target.checked);
                        setError(null);
                      }}
                      className="mt-0.5 size-[18px] shrink-0 rounded border border-[#767676] accent-[#ff6b35]"
                    />
                    <span className="text-sm leading-relaxed text-[#475569]">
                      <label htmlFor="agree-terms" className="cursor-pointer">
                        I agree to the{" "}
                      </label>
                      <a
                        href={TERMS_OF_SERVICE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-[#ff6b35] hover:underline"
                      >
                        Terms of Service
                      </a>
                    </span>
                  </div>
                  <div className="flex gap-3">
                    <input
                      id="agree-privacy"
                      type="checkbox"
                      checked={agreePrivacy}
                      required
                      onInvalid={englishFieldInvalidMessage}
                      onChange={(e) => {
                        clearNativeValidity(e.currentTarget);
                        setAgreePrivacy(e.target.checked);
                        setError(null);
                      }}
                      className="mt-0.5 size-[18px] shrink-0 rounded border border-[#767676] accent-[#ff6b35]"
                    />
                    <span className="text-sm leading-relaxed text-[#475569]">
                      <label htmlFor="agree-privacy" className="cursor-pointer">
                        I agree to the{" "}
                      </label>
                      <a
                        href={PRIVACY_POLICY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-bold text-[#ff6b35] hover:underline"
                      >
                        Privacy Policy
                      </a>
                    </span>
                  </div>
                </div>

                {error && (
                  <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading || googleLoading}
                  className="mt-1 w-full rounded-[10px] bg-[#ff6b35] py-[14px] text-base font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:opacity-60"
                >
                  {loading ? (
                    <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    "Create Account"
                  )}
                </button>
              </form>

              <div className="mt-6">
                <AuthLegalFooter />
              </div>

              <p className="mt-6 flex flex-wrap items-center justify-center gap-1 text-center text-sm text-[#475569]">
                Already have an account?{" "}
                <Link href={loginHref} className="font-bold text-[#ff6b35] hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[#f8fafc] text-[#64748b]">
          Loading…
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
