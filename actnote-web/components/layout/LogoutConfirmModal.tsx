"use client";

export type LogoutConfirmModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  confirming?: boolean;
};

/** Figma 202:11014 — Log out confirmation before redirecting to landing page. */
export function LogoutConfirmModal({
  open,
  onClose,
  onConfirm,
  confirming,
}: LogoutConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1a2b4a]/50 px-5"
      role="presentation"
    >
      <button
        type="button"
        aria-label="Close logout confirmation"
        className="absolute inset-0"
        disabled={confirming}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="logout-modal-title"
        className="relative z-[101] w-full max-w-[440px] overflow-hidden rounded-2xl bg-white shadow-[0px_20px_60px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center gap-[9px] px-8 py-8">
          <div
            className="flex size-16 shrink-0 items-center justify-center rounded-[32px] bg-[#fff4ee]"
            aria-hidden
          >
            <span className="text-[36px] leading-none">🚪</span>
          </div>

          <h2
            id="logout-modal-title"
            className="pt-[11px] text-center text-[20px] font-bold text-[#212529]"
          >
            Log out of ACTNOTE?
          </h2>

          <p className="text-center text-[14px] leading-[22.4px] text-[#6c757d]">
            You can sign back in anytime with your Google account
          </p>

          <div className="flex w-full justify-center gap-[10px] pt-[15px]">
            <button
              type="button"
              disabled={confirming}
              onClick={onClose}
              className="flex h-[46px] w-[184px] items-center justify-center rounded-[10px] border border-[#dee2e6] bg-white text-[14px] font-medium text-[#495057] transition-colors hover:bg-[#f8fafc] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={onConfirm}
              className="flex h-[46px] w-[182px] items-center justify-center rounded-[10px] bg-[#f26522] text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {confirming ? (
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "Log Out"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
