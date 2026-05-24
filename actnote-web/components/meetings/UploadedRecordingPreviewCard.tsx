"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart3, Clock, Music2, Pause, Play, Square, Trash2 } from "lucide-react";
import { formatRecordingSizeMbDecimal } from "@/lib/meeting/recordingFilename";

function formatPlaybackDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface UploadedRecordingPreviewCardProps {
  file: File;
  onRemove: () => void;
}

/**
 * Figma 업로드 완료 상태 — 파일명·크기·길이 + 로컬 미리 재생·삭제.
 */
export function UploadedRecordingPreviewCard({ file, onRemove }: UploadedRecordingPreviewCardProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file);
    setObjectUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      setObjectUrl(null);
    };
  }, [file]);

  useEffect(() => {
    if (!objectUrl) return undefined;
    setDurationSec(null);
    setPlaying(false);
    const el = audioRef.current;
    if (!el) return undefined;

    const onMeta = (): void => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDurationSec(d);
      else setDurationSec(null);
    };
    const onEnded = (): void => setPlaying(false);
    const onPauseEvt = (): void => setPlaying(false);
    const onPlayEvt = (): void => setPlaying(true);

    el.pause();
    el.currentTime = 0;
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("ended", onEnded);
    el.addEventListener("pause", onPauseEvt);
    el.addEventListener("play", onPlayEvt);

    try {
      el.load();
    } catch {
      setDurationSec(null);
    }

    return () => {
      el.pause();
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("pause", onPauseEvt);
      el.removeEventListener("play", onPlayEvt);
    };
  }, [objectUrl]);

  function togglePlayPause(): void {
    const el = audioRef.current;
    if (!el) return;
    if (playing) void el.pause();
    else void el.play().catch(() => setPlaying(false));
  }

  function stopPlayback(): void {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setPlaying(false);
  }

  function handleRemove(): void {
    stopPlayback();
    onRemove();
  }

  return (
    <div className="w-full rounded-xl border-2 border-[#22c55e] bg-white p-[18px] shadow-sm">
      {objectUrl ? (
        <audio ref={audioRef} preload="metadata" src={objectUrl} className="hidden" />
      ) : null}

      <div className="relative flex gap-3 pb-4">
        <div
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-[#ff6b35] text-white"
        >
          <Music2 className="size-8" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1 pr-24">
          <p className="truncate text-[15px] font-bold leading-snug text-[#0a2540]" title={file.name}>
            {file.name}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[13px] text-[#64748b]">
            <span className="flex items-center gap-1">
              <BarChart3 className="size-3.5 shrink-0 opacity-70" aria-hidden />
              {formatRecordingSizeMbDecimal(file.size)}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="size-3.5 shrink-0 opacity-70" aria-hidden />
              {formatPlaybackDuration(durationSec)}
            </span>
          </div>
        </div>
        <span className="absolute right-0 top-0 rounded-md bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-green-700">
          Uploaded
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[#e2e8f0] pt-4">
        <button
          type="button"
          aria-pressed={playing}
          onClick={(e) => {
            e.stopPropagation();
            togglePlayPause();
          }}
          className="inline-flex h-11 min-w-[112px] items-center justify-center gap-2 rounded-[10px] px-5 text-[14px] font-bold text-white shadow-[0px_4px_6px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(134deg, #ff6b35 0%, #ff8555 100%)" }}
        >
          {playing ? (
            <>
              <Pause className="size-4" fill="currentColor" aria-hidden /> Pause
            </>
          ) : (
            <>
              <Play className="size-4 fill-current" aria-hidden /> Play
            </>
          )}
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            stopPlayback();
          }}
          className="inline-flex h-11 min-w-[104px] items-center justify-center gap-2 rounded-[10px] border-2 border-[#fecaca] bg-orange-50 px-4 text-[14px] font-bold text-orange-900 transition-colors hover:bg-orange-100/80"
        >
          <Square className="size-3.5 fill-current" aria-hidden />
          Stop
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleRemove();
          }}
          className="inline-flex h-11 min-w-[96px] items-center justify-center gap-2 rounded-[10px] border-2 border-[#ff6b35] bg-white px-4 text-[14px] font-bold text-[#ff6b35] transition-colors hover:bg-[#fff4f0]"
        >
          <Trash2 className="size-4" aria-hidden />
          Delete
        </button>
      </div>
    </div>
  );
}
