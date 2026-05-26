"use client";

import { Suspense, useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { useMeetings } from "@/lib/hooks/useMeetings";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { createClient } from "@/lib/supabase/client";
import { isProcessing } from "@/lib/types/meeting";
import type { Meeting } from "@/lib/types/meeting";
import {
  MEETINGS_HOME_HIGHLIGHT_PARAM,
  MEETINGS_HOME_TAB_PARAM,
  parseMeetingsHomeTab,
  type MeetingsHomeTab,
} from "@/lib/meetings/post-publish-home";

type Tab = MeetingsHomeTab;
type SortOrder = "newest" | "oldest";

const TABS: { id: Tab; label: string }[] = [
  { id: "all",       label: "All" },
  { id: "analyzing", label: "Analyzing" },
  { id: "drafts",    label: "Drafts" },
  { id: "published", label: "Published" },
];

const PAGE_SIZE = 10;

/** 선택된 필터 탭 색을 MeetingCard 상태 배지와 맞춤 (Analyzing=초록, Draft=노랑, Published=파랑) */
function tabActiveShellClasses(tabId: Tab): string {
  switch (tabId) {
    case "all":
      return "bg-[#f1f5f9] text-[#0a2540]";
    case "analyzing":
      return "bg-[#dcfbe7] text-[#34c759]";
    case "drafts":
      return "bg-amber-50 text-amber-900";
    case "published":
      return "bg-[#e3f2fd] text-[#446f99]";
    default:
      return "bg-[#f1f5f9] text-[#0a2540]";
  }
}

function tabCountBadgeClasses(tabId: Tab, isActive: boolean): string {
  if (!isActive) return "bg-[#f1f5f9] text-[#94a3b8]";
  switch (tabId) {
    case "all":
      return "bg-[#e2e8f0] text-[#64748b]";
    case "analyzing":
      return "bg-[#bbf7d0] text-[#15803d]";
    case "drafts":
      return "bg-amber-100 text-amber-900";
    case "published":
      return "bg-[#cfe8fc] text-[#446f99]";
    default:
      return "bg-[#e2e8f0] text-[#64748b]";
  }
}

/**
 * TC-1: 권한 기반 회의 카드 가시성.
 *  - WS owner/admin: 전부
 *  - Member 생성자: 본인 회의 전부
 *  - Member 참석자: Draft, Published만 (Analyzing/Error 숨김)
 *  - Member 비참석자: Published만
 */
function isMeetingVisibleToUser(
  meeting: Meeting,
  isElevatedWsRole: boolean,
  userId: string | null,
  userEmail: string | null,
): boolean {
  if (isElevatedWsRole) return true;
  if (userId != null && meeting.created_by === userId) return true;

  const isPublished = meeting.approval_status === "published";
  const isDraft = meeting.status === "ready" && !isPublished;
  const participants = meeting.participants ?? [];
  const isParticipant =
    userEmail != null &&
    participants.some((p) => p.toLowerCase() === userEmail.toLowerCase());

  if (isParticipant) return isPublished || isDraft;
  return isPublished;
}

function filterMeetings(meetings: Meeting[], tab: Tab): Meeting[] {
  switch (tab) {
    case "analyzing":
      return meetings.filter((m) => isProcessing(m.status) || m.status === "error");
    case "drafts":    return meetings.filter((m) => m.status === "ready" && m.approval_status !== "published");
    case "published": return meetings.filter((m) => m.approval_status === "published");
    default:          return meetings;
  }
}

function sortMeetings(meetings: Meeting[], order: SortOrder): Meeting[] {
  return [...meetings].sort((a, b) => {
    const da = new Date(a.meeting_date ?? a.created_at).getTime();
    const db = new Date(b.meeting_date ?? b.created_at).getTime();
    return order === "newest" ? db - da : da - db;
  });
}

function MeetingsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { meetings, deleteMeeting, hydrated } = useMeetings();
  const { memberships, workspaceId } = useWorkspaceContext();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  useEffect(() => {
    void (async () => {
      const { data: { user } } = await createClient().auth.getUser();
      setCurrentUserId(user?.id ?? null);
      setCurrentUserEmail(user?.email ?? null);
    })();
  }, []);
  const isElevatedWsRole = useMemo(() => {
    const r = memberships.find((m) => m.workspace_id === workspaceId)?.role;
    return r === "owner" || r === "admin";
  }, [memberships, workspaceId]);

  const tabFromUrl = parseMeetingsHomeTab(searchParams.get(MEETINGS_HOME_TAB_PARAM));
  const highlightId = searchParams.get(MEETINGS_HOME_HIGHLIGHT_PARAM);

  const [activeTab, setActiveTab] = useState<Tab>(tabFromUrl ?? "all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [page, setPage] = useState(1);
  const [deleteBanner, setDeleteBanner] = useState<string | null>(null);

  async function handleDeleteMeeting(id: string): Promise<boolean> {
    setDeleteBanner(null);
    const r = await deleteMeeting(id);
    if (!r.ok) {
      setDeleteBanner(r.error);
      return false;
    }
    return true;
  }

  // 탭 변경 시 페이지 리셋
  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setPage(1);
  }

  function toggleSort() {
    setSortOrder((s) => (s === "newest" ? "oldest" : "newest"));
    setPage(1);
  }

  // TC-1: 권한에 따라 카드 자체를 숨김 (목록·카운트·하이라이트 모두 동일 기준 사용).
  const visibleMeetings = useMemo(
    () =>
      meetings.filter((m) =>
        isMeetingVisibleToUser(m, isElevatedWsRole, currentUserId, currentUserEmail),
      ),
    [meetings, isElevatedWsRole, currentUserId, currentUserEmail],
  );

  const filtered = useMemo(
    () => sortMeetings(filterMeetings(visibleMeetings, activeTab), sortOrder),
    [visibleMeetings, activeTab, sortOrder]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    if (tabFromUrl) setActiveTab(tabFromUrl);
  }, [tabFromUrl]);

  /** 발행 직후: Published 탭 + 해당 회의가 있는 페이지로 맞춘 뒤 카드로 스크롤 */
  useEffect(() => {
    if (!highlightId || !hydrated) return undefined;

    const tab = tabFromUrl ?? "published";
    const list = sortMeetings(filterMeetings(visibleMeetings, tab), sortOrder);
    const idx = list.findIndex((m) => m.id === highlightId);
    if (idx < 0) return undefined;

    setActiveTab(tab);
    setPage(Math.floor(idx / PAGE_SIZE) + 1);

    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`meeting-card-${highlightId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }, 150);

    const cleanUrlTimer = window.setTimeout(() => {
      const params = new URLSearchParams();
      params.set(MEETINGS_HOME_TAB_PARAM, tab);
      router.replace(`/meetings?${params.toString()}`, { scroll: false });
    }, 5000);

    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(cleanUrlTimer);
    };
  }, [highlightId, hydrated, visibleMeetings, tabFromUrl, sortOrder, router]);

  // 탭별 카운트 — TC-1 권한 필터링 후 visibleMeetings 기준.
  const counts: Record<Tab, number> = useMemo(() => ({
    all:       visibleMeetings.length,
    analyzing: visibleMeetings.filter((m) => isProcessing(m.status) || m.status === "error").length,
    drafts:    visibleMeetings.filter((m) => m.status === "ready" && m.approval_status !== "published").length,
    published: visibleMeetings.filter((m) => m.approval_status === "published").length,
  }), [visibleMeetings]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader title="Home" />

      <div className="flex-1 overflow-auto p-10">
        {deleteBanner && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex justify-between gap-4 items-start">
            <span>{deleteBanner}</span>
            <button
              type="button"
              onClick={() => setDeleteBanner(null)}
              className="shrink-0 font-semibold text-red-900 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}
        {/* Toolbar */}
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          {/* 필터 탭 */}
          <div className="flex items-center gap-1">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-[14px] font-bold transition-colors ${
                  isActive
                    ? tabActiveShellClasses(tab.id)
                    : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
                }`}
              >
                {tab.label}
                {hydrated && counts[tab.id] > 0 && (
                  <span className={`rounded-full px-1.5 py-px text-[11px] font-bold ${tabCountBadgeClasses(tab.id, isActive)}`}>
                    {counts[tab.id]}
                  </span>
                )}
              </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            {/* 날짜 정렬 */}
            <button
              onClick={toggleSort}
              className="flex items-center gap-1.5 rounded-lg border border-[#e2e8f0] bg-white px-3 py-2 text-[13px] font-semibold text-[#64748b] hover:bg-[#f8fafc] transition-colors"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortOrder === "newest" ? "Newest first" : "Oldest first"}
            </button>

            {/* New Meeting */}
            <Link
              href="/meetings/new"
              className="flex h-10 items-center gap-2 rounded-[10px] px-5 text-[14px] font-bold text-white shadow-[0px_4px_6px_rgba(255,107,53,0.2)] hover:opacity-90 transition-opacity"
              style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
            >
              + New Meeting
            </Link>
          </div>
        </div>

        {/* Grid */}
        {!hydrated ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[178px] rounded-xl border border-[#e2e8f0] bg-white animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[16px] font-semibold text-[#0a2540]">
              {activeTab === "all" ? "No meetings yet" : `No ${activeTab} meetings`}
            </p>
            <p className="mt-1 text-sm text-[#64748b]">
              {activeTab === "all" ? "Create your first meeting to get started." : "Try a different filter."}
            </p>
            {activeTab === "all" && (
              <Link
                href="/meetings/new"
                className="mt-6 flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold text-white hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
              >
                + New Meeting
              </Link>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {paginated.map((meeting) => {
                // TC-2: Published 상태에선 owner/admin만 삭제 가능. 생성자 Member는 발행 전까지만.
                const isPublished = meeting.approval_status === "published";
                const canDelete = isElevatedWsRole
                  ? true
                  : currentUserId != null &&
                    meeting.created_by === currentUserId &&
                    !isPublished;
                return (
                  <MeetingCard
                    key={meeting.id}
                    meeting={meeting}
                    highlighted={highlightId === meeting.id}
                    onDelete={handleDeleteMeeting}
                    canDelete={canDelete}
                    onClick={() => router.push(`/meetings/${meeting.id}`)}
                  />
                );
              })}
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="mt-8 flex items-center justify-between">
                <p className="text-[13px] text-[#64748b]">
                  Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length} meetings
                </p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage === 1}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-40 disabled:cursor-default transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((n) => n === 1 || n === totalPages || Math.abs(n - safePage) <= 1)
                    .reduce<(number | "…")[]>((acc, n, idx, arr) => {
                      if (idx > 0 && n - (arr[idx - 1] as number) > 1) acc.push("…");
                      acc.push(n);
                      return acc;
                    }, [])
                    .map((item, i) =>
                      item === "…" ? (
                        <span key={`ellipsis-${i}`} className="px-1 text-[13px] text-[#94a3b8]">…</span>
                      ) : (
                        <button
                          key={item}
                          onClick={() => setPage(item as number)}
                          className={`flex h-8 w-8 items-center justify-center rounded-lg text-[13px] font-bold transition-colors ${
                            safePage === item
                              ? "bg-[#ff6b35] text-white shadow-sm"
                              : "border border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc]"
                          }`}
                        >
                          {item}
                        </button>
                      )
                    )}

                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage === totalPages}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e2e8f0] text-[#64748b] hover:bg-[#f8fafc] disabled:opacity-40 disabled:cursor-default transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function MeetingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-1 flex-col overflow-hidden">
          <DashboardHeader title="Home" />
          <div className="flex-1 overflow-auto p-10">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-[178px] rounded-xl border border-[#e2e8f0] bg-white animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      }
    >
      <MeetingsPageContent />
    </Suspense>
  );
}
