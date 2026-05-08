"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { MoreVertical, Trash2, CalendarDays } from "lucide-react";
import type { Meeting } from "@/lib/types/meeting";
import { StatusBadge } from "@/components/meetings/StatusBadge";

interface MeetingCardProps {
  meeting: Meeting;
  onDelete?: (id: string) => void;
}

export function MeetingCard({ meeting, onDelete }: MeetingCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const date = new Date(meeting.created_at).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm transition-all hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5">
      {/* 햄버거(점 3개) 메뉴 */}
      <div ref={menuRef} className="absolute right-3 top-3">
        <button
          onClick={(e) => { e.preventDefault(); setMenuOpen((v) => !v); }}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground transition-all"
          aria-label="메뉴"
        >
          <MoreVertical className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-32 overflow-hidden rounded-lg border border-border bg-white shadow-lg">
            <button
              onClick={(e) => {
                e.preventDefault();
                setMenuOpen(false);
                onDelete?.(meeting.id);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              삭제
            </button>
          </div>
        )}
      </div>

      {/* 카드 내용 — 클릭 영역 */}
      <Link href={`/meetings/${meeting.id}`} className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2 pr-6">
          <h3 className="font-semibold leading-snug group-hover:text-primary transition-colors line-clamp-2">
            {meeting.title}
          </h3>
          <StatusBadge status={meeting.status} className="shrink-0" />
        </div>

        {meeting.summary && (
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {meeting.summary}
          </p>
        )}

        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-auto pt-1">
          <CalendarDays className="h-3.5 w-3.5" />
          {date}
        </div>
      </Link>
    </div>
  );
}
