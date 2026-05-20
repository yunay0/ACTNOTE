import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from "@/lib/legal-links";

/** Compact Terms + Privacy links for auth screens (same destinations as marketing site footer). */
export function AuthLegalFooter() {
  return (
    <p className="text-center text-[12px] leading-relaxed text-[#94a3b8]">
      By continuing you agree to our{" "}
      <a
        href={TERMS_OF_SERVICE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-[#ff6b35] hover:underline"
      >
        Terms of Service
      </a>{" "}
      and{" "}
      <a
        href={PRIVACY_POLICY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-[#ff6b35] hover:underline"
      >
        Privacy Policy
      </a>
      .
    </p>
  );
}
