"use client";

import { createClient } from "@/lib/supabase/client";
import { deriveAudioStoragePath } from "@/lib/meetings/audio-path";

export type RetryPipelineResult =
  | { ok: true }
  | { ok: false; error: string };

export type RetryPipelineInput = {
  id: string;
  workspace_id: string;
  audio_url?: string | null;
};

/** Re-queue `meeting/process` for an existing upload (e.g. after error). */
export async function retryMeetingPipeline(input: RetryPipelineInput): Promise<RetryPipelineResult> {
  const audioPath = deriveAudioStoragePath(input.audio_url ?? null, input.id);
  if (!audioPath) {
    return {
      ok: false,
      error: "No audio file found for this meeting. Upload a new recording.",
    };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "You must be signed in to retry." };
  }

  const { error: clearErr } = await (supabase as any)
    .from("meetings")
    .update({ error_message: null, status: "uploaded" })
    .eq("id", input.id);

  if (clearErr) {
    return { ok: false, error: clearErr.message ?? "Could not reset meeting status." };
  }

  const triggerRes = await fetch("/api/trigger-pipeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      meeting_id: input.id,
      workspace_id: input.workspace_id,
      audio_path: audioPath,
    }),
  });

  const body = (await triggerRes.json().catch(() => ({}))) as { error?: string };
  if (!triggerRes.ok) {
    return {
      ok: false,
      error:
        body.error ??
        `Pipeline could not be started (${triggerRes.status}). Check Inngest configuration.`,
    };
  }

  return { ok: true };
}
