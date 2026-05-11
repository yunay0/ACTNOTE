"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { useMeetings } from "@/lib/hooks/useMeetings";
import { isProcessing } from "@/lib/types/meeting";
import type { Meeting } from "@/lib/types/meeting";

type Tab = "all" | "analyzing" | "drafts" | "published";
type SortOrder = "newest" | "oldest";

const TABS: { id: Tab; label: string }[] = [
  { id: "all",       label: "All" },
  { id: "analyzing", label: "Analyzing" },
  { id: "drafts",    label: "Drafts" },
  { id: "published", label: "Published" },
];

const PAGE_SIZE = 10;

function filterMeetings(meetings: Meeting[], tab: Tab): Meeting[] {
  switch (tab) {
    case "analyzing": return meetings.filter((m) => isProcessing(m.status));
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

export default function MeetingsPage() {
  const router = useRouter();
  const { meetings, deleteMeeting, hydrated } = useMeetings();

  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [page, setPage] = useState(1);

  // 탭 변경 시 페이지 리셋
  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    setPage(1);
  }

  function toggleSort() {
    setSortOrder((s) => (s === "newest" ? "oldest" : "newest"));
    setPage(1);
  }

  const filtered = useMemo(
    () => sortMeetings(filterMeetings(meetings, activeTab), sortOrder),
    [meetings, activeTab, sortOrder]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // 탭별 카운트
  const counts: Record<Tab, number> = useMemo(() => ({
    all:       meetings.length,
    analyzing: meetings.filter((m) => isProcessing(m.status)).length,
    drafts:    meetings.filter((m) => m.status === "ready" && m.approval_status !== "published").length,
    published: meetings.filter((m) => m.approval_status === "published").length,
  }), [meetings]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader title="Home" />

      <div className="flex-1 overflow-auto p-10">
        {/* Toolbar */}
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          {/* 필터 탭 */}
          <div className="flex items-center gap-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-[14px] font-bold transition-colors ${
                  activeTab === tab.id
                    ? "bg-[#fff4f0] text-[#ff6b35]"
                    : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
                }`}
              >
                {tab.label}
                {hydrated && counts[tab.id] > 0 && (
                  <span className={`rounded-full px-1.5 py-px text-[11px] font-bold ${
                    activeTab === tab.id ? "bg-[#ff6b35]/10 text-[#ff6b35]" : "bg-[#f1f5f9] text-[#94a3b8]"
                  }`}>
                    {counts[tab.id]}
                  </span>
                )}
              </button>
            ))}
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
              {paginated.map((meeting) => (
                <MeetingCard
                  key={meeting.id}
                  meeting={meeting}
                  onDelete={deleteMeeting}
                  onClick={() => router.push(`/meetings/${meeting.id}`)}
                />
              ))}
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
