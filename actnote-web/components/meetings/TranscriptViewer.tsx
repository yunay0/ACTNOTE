"use client";

import { useMemo } from "react";
import { FileText } from "lucide-react";

export type TranscriptLine = {
  speaker_label: string | null;
  text: string;
  start_seconds: number;
};

type MemberLike = {
  user_id: string;
  name: string | null;
  email: string;
};

/** Renders timestamped transcript lines with optional speaker → member resolution. */
export function TranscriptViewer(props: {
  transcripts: TranscriptLine[];
  speakerMapping?: Record<string, string>;
  members?: MemberLike[];
  /** When true, omits outer section chrome (for embedding inside another card). */
  bare?: boolean;
}) {
  const { transcripts, speakerMapping = {}, members = [], bare = false } = props;

  const memberById = useMemo(() => {
    const m = new Map<string, MemberLike>();
    for (const x of members) m.set(x.user_id, x);
    return m;
  }, [members]);

  function labelDisplay(speakerLabel: string): string {
    const uid = speakerMapping[speakerLabel];
    if (uid) {
      const mem = memberById.get(uid);
      if (mem) return mem.name?.trim() || mem.email.split("@")[0] || uid.slice(0, 8);
    }
    return speakerLabel;
  }

  if (transcripts.length === 0) return null;

  const body = (
    <div className="max-h-[420px] overflow-y-auto rounded-lg border border-[#e2e8f0] bg-[#fafafa] p-3 space-y-2 text-sm">
      {transcripts.map((row, i) => {
        const raw = (row.speaker_label ?? "—").trim() || "—";
        const who =
          raw !== "—" && raw !== "UNKNOWN"
            ? labelDisplay(raw)
            : raw === "UNKNOWN"
              ? "Unknown"
              : "—";
        return (
          <div key={i} className="border-b border-[#e2e8f0]/60 pb-2 last:border-0 last:pb-0">
            <span className="text-[11px] font-bold text-[#ff6b35]">
              {who}
              {speakerMapping[raw] && raw !== who ? (
                <span className="ml-1 font-normal text-[#94a3b8]">({raw})</span>
              ) : null}
            </span>
            <span className="ml-2 text-[11px] text-[#94a3b8] tabular-nums">
              {formatTime(row.start_seconds)}
            </span>
            <p className="mt-0.5 text-[#0a2540] leading-relaxed whitespace-pre-wrap">{row.text}</p>
          </div>
        );
      })}
    </div>
  );

  if (bare) {
    return (
      <div className="space-y-2 pt-2 border-t border-[#e2e8f0]">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#94a3b8]">Transcript</p>
        {body}
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-[#2e5c8a]" />
        <h2 className="text-[15px] font-bold text-[#0a2540]">Transcript</h2>
      </div>
      <p className="text-[13px] text-[#64748b] leading-relaxed">
        Full STT output with speaker labels. You can map speakers to workspace members after processing
        completes.
      </p>
      {body}
    </section>
  );
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
