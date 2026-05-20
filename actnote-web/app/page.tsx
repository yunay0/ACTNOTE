import { LandingSignInGoogleButton, LandingStartGoogleButton } from "@/components/landing/LandingGoogleAuth";
import { PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL, supportMailtoHref } from "@/lib/legal-links";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="flex flex-1 flex-col md:flex-row">
        <LeftColumn />
        <RightColumn />
      </main>
      <Footer />
    </div>
  );
}

/* ── Navigation ── */
function Nav() {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[#e2e8f0] bg-white px-20">
      <Logo />
      <LandingSignInGoogleButton />

    </header>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[#1e3a5f]">
        <span className="text-2xl font-bold leading-none text-[#ff6b35]">✓</span>
      </div>
      <span className="text-[20px] font-bold tracking-[-0.5px] text-[#0a2540]">
        ACTNOTE
      </span>
    </div>
  );
}

/* ── Left Column ── */
function LeftColumn() {
  return (
    <div
      className="flex flex-1 flex-col justify-center px-20 py-24"
      style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)" }}
    >
      {/* Headline */}
      <h1 className="mb-6 text-[49px] font-bold leading-[1.22] tracking-[-1.5px] text-[#0a2540]">
        AI writes your
        <br />
        meeting notes and
        <br />
        <span className="text-[#ff6b35]">auto-creates tickets</span>
      </h1>

      {/* Subtitle */}
      <p className="mb-12 text-[18px] text-[#64748b]">
        Meeting automation tool for PMs
      </p>

      {/* Feature list */}
      <div className="mb-14 flex flex-col gap-6">
        {FEATURES.map(({ emoji, bold, rest }) => (
          <div key={bold} className="flex items-center gap-4">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] text-xl"
              style={{
                background: "linear-gradient(135deg, #e3f2fd 0%, #fff4f0 100%)",
              }}
            >
              {emoji}
            </div>
            <p className="text-[16px] text-[#0a2540]">
              <strong className="font-bold">{bold}</strong>
              <span className="font-normal">{rest}</span>
            </p>
          </div>
        ))}
      </div>

      {/* CTA */}
      <LandingStartGoogleButton />
    </div>
  );
}

const FEATURES = [
  {
    emoji: "🎙️",
    bold: "Upload recording",
    rest: " → AI generates summary",
  },
  {
    emoji: "✅",
    bold: "Auto-extract",
    rest: " action items with assignee & due date",
  },
  {
    emoji: "🎫",
    bold: "One-click",
    rest: " ticket creation in Notion DB",
  },
];

/* ── Right Column (Mockup) ── */
function RightColumn() {
  return (
    <div className="flex flex-1 items-center justify-center bg-[#f8fafc] px-10 py-20">
      <div className="w-full max-w-[600px] overflow-hidden rounded-[20px] bg-white shadow-[0px_0px_0px_1px_rgba(30,58,95,0.05),0px_20px_60px_0px_rgba(30,58,95,0.12),0px_40px_80px_0px_rgba(30,58,95,0.08)]">
        {/* Mockup header */}
        <div className="flex h-16 items-center justify-between border-b border-[#e2e8f0] bg-white px-6">
          <span className="text-sm font-bold text-[#0a2540]">
            📝 Team Sync - Q2 Planning
          </span>
          <span className="rounded-[6px] bg-[#fff4f0] px-2.5 py-1 text-xs font-bold text-[#ff6b35]">
            DRAFT
          </span>
        </div>

        {/* Mockup content */}
        <div className="flex flex-col gap-4 bg-[#f8fafc] p-7">
          <MockupSection icon="✨" title="AI Summary">
            <MockupLine width="100%" />
            <MockupLine width="85%" />
            <MockupLine width="65%" />
          </MockupSection>

          <MockupSection icon="💡" title="Decisions">
            <MockupLine width="100%" />
            <MockupLine width="85%" />
          </MockupSection>

          <MockupSection icon="✅" title="Action Items">
            <div className="flex flex-col gap-2">
              <ActionRow />
              <ActionRow />
              <ActionRow />
            </div>
          </MockupSection>
        </div>
      </div>
    </div>
  );
}

function MockupSection({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#e2e8f0] bg-white px-6 py-5">
      <div className="mb-1 flex items-center gap-2 pb-2">
        <span className="text-base leading-none">{icon}</span>
        <span className="text-[14px] font-bold text-[#1e3a5f]">{title}</span>
      </div>
      {children}
    </div>
  );
}

function MockupLine({ width }: { width: string }) {
  return (
    <div
      className="h-2.5 rounded-full bg-[#e2e8f0]"
      style={{ width }}
    />
  );
}

function ActionRow() {
  return (
    <div className="flex items-center gap-3 rounded-md bg-[#f8fafc] p-2.5">
      <div className="h-4 w-4 shrink-0 rounded-[4px] border-2 border-[#2e5c8a]" />
      <div className="h-2 flex-1 rounded-full bg-[#cbd5e1]" />
    </div>
  );
}

/* ── Footer ── */
function Footer() {
  const supportHref = supportMailtoHref();
  return (
    <footer className="flex h-[60px] shrink-0 items-center justify-between border-t border-[#1e3a5f] bg-[#0a2540] px-20">
      <span className="text-[12.3px] leading-normal text-[#94a3b8]">
        © 2026 ACTNOTE. All rights reserved.
      </span>
      <nav className="flex gap-8" aria-label="Legal and support">
        <a
          href={supportHref}
          className="text-[12.3px] leading-normal text-[#94a3b8] hover:text-white transition-colors"
        >
          Support
        </a>
        <a
          href={TERMS_OF_SERVICE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12.3px] leading-normal text-[#94a3b8] hover:text-white transition-colors"
        >
          Terms of Service
        </a>
        <a
          href={PRIVACY_POLICY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12.3px] leading-normal text-[#94a3b8] hover:text-white transition-colors"
        >
          Privacy Policy
        </a>
      </nav>
    </footer>
  );
}
