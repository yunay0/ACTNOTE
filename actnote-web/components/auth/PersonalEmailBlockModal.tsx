"use client";

type Props = {
  domain: string;
  onRetry: () => void;
};

/**
 * OAuth 콜백에서 개인 이메일 도메인이 감지됐을 때 노출하는 블로킹 모달.
 * error=personal_email&domain=gmail.com 파라미터로 트리거된다.
 * 디자인: Figma S-04-01 div.modal
 */
export function PersonalEmailBlockModal({ domain, onRetry }: Props) {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div
        className="flex w-full max-w-[480px] flex-col items-center rounded-2xl bg-white"
        style={{
          padding: 32,
          gap: 12,
          boxShadow: "0px 20px 60px rgba(10, 37, 64, 0.3)",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* 아이콘 */}
        <div
          className="flex shrink-0 items-center justify-center"
          style={{
            width: 64,
            height: 64,
            background: "#FEE2E2",
            borderRadius: 32,
          }}
        >
          <span style={{ fontSize: 24, lineHeight: "29px" }} aria-hidden>
            🚫
          </span>
        </div>

        {/* 제목 */}
        <h2
          className="w-full text-center font-bold text-[#0a2540]"
          style={{
            fontSize: 23.6,
            lineHeight: "29px",
            paddingTop: 12,
            paddingBottom: 1,
          }}
        >
          Personal Account Not Supported
        </h2>

        {/* 본문 메시지 */}
        <p
          className="w-full text-center text-[#64748b]"
          style={{
            fontSize: 14.3,
            lineHeight: "24px",
            paddingBottom: 12,
            maxWidth: 356,
          }}
        >
          ACTNOTE is only available for company workspaces. Personal Gmail
          accounts cannot access this service.
        </p>

        {/* 상세 정보 박스 */}
        <div
          className="flex w-full flex-col"
          style={{
            padding: 16,
            gap: 8,
            background: "#F8FAFC",
            borderRadius: 10,
          }}
        >
          {/* Row 1: Your Account */}
          <div className="flex w-full flex-row items-center justify-between">
            <span
              className="text-[#64748b]"
              style={{ fontSize: 13.2, lineHeight: "16px" }}
            >
              Your Account:
            </span>
            <span
              className="font-bold text-[#0a2540]"
              style={{ fontSize: 13.8, lineHeight: "17px" }}
            >
              Personal{domain ? ` (@${domain})` : ""}
            </span>
          </div>

          {/* Row 2: Required */}
          <div className="flex w-full flex-row items-center justify-between">
            <span
              className="text-[#64748b]"
              style={{ fontSize: 14, lineHeight: "17px" }}
            >
              Required:
            </span>
            <span
              className="font-bold text-[#0a2540]"
              style={{ fontSize: 13.7, lineHeight: "17px" }}
            >
              Company Email (@company.com)
            </span>
          </div>
        </div>

        {/* Why? 설명 */}
        <p
          className="w-full text-center font-bold text-[#0a2540]"
          style={{
            fontSize: 13.3,
            lineHeight: "22px",
            paddingTop: 11.39,
            paddingBottom: 12,
          }}
        >
          Why? ACTNOTE is designed for team collaboration and requires a company
          Google Workspace account to ensure secure, shared access within your
          organization.
        </p>

        {/* CTA 버튼 */}
        <button
          type="button"
          onClick={onRetry}
          className="w-full font-['Roboto',sans-serif] font-bold text-white"
          style={{
            height: 48,
            background: "linear-gradient(96.58deg, #FF6B35 0%, #FF8555 100%)",
            boxShadow: "0px 4px 12px rgba(255, 107, 53, 0.25)",
            borderRadius: 10,
            fontSize: 15,
            lineHeight: "18px",
          }}
        >
          Sign In with Company Account
        </button>
      </div>
    </div>
  );
}
