"use client";

function initialsFromName(name: string): string {
  const t = name.trim();
  if (!t) return "??";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0];
    const b = parts[parts.length - 1]?.[0];
    if (a && b) return `${a}${b}`.toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

const AVATAR_GRADIENT = "linear-gradient(135deg, rgb(46,92,138) 0%, rgb(30,58,95) 100%)";

export type PostLoginAccountModalProps = {
  /** Primary line (display name). */
  displayName: string;
  email: string | null;
  avatarUrl?: string | null;
  /** Invoked when user confirms this session (row click). */
  onContinue: () => void;
  onUseAnotherAccount: () => void | Promise<void>;
  onCancel: () => void;
};

/** Figma 146:7811 — Choose an account to continue (Google-picker style). */
export function PostLoginAccountModal({
  displayName,
  email,
  avatarUrl,
  onContinue,
  onUseAnotherAccount,
  onCancel,
}: PostLoginAccountModalProps) {
  const initials = initialsFromName(displayName);
  const safeEmail = (email ?? "").trim();

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(10,37,64,0.6)] px-4 backdrop-blur-[2px]"
      role="presentation"
    >
      <div
        className="w-full max-w-[480px] rounded-[16px] bg-white p-8 shadow-[0px_20px_30px_rgba(10,37,64,0.3)]"
        role="dialog"
        aria-labelledby="account-picker-title"
        aria-describedby="account-picker-description"
      >
        <div className="flex flex-col items-center text-center">
          <p className="text-[15px] font-bold leading-6 text-[#64748b]">ACTNOTE</p>
          <h1
            id="account-picker-title"
            className="mt-px text-[23.6px] font-bold leading-tight text-[#0a2540]"
          >
            Choose an account
          </h1>
          <p id="account-picker-description" className="mt-px text-[14.3px] leading-6 text-[#64748b]">
            <span className="leading-6">to continue to </span>
            <span className="font-bold text-[#0a2540]">ACTNOTE</span>
          </p>
        </div>

        <div className="h-[18px]" aria-hidden />

        <div className="mx-auto w-full max-w-[394px]">
          <ul className="flex flex-col gap-[9px]">
            <li>
              <button
                type="button"
                onClick={onContinue}
                className="flex w-full items-center gap-3 rounded-[12px] bg-[#f1f5f9] px-4 py-2.5 text-left transition-colors hover:bg-[#e2e8f0]"
              >
                {avatarUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={avatarUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="size-12 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <div
                    className="flex size-12 shrink-0 items-center justify-center rounded-full text-[18px] font-bold text-white"
                    style={{ backgroundImage: AVATAR_GRADIENT }}
                    aria-hidden
                  >
                    {initials}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-[#0a2540]">
                    {(displayName || "Account").trim() || "Account"}
                  </p>
                  {safeEmail ? (
                    <p className="truncate text-[12.5px] text-[#64748b]">{safeEmail}</p>
                  ) : null}
                </div>
              </button>
            </li>
          </ul>

          <div className="h-[18px]" aria-hidden />

          <button
            type="button"
            onClick={() => void onUseAnotherAccount()}
            className="flex w-full items-center gap-3 rounded-[12px] px-4 py-2.5 text-left transition-colors hover:bg-[#f8fafc]"
          >
            <div
              className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-[#64748b]"
              aria-hidden
            >
              <span className="pb-0.5 text-2xl font-normal leading-none text-[#64748b]">+</span>
            </div>
            <div className="px-[5px]">
              <p className="text-[15px] font-bold text-[#0a2540]">Use another account</p>
            </div>
          </button>
        </div>

        <div className="h-[18px]" aria-hidden />

        <div className="mx-auto w-full max-w-[396px]">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-[52px] w-full items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] bg-white text-[16px] font-bold text-[#64748b] transition-colors hover:bg-[#f8fafc]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
