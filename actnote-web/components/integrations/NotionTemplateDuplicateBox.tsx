const MEETING_TEMPLATE_URL = process.env.NEXT_PUBLIC_NOTION_TEMPLATE_MEETING_URL ?? "";
const TICKET_TEMPLATE_URL = process.env.NEXT_PUBLIC_NOTION_TEMPLATE_TICKET_URL ?? "";

function TemplateLink({
  href,
  label,
  compact = false,
}: {
  href: string;
  label: string;
  compact?: boolean;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        compact
          ? "inline-flex items-center gap-1 text-[12px] font-semibold text-[#F26522] hover:underline"
          : "mt-1 flex w-fit items-center gap-[6px] text-[13px] font-semibold text-[#F26522] hover:underline"
      }
    >
      {label}
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden>
        <path
          d="M2 9L9 2M9 2H4.5M9 2V6.5"
          stroke="#F26522"
          strokeWidth="1.375"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}

/** F4 — settings/onboarding 공통 Notion 템플릿 duplicate 안내 */
export function NotionTemplateDuplicateBox({
  variant = "both",
  compact = false,
}: {
  variant?: "meeting" | "ticket" | "both";
  compact?: boolean;
}) {
  const showMeeting = variant === "meeting" || variant === "both";
  const showTicket = variant === "ticket" || variant === "both";
  const hasMeeting = Boolean(MEETING_TEMPLATE_URL);
  const hasTicket = Boolean(TICKET_TEMPLATE_URL);
  if ((showMeeting && !hasMeeting) && (showTicket && !hasTicket)) return null;
  if (showMeeting && !showTicket && !hasMeeting) return null;
  if (showTicket && !showMeeting && !hasTicket) return null;

  if (compact) {
    return (
      <div className="flex flex-col gap-1 pt-1">
        {showMeeting && hasMeeting ? (
          <TemplateLink href={MEETING_TEMPLATE_URL} label="📄 Meeting Notes Template" compact />
        ) : null}
        {showTicket && hasTicket ? (
          <TemplateLink href={TICKET_TEMPLATE_URL} label="🎫 Action Items Template" compact />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[6px] rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-4 pt-6 pb-[14px]">
      <p className="text-[13px] font-semibold text-[#92400E]">Don&apos;t have a Notion database yet?</p>
      <p className="text-[12px] leading-[19px] text-[#78350F]">
        Use our pre-built templates — all required fields are already set up. Duplicate to your Notion workspace,
        then paste the database URL.
      </p>
      {showMeeting && hasMeeting ? (
        <TemplateLink href={MEETING_TEMPLATE_URL} label="📄 Meeting Notes Template" />
      ) : null}
      {showTicket && hasTicket ? (
        <TemplateLink href={TICKET_TEMPLATE_URL} label="🎫 Action Items Template" />
      ) : null}
    </div>
  );
}
