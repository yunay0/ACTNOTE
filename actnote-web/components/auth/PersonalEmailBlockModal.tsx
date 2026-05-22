"use client";

type Props = {
  domain: string;
  onRetry: () => void;
};

/**
 * OAuth 콜백에서 개인 이메일 도메인이 감지됐을 때 노출하는 블로킹 모달.
 * error=personal_email&domain=gmail.com 파라미터로 트리거된다.
 */
export function PersonalEmailBlockModal({ domain, onRetry }: Props) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">

        {/* 아이콘 영역 */}
        <div className="mb-6 flex justify-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-[#fef2f2]">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden
            >
              <path
                d="M16 4C9.373 4 4 9.373 4 16s5.373 12 12 12 12-5.373 12-12S22.627 4 16 4Z"
                fill="#fecaca"
              />
              <path
                d="M16 10v7M16 21v1"
                stroke="#dc2626"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>

        <h2 className="mb-3 text-center text-xl font-bold text-[#0a2540]">
          Personal Account Not Supported
        </h2>

        <p className="mb-5 text-center text-[14px] leading-relaxed text-[#64748b]">
          ACTNOTE is only available for company workspaces.
          <br />
          Personal email accounts (e.g., Gmail) cannot access this service.
        </p>

        {/* 감지된 도메인 표시 */}
        <div className="mb-8 rounded-xl border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] text-[#991b1b]">
          <span className="font-semibold">Your Account: </span>
          Personal
          {domain ? (
            <>
              {" "}
              <span className="font-mono">(@{domain})</span>
            </>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onRetry}
          className="w-full rounded-xl py-3 text-[15px] font-bold text-white shadow-md transition-opacity hover:opacity-90"
          style={{
            background: "linear-gradient(135deg, #2563eb 0%, #4f46e5 100%)",
          }}
        >
          Sign In With Company Account
        </button>
      </div>
    </div>
  );
}
