"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";
import {
  parsePipelineErrorCode,
  analysisErrorUxKindFromCode,
  type AnalysisErrorUxKind,
} from "@/lib/meetings/analysis-error-ux";
import { analysisFailureSupportComposeUrl } from "@/lib/meetings/analysis-support-mailto";
import { retryMeetingPipeline } from "@/lib/meetings/retry-pipeline";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";

type LoadedMeeting = {
  id: string;
  title: string;
  status: string;
  meeting_date: string | null;
  workspace_id: string;
  audio_file_url: string | null;
  error_message: string | null;
};

function formatMeetingDetailLine(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function primaryButtonClass(): string {
  return (
    "inline-flex min-h-[48px] w-full max-w-sm items-center justify-center rounded-xl text-[14px] font-bold " +
    "text-white shadow-[0px_4px_6px_rgba(255,107,53,0.2)] transition-opacity hover:opacity-90 " +
    "disabled:opacity-50"
  );
}

/** Full-page branching UX after home / bell entry (Figma 147:10670 / :10825 / :10977 / :11135). */
export function AnalysisErrorFlow({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const thanks = searchParams.get("thanks") === "1";
  const { workspaceId, workspaceName } = useWorkspaceContext();

  const [row, setRow] = useState<LoadedMeeting | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("meetings")
        .select(
          "id, title, status, meeting_date, workspace_id, audio_file_url, error_message",
        )
        .eq("id", meetingId)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        setLoadErr(typeof error.message === "string" ? error.message : "Could not load meeting.");
        setRow(null);
        return;
      }
      if (!data) {
        setLoadErr("Meeting not found or access denied.");
        setRow(null);
        return;
      }
      setLoadErr(null);
      setRow({
        id: data.id as string,
        title: (data.title as string) || "Untitled Meeting",
        status: String(data.status),
        meeting_date: (data.meeting_date as string | null) ?? null,
        workspace_id: data.workspace_id as string,
        audio_file_url: (data.audio_file_url as string | null) ?? null,
        error_message: (data.error_message as string | null) ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, workspaceId]);

  useEffect(() => {
    if (row === undefined || row === null) return;
    if (row.status !== "error") {
      router.replace(`/meetings/${meetingId}`);
    }
  }, [row, meetingId, router]);

  async function handleTryAgain(): Promise<void> {
    if (!row || !workspaceId) return;
    setActionErr(null);
    setBusy(true);
    const r = await retryMeetingPipeline({
      id: row.id,
      workspace_id: row.workspace_id,
      audio_url: row.audio_file_url,
    });
    setBusy(false);
    if (!r.ok) {
      setActionErr(r.error);
      return;
    }
    router.push("/meetings");
    router.refresh();
  }

  function handleContactSupport(): void {
    if (!row) return;
    setActionErr(null);
    const compose = analysisFailureSupportComposeUrl({
      meetingTitle: row.title,
      workspaceName: workspaceName.trim() || "—",
      dateTimeLine: formatMeetingDetailLine(row.meeting_date ?? undefined),
    });
    const opened = typeof window !== "undefined" ? window.open(compose, "_blank", "noopener,noreferrer") : null;
    if (!opened && typeof window !== "undefined") {
      window.location.assign(compose);
    }
    router.replace(`${pathname}?thanks=1`);
  }

  if (row === undefined) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardHeader title="Analysis issue" backHref="/meetings" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-[#64748b]">
          <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
          <p className="text-[14px]">Loading meeting…</p>
        </div>
      </div>
    );
  }

  if (loadErr || row === null) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardHeader title="Analysis issue" backHref="/meetings" />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="max-w-md text-[15px] font-semibold text-[#0a2540]">
            {loadErr ?? "Could not open this meeting."}
          </p>
          <Link
            href="/meetings"
            className="rounded-xl px-6 py-2.5 text-[13px] font-bold text-[#ff6b35] underline underline-offset-4 hover:opacity-90"
          >
            Go to Home
          </Link>
        </div>
      </div>
    );
  }

  if (row.status !== "error") return null;

  const code = parsePipelineErrorCode(row.error_message ?? "");
  const codeLabel = code;
  const kind: AnalysisErrorUxKind = analysisErrorUxKindFromCode(code);

  function recapBox(r: LoadedMeeting): ReactElement {
    return (
      <div className="w-full max-w-lg rounded-xl border border-[#e2e8f0] bg-[#f8fafc] px-5 py-4 text-left">
        <p className="text-[12px] font-bold uppercase tracking-wide text-[#94a3b8]">
          Meeting
        </p>
        <p className="mt-1 text-[16px] font-bold leading-snug text-[#0a2540]">{r.title}</p>
        <p className="mt-2 text-[13px] text-[#64748b]">
          {formatMeetingDetailLine(r.meeting_date ?? undefined)}
        </p>
        <p className="mt-1 text-[13px] text-[#64748b]">
          Workspace: <span className="font-semibold text-[#0a2540]">{workspaceName || "—"}</span>
        </p>
        {kind === "contact_support" && codeLabel ? (
          <p className="mt-2 font-mono text-[11px] text-[#94a3b8]">
            [{`code:${codeLabel}`}]
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-white">
      <DashboardHeader title="Analysis issue" backHref="/meetings" />

      <div className="flex flex-1 flex-col items-center px-6 py-12">
        {!thanks ? (
          <>
            {kind === "retry_network" ? (
              <div className="flex max-w-xl flex-col items-center text-center">
                <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-orange-50 text-[28px]" aria-hidden>📶</div>
                <h2 className="text-[22px] font-bold text-[#0a2540]">Check your connection</h2>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[#64748b]">
                  We could not sync with the server. This usually means a temporary network glitch or an issue saving analysis results.
                </p>
                <div className="mt-8 w-full max-w-lg">{recapBox(row)}</div>
                {actionErr ? (
                  <p className="mt-4 max-w-lg rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[13px] text-red-800">
                    {actionErr}
                  </p>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleTryAgain()}
                  className={`${primaryButtonClass()} mt-8`}
                  style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Retrying…
                    </>
                  ) : (
                    "Try again"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/meetings")}
                  className="mt-4 text-[14px] font-semibold text-[#64748b] underline-offset-4 hover:text-[#0a2540] hover:underline"
                >
                  Back
                </button>
              </div>
            ) : null}

            {kind === "reattach_file" ? (
              <div className="flex max-w-xl flex-col items-center text-center">
                <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-amber-50 text-[26px]" aria-hidden>📎</div>
                <h2 className="text-[22px] font-bold text-[#0a2540]">Replace your recording</h2>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[#64748b]">
                  The uploaded file could not be read or had no usable audio. Upload a supported recording (.mp3, .m4a, .wav, .mp4, .mov — max 50 MB).
                </p>
                <div className="mt-8 w-full max-w-lg">{recapBox(row)}</div>
                <button
                  type="button"
                  onClick={() => router.push(`/meetings/new?reattach=${encodeURIComponent(meetingId)}`)}
                  className={`${primaryButtonClass()} mt-8`}
                  style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
                >
                  Reattach file
                </button>
              </div>
            ) : null}

            {kind === "contact_support" ? (
              <div className="flex max-w-xl flex-col items-center text-center">
                <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-red-50 text-[28px]" aria-hidden>⚙️</div>
                <h2 className="text-[22px] font-bold text-[#0a2540]">Server issue</h2>
                <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-[#64748b]">
                  Analysis failed due to a problem on our side (storage quota or AI service). Contact support — we&apos;ll investigate.
                </p>
                <div className="mt-8 w-full max-w-lg">{recapBox(row)}</div>
                <button
                  type="button"
                  onClick={handleContactSupport}
                  className={`${primaryButtonClass()} mt-8`}
                  style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
                >
                  Contact support
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex max-w-xl flex-col items-center text-center">
            <div className="mb-6 flex size-14 items-center justify-center rounded-full bg-green-50 text-[28px]" aria-hidden>✉️</div>
            <h2 className="text-[22px] font-bold text-[#0a2540]">Thanks — request received</h2>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[#64748b]">
              Our team is reviewing your request. You should hear back within 3–4 business days.
            </p>
            <div className="mt-8 w-full max-w-lg rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-left">
              <p className="text-[13px] font-bold text-[#b91c1c]">What happens next?</p>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-[13px] leading-relaxed text-[#991b1b]">
                <li>Support may reply by email.</li>
                <li>You can keep working in ACTNOTE meanwhile.</li>
                <li>Include any extra detail in follow-up replies.</li>
              </ul>
            </div>
            <button
              type="button"
              onClick={() => router.push("/meetings")}
              className={`${primaryButtonClass()} mt-10`}
              style={{ background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)" }}
            >
              Go to Home
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
