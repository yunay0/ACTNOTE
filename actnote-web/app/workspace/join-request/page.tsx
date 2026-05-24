"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { OnboardingHeader } from "@/components/onboarding/OnboardingHeader";

interface RequestInfo {
  id: string;
  status: string;
  message: string | null;
  created_at: string;
}

interface RequesterInfo {
  name: string | null;
  email: string;
}

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  meetingCount: number;
}

type PageState =
  | "loading"
  | "review"
  | "approved"
  | "rejected"
  | "not_found"
  | "forbidden"
  | "already_reviewed"
  | "error";

function userInitials(name: string | null, email: string): string {
  const trimmed = (name ?? "").trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
    return trimmed.slice(0, 2).toUpperCase();
  }
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}

function workspaceInitial(name: string): string {
  const t = name.trim();
  return t ? t[0]!.toUpperCase() : "?";
}

export default function JoinRequestReviewPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-[#ff6b35]" />
        </div>
      }
    >
      <JoinRequestReviewInner />
    </Suspense>
  );
}

function JoinRequestReviewInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("id") ?? "";

  const [pageState, setPageState] = useState<PageState>("loading");
  const [request, setRequest] = useState<RequestInfo | null>(null);
  const [requester, setRequester] = useState<RequesterInfo | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activeAction, setActiveAction] = useState<"approved" | "rejected" | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!requestId) {
      router.replace("/workspace/select");
      return;
    }

    async function load() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase: any = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        const next = `/workspace/join-request?id=${encodeURIComponent(requestId)}`;
        router.push(`/login?next=${encodeURIComponent(next)}`);
        return;
      }

      const res = await fetch(`/api/workspace/join-request/${requestId}`, {
        credentials: "include",
      });

      if (res.status === 404) {
        setPageState("not_found");
        return;
      }
      if (res.status === 403) {
        setPageState("forbidden");
        return;
      }
      if (!res.ok) {
        setErrorMsg("Failed to load request.");
        setPageState("error");
        return;
      }

      const data = (await res.json()) as {
        request: RequestInfo;
        requester: RequesterInfo;
        workspace: WorkspaceInfo;
      };

      setRequest(data.request);
      setRequester(data.requester);
      setWorkspace(data.workspace);

      if (data.request.status === "approved") {
        setPageState("approved");
      } else if (data.request.status === "rejected") {
        setPageState("rejected");
      } else {
        setPageState("review");
      }
    }

    void load();
  }, [requestId, router]);

  async function handleAction(action: "approved" | "rejected") {
    if (!requestId || submitting) return;
    setSubmitting(true);
    setActiveAction(action);

    const res = await fetch(`/api/workspace/join-request/${requestId}/review`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });

    const body = (await res.json().catch(() => ({}))) as { error?: string };

    if (!res.ok) {
      if (body.error === "request_already_reviewed") {
        setPageState("already_reviewed");
      } else {
        setErrorMsg(body.error ?? "An error occurred.");
        setPageState("error");
      }
      setSubmitting(false);
      setActiveAction(null);
      return;
    }

    setPageState(action === "approved" ? "approved" : "rejected");
    setSubmitting(false);
    setActiveAction(null);
  }

  // ─── 공통 에러 화면 ──────────────────────────────────────────────────────────
  function ErrorScreen({ message }: { message: string }) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <OnboardingHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4">
          <p className="max-w-[400px] text-center text-[17px] font-semibold text-[#0a2540]">{message}</p>
          <button
            type="button"
            onClick={() => router.push("/meetings")}
            className="flex h-[52px] items-center justify-center rounded-[10px] px-8 text-[16px] font-bold text-white"
            style={{ background: "#FF6B35" }}
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  if (pageState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff6b35]" />
      </div>
    );
  }
  if (pageState === "not_found") return <ErrorScreen message="Request not found." />;
  if (pageState === "forbidden") return <ErrorScreen message="You don't have permission to review this request." />;
  if (pageState === "already_reviewed") return <ErrorScreen message="This request has already been reviewed." />;
  if (pageState === "error") return <ErrorScreen message={errorMsg || "An error occurred."} />;

  if (!workspace || !requester) return null;

  const wsInitial = workspaceInitial(workspace.name);
  const reqInitials = userInitials(requester.name, requester.email);
  const requesterDisplayName =
    requester.name?.trim() || requester.email.split("@")[0] || "Unknown";

  // ─── S-05-01: 검토 화면 ─────────────────────────────────────────────────────
  if (pageState === "review") {
    return (
      <div className="min-h-screen bg-white">
        <OnboardingHeader />
        <div className="flex justify-center px-4 pb-20 pt-[80px]">
          <div className="flex w-full max-w-[520px] flex-col gap-6">

            {/* 진행 표시줄 */}
            <div className="flex gap-3">
              <div className="h-1 flex-1 rounded-[2px] bg-[#2e5c8a]" />
              <div className="h-1 flex-1 rounded-[2px] bg-[#ff6b35]" />
            </div>

            {/* 제목 + 부제목 */}
            <div className="flex flex-col gap-3">
              <h1 className="text-[34.3px] font-bold leading-[43px] text-[#0a2540]">
                Someone wants to join your workspace 👥
              </h1>
              <p className="text-[15px] leading-[18px] text-[#64748b]">
                A new member is requesting access to your workspace.
              </p>
            </div>

            {/* 워크스페이스 정보 */}
            <div className="flex h-[82px] w-full items-center justify-center gap-4 rounded-lg border border-[#e2e8f0]">
              <div
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white"
                style={{ background: "linear-gradient(135deg, #FF6B35 0%, #FF8555 100%)" }}
              >
                {wsInitial}
              </div>
              <div className="flex flex-col">
                <p className="text-[20px] font-bold leading-[23px] text-[#0a2540]">{workspace.name}</p>
                <p className="text-[14px] leading-[16px] text-[#64748b]">
                  {workspace.memberCount} members • {workspace.meetingCount} meetings
                </p>
              </div>
            </div>

            {/* 요청자 카드 */}
            <div className="flex h-[173px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-[#e2e8f0] bg-[#f8fafc]">
              <div
                className="flex size-[60px] items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ background: "linear-gradient(135deg, #4285F4 0%, #34A853 100%)" }}
              >
                {reqInitials}
              </div>
              <p className="text-[20px] font-bold leading-[23px] text-[#64748b]">{requesterDisplayName}</p>
              <p className="text-[15px] leading-[18px] text-[#0a2540]">{requester.email}</p>
            </div>

            {/* 선택적 메시지 */}
            {request?.message && (
              <div className="rounded-lg border border-[#e2e8f0] bg-[#f8fafc] px-4 py-3">
                <p className="text-[13px] font-semibold text-[#0a2540]">Message from requester</p>
                <p className="mt-1 text-[13px] leading-[21px] text-[#64748b]">{request.message}</p>
              </div>
            )}

            {/* 초대 만료 안내 박스 */}
            <div className="rounded-xl bg-white px-6 py-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[20px]" aria-hidden>⏰</span>
                <span className="text-[14px] font-bold leading-[17px] text-[#0f172a]">Invitation Expiry</span>
              </div>
              <p className="text-[13px] leading-[21px] text-[#475569]">
                This request will expire in 7 days. If you don&apos;t recognize this person,
                you can safely ignore this request. You can send invitations from workspace
                settings if needed.
              </p>
            </div>

            {/* 버튼 그룹: Decline + Approve */}
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => void handleAction("rejected")}
                disabled={submitting}
                className="flex h-[52px] flex-1 items-center justify-center rounded-[10px] border-2 border-[#e2e8f0] text-[16px] font-bold text-[#64748b] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting && activeAction === "rejected" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Decline"
                )}
              </button>
              <button
                type="button"
                onClick={() => void handleAction("approved")}
                disabled={submitting}
                className="flex h-[52px] flex-1 items-center justify-center rounded-[10px] text-[16px] font-bold text-white shadow-[0px_4px_16px_rgba(255,107,53,0.25)] transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: "linear-gradient(98.7deg, #FF6B35 0%, #FF8555 100%)" }}
              >
                {submitting && activeAction === "approved" ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  "Approve"
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── S-05-02-01: 승인 완료 ───────────────────────────────────────────────────
  if (pageState === "approved") {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <OnboardingHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-12 pb-12">

          {/* 성공 아이콘 */}
          <div
            className="mb-6 flex size-[80px] shrink-0 items-center justify-center rounded-full shadow-[0px_8px_24px_rgba(16,185,129,0.3)]"
            style={{ background: "linear-gradient(135deg, #10B981 0%, #059669 100%)" }}
          >
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M8.33 21.25L16.25 29.17L31.67 13.75"
                stroke="white"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          {/* 제목 */}
          <h1 className="mb-1 max-w-[420px] text-center text-[36px] font-bold leading-[44px] text-[#0f172a]">
            New member approved!
          </h1>

          {/* 부제목 */}
          <p className="mb-3 max-w-[600px] text-center text-[18px] leading-[22px] text-[#475569]">
            This member has been added to your workspace.
          </p>

          {/* 워크스페이스 정보 */}
          <div className="flex h-[82px] w-full max-w-[700px] items-center justify-center gap-4 rounded-lg border border-[#e2e8f0]">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white"
              style={{ background: "linear-gradient(135deg, #FF6B35 0%, #FF8555 100%)" }}
            >
              {wsInitial}
            </div>
            <div className="flex flex-col">
              <p className="text-[20px] font-bold leading-[23px] text-[#0a2540]">{workspace.name}</p>
              <p className="text-[14px] leading-[16px] text-[#64748b]">
                {workspace.memberCount + 1} members • {workspace.meetingCount} meetings
              </p>
            </div>
          </div>

          {/* Invitation Summary */}
          <div className="mb-3 w-full max-w-[700px] rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-8 pb-[26px] pt-8">
            <div className="mb-6 flex items-center border-b border-[#e2e8f0] pb-4">
              <p className="text-[16px] font-bold text-[#0f172a]">Approved Team Member</p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-4 py-3">
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-[18px] text-[14px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #4285F4 0%, #34A853 100%)" }}
              >
                {reqInitials}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-[13.9px] font-bold leading-[17px] text-[#0a2540]">{requesterDisplayName}</p>
                <p className="text-[12.3px] leading-[15px] text-[#64748b]">{requester.email}</p>
              </div>
              <div className="shrink-0 rounded-[6px] bg-[#e3f2fd] px-3 py-1">
                <span className="text-[12px] font-bold text-[#1e3a5f]">Member</span>
              </div>
            </div>
          </div>

          {/* Go to Home */}
          <button
            type="button"
            onClick={() => router.push("/meetings")}
            className="flex h-14 w-[177px] items-center justify-center gap-2 rounded-xl text-[16px] font-bold text-white"
            style={{ background: "#FF6B35" }}
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  // ─── S-05-02-02: 거절 완료 ───────────────────────────────────────────────────
  if (pageState === "rejected") {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <OnboardingHeader />
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-12 pb-12">

          {/* 거절 아이콘 */}
          <div
            className="mb-6 flex size-[80px] shrink-0 items-center justify-center rounded-full shadow-[0px_4px_10px_rgba(255,107,53,0.5)]"
            style={{
              background: "linear-gradient(180deg, #FF8150 0%, rgba(242,72,34,0.88) 100%)",
            }}
          >
            <span
              className="font-bold text-white"
              style={{ fontSize: 29, lineHeight: "35px", letterSpacing: "0.01em" }}
              aria-hidden
            >
              ❌
            </span>
          </div>

          {/* 제목 */}
          <h1 className="mb-1 max-w-[317px] text-center text-[36px] font-bold leading-[44px] text-[#0f172a]">
            Request declined.
          </h1>

          {/* 부제목 */}
          <p className="mb-3 max-w-[600px] text-center text-[18px] leading-[22px] text-[#475569]">
            This request has been declined.
          </p>

          {/* 워크스페이스 정보 */}
          <div className="flex h-[82px] w-full max-w-[700px] items-center justify-center gap-4 rounded-lg border border-[#e2e8f0]">
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-xl font-bold text-white"
              style={{ background: "linear-gradient(135deg, #FF6B35 0%, #FF8555 100%)" }}
            >
              {wsInitial}
            </div>
            <div className="flex flex-col">
              <p className="text-[20px] font-bold leading-[23px] text-[#0a2540]">{workspace.name}</p>
              <p className="text-[14px] leading-[16px] text-[#64748b]">
                {workspace.memberCount} members • {workspace.meetingCount} meetings
              </p>
            </div>
          </div>

          {/* Invitation Summary */}
          <div className="mb-3 w-full max-w-[700px] rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] px-8 pb-[26px] pt-8">
            <div className="mb-6 flex items-center border-b border-[#e2e8f0] pb-4">
              <p className="text-[16px] font-bold text-[#0f172a]">Declined Request</p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border border-[#e2e8f0] bg-white px-4 py-3">
              <div
                className="flex size-9 shrink-0 items-center justify-center rounded-[18px] text-[14px] font-bold text-white"
                style={{ background: "linear-gradient(135deg, #4285F4 0%, #34A853 100%)" }}
              >
                {reqInitials}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="text-[13.9px] font-bold leading-[17px] text-[#0a2540]">{requesterDisplayName}</p>
                <p className="text-[12.3px] leading-[15px] text-[#64748b]">{requester.email}</p>
              </div>
            </div>
          </div>

          {/* Go to Home */}
          <button
            type="button"
            onClick={() => router.push("/meetings")}
            className="flex h-14 w-[177px] items-center justify-center gap-2 rounded-xl text-[16px] font-bold text-white"
            style={{ background: "#FF6B35" }}
          >
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  return null;
}
