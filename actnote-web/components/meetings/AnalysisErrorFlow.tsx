"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { AnalysisErrorModal } from "@/components/meetings/AnalysisErrorModal";
import { MeetingErrorMetaReadonly } from "@/components/meetings/MeetingErrorMetaReadonly";
import { createClient } from "@/lib/supabase/client";
import { analysisErrorModalCopy } from "@/lib/meetings/analysis-error-modal-copy";
import {
  parsePipelineErrorCode,
  analysisErrorUxKindFromCode,
  type AnalysisErrorUxKind,
} from "@/lib/meetings/analysis-error-ux";
import { analysisFailureSupportComposeUrl } from "@/lib/meetings/analysis-support-mailto";
import { responsibleLabelFromSnapshot } from "@/lib/meetings/meeting-attribution";
import { retryMeetingPipeline } from "@/lib/meetings/retry-pipeline";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { MemberAvatarRound } from "@/components/user/MemberAvatarRound";
import { resolveMeetingsImageDisplayUrl } from "@/lib/storage/meetings-image-url";
import { resolveMeetingParticipantDisplays } from "@/lib/meetings/participant-display-labels";

type LoadedMeeting = {
  id: string;
  title: string;
  status: string;
  meeting_date: string | null;
  meeting_type: string | null;
  description: string | null;
  participants: string[];
  workspace_id: string;
  audio_file_url: string | null;
  error_message: string | null;
  responsible_user_id: string | null;
  responsible_display_name: string | null;
  responsible_display_email: string | null;
};

type WorkspaceMemberWithAvatar = {
  user_id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
};

function normalizeParticipants(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => String(p).trim()).filter(Boolean);
}

/** View error: 회의 메타(읽기 전용) + Figma 180:9060 모달. Re-attach → `/meetings/new?reattach=`. */
export function AnalysisErrorFlow({ meetingId }: { meetingId: string }): ReactElement | null {
  const router = useRouter();
  const searchParams = useSearchParams();
  const thanks = searchParams.get("thanks") === "1";
  const { workspaceId, workspaceName } = useWorkspaceContext();

  const [row, setRow] = useState<LoadedMeeting | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [responsibleLabel, setResponsibleLabel] = useState<string | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberWithAvatar[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("meetings")
        .select(
          "id, title, status, meeting_date, meeting_type, description, participants, workspace_id, audio_file_url, error_message, responsible_user_id, responsible_display_name, responsible_display_email",
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

      const snapLabel = responsibleLabelFromSnapshot({
        responsible_display_name: data.responsible_display_name as string | null,
        responsible_display_email: data.responsible_display_email as string | null,
      });

      let respLabel = snapLabel;
      const respId =
        typeof data.responsible_user_id === "string" ? data.responsible_user_id : null;
      if (respId) {
        const { data: u } = await (supabase as any)
          .from("users")
          .select("name, email")
          .eq("id", respId)
          .maybeSingle();
        if (!cancelled && u) {
          const name = typeof u.name === "string" ? u.name.trim() : "";
          const email = typeof u.email === "string" ? u.email.trim() : "";
          if (name && email) respLabel = `${name} (${email})`;
          else if (name) respLabel = name;
          else if (email) respLabel = email;
        }
      }

      if (cancelled) return;
      setLoadErr(null);
      setResponsibleLabel(respLabel);
      setRow({
        id: data.id as string,
        title: (data.title as string) || "Untitled Meeting",
        status: String(data.status),
        meeting_date: (data.meeting_date as string | null) ?? null,
        meeting_type: typeof data.meeting_type === "string" ? data.meeting_type : null,
        description: typeof data.description === "string" ? data.description : null,
        participants: normalizeParticipants(data.participants),
        workspace_id: data.workspace_id as string,
        audio_file_url: (data.audio_file_url as string | null) ?? null,
        error_message: (data.error_message as string | null) ?? null,
        responsible_user_id: respId,
        responsible_display_name:
          typeof data.responsible_display_name === "string" ? data.responsible_display_name : null,
        responsible_display_email:
          typeof data.responsible_display_email === "string" ? data.responsible_display_email : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("workspace_members")
        .select("user_id, users(name, email, avatar_url)")
        .eq("workspace_id", workspaceId);
      if (cancelled) return;
      if (error || !data?.length) {
        setMembers([]);
        return;
      }
      const resolved = await Promise.all(
        (data as { user_id: string; users: unknown }[]).map(async (r) => {
          const u = Array.isArray(r.users) ? r.users[0] : r.users;
          const uo = u && typeof u === "object" ? (u as Record<string, unknown>) : null;
          const name = typeof uo?.name === "string" ? uo.name : null;
          const email = typeof uo?.email === "string" ? uo.email : "";
          const ar = uo?.avatar_url;
          const stored = typeof ar === "string" && ar.trim() ? ar.trim() : null;
          const avatar_url = await resolveMeetingsImageDisplayUrl(supabase, stored);
          return { user_id: r.user_id, name, email, avatar_url };
        }),
      );
      if (!cancelled) setMembers(resolved);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  useEffect(() => {
    if (row === undefined || row === null) return;
    if (row.status !== "error") {
      router.replace(`/meetings/${meetingId}`);
    }
  }, [row, meetingId, router]);

  const participantDisplays = useMemo(
    () => (row ? resolveMeetingParticipantDisplays(row.participants, members) : []),
    [row, members],
  );

  const responsibleMember = useMemo(
    () => members.find((m) => m.user_id === row?.responsible_user_id) ?? null,
    [members, row?.responsible_user_id],
  );

  const createdByNode = responsibleLabel ? (
    <span className="inline-flex flex-wrap items-center gap-2 font-medium text-[#0a2540]">
      <MemberAvatarRound
        avatarUrl={responsibleMember?.avatar_url ?? null}
        name={responsibleMember?.name ?? responsibleLabel}
        email={responsibleMember?.email ?? ""}
        size={24}
      />
      <span>{responsibleLabel}</span>
    </span>
  ) : null;

  const code = parsePipelineErrorCode(row?.error_message ?? "");
  const kind: AnalysisErrorUxKind = analysisErrorUxKindFromCode(code);
  const modalCopy = useMemo(() => analysisErrorModalCopy(kind), [kind]);

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
      dateTimeLine:
        row.meeting_date != null
          ? new Date(row.meeting_date).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })
          : "—",
      meetingId: row.id,
    });
    const opened =
      typeof window !== "undefined" ? window.open(compose, "_blank", "noopener,noreferrer") : null;
    if (!opened && typeof window !== "undefined") {
      window.location.assign(compose);
    }
    router.replace(`/meetings/${meetingId}/analysis-error?thanks=1`);
    setModalOpen(false);
  }

  function handlePrimary(): void {
    if (kind === "reattach_file") {
      router.push(`/meetings/new?reattach=${encodeURIComponent(meetingId)}`);
      return;
    }
    if (kind === "retry_network") {
      void handleTryAgain();
      return;
    }
    handleContactSupport();
  }

  if (row === undefined) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <DashboardHeader title="Meeting details" backHref="/meetings" />
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
        <DashboardHeader title="Meeting details" backHref="/meetings" />
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

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-[#f8fafc]">
      <DashboardHeader title="Meeting details" backHref="/meetings" />

      <div className="flex-1 overflow-y-auto px-6 py-8 md:px-10">
        <MeetingErrorMetaReadonly
          meetingTitle={row.title}
          meetingTypeRaw={row.meeting_type}
          meetingScheduledAtIso={row.meeting_date}
          description={row.description}
          participants={participantDisplays}
          createdBy={createdByNode}
          responsibleLabel={responsibleLabel}
        />
        {actionErr ? (
          <p className="mx-auto mt-6 max-w-3xl rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[13px] text-red-800">
            {actionErr}
          </p>
        ) : null}
      </div>

      {!thanks ? (
        <AnalysisErrorModal
          open={modalOpen}
          copy={modalCopy}
          busy={busy}
          onClose={() => setModalOpen(false)}
          onPrimary={handlePrimary}
        />
      ) : (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a2540]/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl">
            <p className="text-[18px] font-bold text-[#0a2540]">Thanks — request received</p>
            <p className="mt-3 text-[14px] text-[#64748b]">
              Our team is reviewing your request. You should hear back within 3–4 business days.
            </p>
            <button
              type="button"
              onClick={() => router.push("/meetings")}
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#ff6b35] px-8 text-[14px] font-bold text-white hover:opacity-90"
            >
              Go to Home
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
