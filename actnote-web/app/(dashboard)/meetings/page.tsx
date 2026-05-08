"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, ChevronDown, SlidersHorizontal, MoreHorizontal, Trash2 } from "lucide-react";
import { useMeetings } from "@/lib/hooks/useMeetings";
import { STATUS_DISPLAY, isProcessing } from "@/lib/types/meeting";
import type { Meeting, MeetingStatus } from "@/lib/types/meeting";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<MeetingStatus, string> = {
  uploaded:    "bg-slate-100 text-slate-600 border-slate-200",
  transcribing:"bg-orange-50 text-orange-600 border-orange-200",
  diarizing:   "bg-orange-50 text-orange-600 border-orange-200",
  summarizing: "bg-orange-50 text-orange-600 border-orange-200",
  ready:       "bg-slate-100 text-slate-600 border-slate-300",
  published:   "bg-green-50 text-green-700 border-green-200",
  error:       "bg-red-50 text-red-600 border-red-200",
};

const STATUS_DOT: Record<MeetingStatus, string> = {
  uploaded:    "bg-slate-400",
  transcribing:"bg-orange-400 animate-pulse",
  diarizing:   "bg-orange-400 animate-pulse",
  summarizing: "bg-orange-400 animate-pulse",
  ready:       "bg-slate-400",
  published:   "bg-green-500",
  error:       "bg-red-500",
};

function StatusPill({ status }: { status: MeetingStatus }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
      STATUS_STYLES[status]
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_DOT[status])} />
      {STATUS_DISPLAY[status]}
    </span>
  );
}

function RowMenu({ id, onDelete }: { id: string; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative flex items-center justify-center">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:bg-accent hover:text-foreground transition-all"
        aria-label="행 메뉴"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-28 overflow-hidden rounded-lg border border-border bg-white shadow-lg">
          <button
            onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(id); }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            삭제
          </button>
        </div>
      )}
    </div>
  );
}

export default function MeetingsPage() {
  const router = useRouter();
  const { meetings, deleteMeeting, hydrated } = useMeetings();

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">회의 목록</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            필터 추가
          </button>
          <span className="text-border">|</span>
          <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
            <Plus className="h-3.5 w-3.5" />
            속성 추가
          </button>
        </div>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        {/* 헤더 */}
        <div className="grid grid-cols-[2fr_1fr_2fr_1fr_2.5rem] gap-0 border-b border-border bg-muted/40 px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <div className="flex items-center gap-1">회의명 <ChevronDown className="h-3 w-3 opacity-60" /></div>
          <div className="flex items-center gap-1">날짜 <ChevronDown className="h-3 w-3 opacity-60" /></div>
          <div className="flex items-center gap-1">파일명 <ChevronDown className="h-3 w-3 opacity-60" /></div>
          <div className="flex items-center gap-1">상태 <ChevronDown className="h-3 w-3 opacity-60" /></div>
          <div />
        </div>

        {/* 바디 */}
        {!hydrated ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="grid grid-cols-[2fr_1fr_2fr_1fr_2.5rem] gap-0 px-4 py-3">
                <div className="h-4 w-40 rounded bg-muted animate-pulse" />
                <div className="h-4 w-28 rounded bg-muted animate-pulse" />
                <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                <div className="h-5 w-20 rounded-full bg-muted animate-pulse" />
              </div>
            ))}
          </div>
        ) : meetings.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            아직 회의가 없습니다.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {meetings.map((m) => (
              <div
                key={m.id}
                className="group/row grid grid-cols-[2fr_1fr_2fr_1fr_2.5rem] gap-0 px-4 py-3 text-sm items-center cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => router.push(`/meetings/${m.id}`)}
              >
                <div className="font-medium truncate pr-4 text-foreground">{m.title}</div>
                <div className="text-muted-foreground text-xs whitespace-nowrap">
                  {formatDate(m.created_at)}
                </div>
                <div className="text-muted-foreground text-xs truncate pr-4">
                  {m.filename ?? "—"}
                </div>
                <div>
                  <StatusPill status={m.status} />
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <RowMenu id={m.id} onDelete={deleteMeeting} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 푸터 액션 */}
        <div className="border-t border-border px-4 py-2.5 flex items-center gap-5 text-xs text-muted-foreground bg-muted/20">
          {hydrated && meetings.length > 0 && (
            <button className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
              <ChevronDown className="h-3.5 w-3.5" />
              더 불러오기
            </button>
          )}
          <Link
            href="/meetings/new"
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            새 회의
          </Link>
        </div>
      </div>
    </div>
  );
}
