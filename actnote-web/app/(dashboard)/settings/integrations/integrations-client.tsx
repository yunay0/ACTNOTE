"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";

type Props = {
  bannerError?: string;
  bannerMessage?: string;
  connected?: boolean;
};

const ERROR_LABELS: Record<string, string> = {
  missing_code: "Notion did not return an authorization code. Try connecting again.",
  invalid_state: "Invalid workspace context. Start the connection from Settings again.",
  forbidden: "You don’t have access to this workspace.",
  token_exchange:
    "Could not exchange the Notion code for a token. Check NOTION_CLIENT_SECRET and redirect URI in Notion Developer Portal.",
  network: "Network error while contacting Notion. Try again.",
  encrypt_config:
    "Server missing ACTNOTE_ENCRYPTION_KEY (same key as the Python worker).",
  save_failed: "Could not save the integration to the database.",
  service_role:
    "Server missing SUPABASE_SERVICE_ROLE_KEY or Supabase rejected the save.",
  notion_denied: "Notion authorization was cancelled.",
  invalid_workspace: "Pick a valid workspace before connecting.",
  server_config:
    "Missing NOTION_CLIENT_ID, NOTION_CLIENT_SECRET, or NEXT_PUBLIC_APP_URL on the server.",
  no_access_token: "Notion response had no access token.",
};

function describeError(code?: string, msg?: string): string | undefined {
  if (!code) return undefined;
  if (msg && (code === "notion_denied" || code === "token_exchange")) {
    try {
      return decodeURIComponent(msg);
    } catch {
      return msg;
    }
  }
  return ERROR_LABELS[code] ?? (msg ? `${code}: ${msg}` : code);
}

export default function IntegrationsSettingsClient({
  bannerError,
  bannerMessage,
  connected: connectedQuery,
}: Props) {
  const { workspaceId: activeWorkspaceId, workspaceName: ctxWorkspaceName } =
    useWorkspaceContext();
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [notionConnected, setNotionConnected] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    setWorkspaceId(activeWorkspaceId);
    setWorkspaceName(ctxWorkspaceName ?? "Workspace");

    const { data: intRow } = await (supabase as any)
      .from("integrations")
      .select("id")
      .eq("workspace_id", activeWorkspaceId)
      .eq("platform", "notion")
      .maybeSingle();

    setNotionConnected(!!intRow);
    setLoading(false);
  }, [activeWorkspaceId, ctxWorkspaceName]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDisconnect() {
    if (!workspaceId || disconnecting) return;
    setDisconnecting(true);
    const supabase = createClient();
    await (supabase as any)
      .from("integrations")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("platform", "notion");
    setNotionConnected(false);
    setDisconnecting(false);
  }

  const errorText = describeError(bannerError, bannerMessage);

  const connectHref =
    workspaceId &&
    `/api/integrations/notion/start?workspace_id=${encodeURIComponent(workspaceId)}`;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader title="Integrations" backHref="/meetings" />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-5 py-10 flex flex-col gap-6">
          {connectedQuery && (
            <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              Notion is connected for this workspace.
            </div>
          )}

          {errorText && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorText}
            </div>
          )}

          <section className="rounded-xl border border-[#e2e8f0] bg-white p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[17px] font-bold text-[#0a2540]">Notion</h2>
                <p className="mt-1 text-[13px] text-[#64748b]">
                  Connect Notion to publish meeting notes and sync action items (
                  <span className="font-medium text-[#0a2540]">INTEG-001 / INTEG-003</span>
                  ).
                </p>
              </div>
              <span className="rounded-lg bg-[#f8fafc] px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-[#64748b]">
                Workspace
              </span>
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#ff6b35] border-t-transparent" />
              </div>
            ) : !workspaceId ? (
              <p className="text-sm text-[#64748b]">
                No workspace found. Finish onboarding or join a workspace first.
              </p>
            ) : (
              <div className="flex flex-col gap-4 rounded-xl bg-[#f8fafc] p-5 border border-[#e2e8f0]">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#0a2540] text-lg font-bold text-white">
                    N
                  </div>
                  <div className="flex-1">
                    <p className="text-[14px] font-bold text-[#0a2540]">
                      {workspaceName}
                    </p>
                    <p className="text-[12px] text-[#64748b]">
                      {notionConnected
                        ? "Connected — publishing will push to your Notion workspace."
                        : "Not connected — publishing may be blocked until Notion is linked."}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      notionConnected
                        ? "bg-green-100 text-green-700"
                        : "bg-[#fff4f0] text-[#ff6b35]"
                    }`}
                  >
                    {notionConnected ? "Connected" : "Disconnected"}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {connectHref && !notionConnected && (
                    <a
                      href={connectHref}
                      className="inline-flex h-11 items-center justify-center rounded-lg px-5 text-[14px] font-bold text-white transition-opacity hover:opacity-90"
                      style={{
                        background:
                          "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)",
                      }}
                    >
                      Connect Notion
                    </a>
                  )}
                  {notionConnected && (
                    <button
                      type="button"
                      onClick={handleDisconnect}
                      disabled={disconnecting}
                      className="inline-flex h-11 items-center justify-center rounded-lg border-2 border-[#e2e8f0] bg-white px-5 text-[14px] font-bold text-[#64748b] hover:border-red-200 hover:text-red-600 disabled:opacity-50"
                    >
                      {disconnecting ? "Disconnecting…" : "Disconnect"}
                    </button>
                  )}
                  <Link
                    href="https://developers.notion.com/docs/create-a-notion-integration"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#2e5c8a] hover:underline"
                  >
                    Notion integration docs
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>

                <p className="text-[11px] leading-relaxed text-[#94a3b8]">
                  Register redirect URI in Notion:{" "}
                  <code className="rounded bg-white px-1 py-0.5 text-[10px] text-[#0a2540]">
                    {typeof window !== "undefined"
                      ? `${window.location.origin}/api/integrations/notion/callback`
                      : "{NEXT_PUBLIC_APP_URL}/api/integrations/notion/callback"}
                  </code>
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
