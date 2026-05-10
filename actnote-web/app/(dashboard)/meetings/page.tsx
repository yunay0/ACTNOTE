"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { MeetingCard } from "@/components/meetings/MeetingCard";
import { useMeetings } from "@/lib/hooks/useMeetings";
import { isProcessing } from "@/lib/types/meeting";
import type { Meeting } from "@/lib/types/meeting";

type Tab = "all" | "analyzing" | "drafts" | "published";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "analyzing", label: "Analyzing" },
  { id: "drafts", label: "Drafts" },
  { id: "published", label: "Published" },
];

function filterMeetings(meetings: Meeting[], tab: Tab): Meeting[] {
  switch (tab) {
    case "analyzing": return meetings.filter((m) => isProcessing(m.status));
    case "drafts":    return meetings.filter((m) => m.status === "ready");
    case "published": return meetings.filter((m) => m.status === "published");
    default:          return meetings;
  }
}

export default function MeetingsPage() {
  const router = useRouter();
  const { meetings, deleteMeeting, hydrated } = useMeetings();
  const [activeTab, setActiveTab] = useState<Tab>("all");

  const filtered = filterMeetings(meetings, activeTab);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader title="Home" />

      <div className="flex-1 overflow-auto p-10">
        {/* Toolbar */}
        <div className="mb-8 flex items-center justify-between">
          {/* Filter tabs */}
          <div className="flex items-center gap-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg px-4 py-2 text-[14px] font-bold transition-colors ${
                  activeTab === tab.id
                    ? "bg-[#fff4f0] text-[#ff6b35]"
                    : "text-[#64748b] hover:bg-[#f8fafc] hover:text-[#0a2540]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* New Meeting button */}
          <Link
            href="/meetings/new"
            className="flex h-11 items-center gap-2 rounded-[10px] px-6 text-[15px] font-bold text-white shadow-[0px_4px_6px_rgba(255,107,53,0.2)] hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
          >
            + New Meeting
          </Link>
        </div>

        {/* Grid */}
        {!hydrated ? (
          <div className="grid grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-[178px] rounded-xl border border-[#e2e8f0] bg-white animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[16px] font-semibold text-[#0a2540]">No meetings yet</p>
            <p className="mt-1 text-sm text-[#64748b]">
              {activeTab === "all" ? "Create your first meeting to get started." : `No ${activeTab} meetings.`}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                onDelete={deleteMeeting}
                onClick={() => router.push(`/meetings/${meeting.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
