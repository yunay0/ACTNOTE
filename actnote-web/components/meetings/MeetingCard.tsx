"use client";

import { useState, useRef, useEffect } from "react";
import { MoreVertical, Trash2 } from "lucide-react";
import type { Meeting, MeetingStatus } from "@/lib/types/meeting";
import { isProcessing } from "@/lib/types/meeting";

interface MeetingCardProps {
  meeting: Meeting;
  onDelete?: (id: string) => void;
  onClick?: () => void;
}

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  analyzing: { bg: "bg-[#fff4f0]", text: "text-[#ff6b35]", label: "Analyzing" },
  draft:     { bg: "bg-[#fff4f0]", text: "text-[#ff6b35]", label: "Draft" },
  published: { bg: "bg-[#e3f2fd]", text: "text-[#2e5c8a]", label: "Published" },
  error:     { bg: "bg-red-50",    text: "text-red-600",   label: "Error" },
};

function getStatusKey(status: MeetingStatus): string {
  if (isProcessing(status)) return "analyzing";
  if (status === "ready") return "draft";
  if (status === "published") return "published";
  if (status === "error") return "error";
  return "draft";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MeetingCard({ meeting, onDelete, onClick }: MeetingCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const statusKey = getStatusKey(meeting.status);
  const style = STATUS_STYLE[statusKey];

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node))
        setMenuOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div
      className="group relative flex cursor-pointer flex-col gap-2 rounded-xl border border-[#e2e8f0] bg-white p-[25px] transition-all hover:border-[#2e5c8a]/30 hover:shadow-md"
      onClick={onClick}
    >
      {/* 3-dot menu */}
      <div
        ref={menuRef}
        className="absolute right-3 top-3"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#94a3b8] opacity-0 group-hover:opacity-100 hover:bg-[#f8fafc] hover:text-[#64748b] transition-all"
        >
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-28 overflow-hidden rounded-lg border border-[#e2e8f0] bg-white shadow-lg">
            <button
              onClick={() => { setMenuOpen(false); onDelete?.(meeting.id); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Status badge */}
      <div className="flex items-start">
        <span className={`rounded-[6px] px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.5px] ${style.bg} ${style.text}`}>
          {style.label}
        </span>
      </div>

      {/* Title */}
      <p className="pt-2 text-[16px] font-bold leading-snug text-[#0a2540] line-clamp-2">
        {meeting.title}
      </p>

      {/* Date */}
      <p className="pb-2 text-[12px] text-[#64748b]">
        {formatDate(meeting.created_at)}
      </p>

      {/* Divider + meta */}
      <div className="border-t border-[#f1f5f9] pt-4 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-[12px] text-[#64748b]">
          ✅ <span>0 items</span>
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-[#64748b]">
          👥 <span>0 people</span>
        </span>
      </div>
    </div>
  );
}
