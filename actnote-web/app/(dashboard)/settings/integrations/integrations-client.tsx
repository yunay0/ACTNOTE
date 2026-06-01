"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardHeader } from "@/components/layout/DashboardHeader";
import { createClient } from "@/lib/supabase/client";
import { useWorkspaceContext } from "@/components/workspace/WorkspaceProvider";
import { NotionTemplateDuplicateBox } from "@/components/integrations/NotionTemplateDuplicateBox";

// Notion N-mark icon (simplified lettermark)
function NotionIcon({ size = 24, color = "#191919" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="2" width="18" height="20" rx="2" stroke={color} strokeWidth="1.5" />
      <path d="M7 6.5V17.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 6.5L17 17.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 6.5V17.5" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

// Document-with-lines icon — empty-state placeholder (Figma 28×28, 외곽 + 길이 다른 3줄)
function NotionDocIcon({ size = 28, color = "#ADB5BD" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <rect x="4.67" y="3.5" width="18.66" height="21" rx="2.5" stroke={color} strokeWidth="2.1" />
      <rect x="8.16" y="8.17" width="11.67" height="1.75" rx="0.87" fill={color} />
      <rect x="8.16" y="12.83" width="9.33" height="1.75" rx="0.87" fill={color} />
      <rect x="8.16" y="17.5" width="10.5" height="1.75" rx="0.87" fill={color} />
    </svg>
  );
}

interface Integration {
  meeting_db_id: string | null;
  action_db_id: string | null;
  connected_at: string | null;
  last_sync_at: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function shortenDbId(id: string | null): string {
  if (!id) return "—";
  return `…${id.slice(-8)}`;
}

// --- Disconnect confirmation modal (per CSS: 440px, warning list, red confirm) ---
function DisconnectModal({ onConfirm, onCancel, loading, workspaceName }: {
  onConfirm: () => void; onCancel: () => void; loading: boolean; workspaceName?: string;
}) {
  const warnings = [
    "Meeting notes can no longer be published to Notion",
    "Action items won't be auto-created as tickets",
    "Existing published notes in Notion will not be deleted",
    "You can reconnect anytime from Workspace Settings",
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(26,43,74,0.45)" }}>
      <div className="flex w-full max-w-[440px] flex-col overflow-hidden rounded-[16px] bg-white shadow-[0px_20px_60px_rgba(0,0,0,0.2)]">
        {/* Body */}
        <div className="flex flex-col items-center gap-[9.2px] px-8 pt-8 pb-12">
          {/* Icon */}
          <div className="flex size-16 items-center justify-center rounded-full bg-[#FEF2F2]">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <circle cx="14" cy="14" r="12.5" stroke="#DC2626" strokeWidth="2" />
              <path d="M9 14H19" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          {/* Title */}
          <h2 className="pt-[10.8px] text-center text-[20px] font-bold text-[#212529]">Disconnect Notion?</h2>
          {/* Desc */}
          <p className="max-w-[369px] text-center text-[14px] leading-[22px] text-[#6C757D]">
            You&apos;re about to disconnect Notion from {workspaceName ? `${workspaceName} workspace` : "your workspace"}. This will affect all team members.
          </p>
          {/* Warning list */}
          <div className="flex w-full flex-col gap-2 rounded-[10px] border border-[#FFDBC4] bg-[#FFF4EE] px-4 pt-[24.8px] pb-[14px]">
            {warnings.map((w) => (
              <div key={w} className="flex items-center gap-2">
                <div className="size-[5px] shrink-0 rounded-full bg-[#F26522]" />
                <p className="text-[13px] leading-[16px] text-[#92400E]">{w}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer — stacked buttons */}
        <div className="flex flex-col gap-[10px] px-8 pb-6">
          <button
            onClick={onConfirm} disabled={loading}
            className="h-[43px] w-full rounded-[10px] bg-[#DC2626] text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Disconnecting…" : "Yes, Disconnect Notion"}
          </button>
          <button
            onClick={onCancel} disabled={loading}
            className="h-[45px] w-full rounded-[10px] border border-[#DEE2E6] bg-white text-[14px] font-medium text-[#6C757D] hover:bg-[#f8f9fa] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntegrationsSettingsClient({ bannerError }: { bannerError?: string; bannerMessage?: string; connected?: boolean }) {
  const router = useRouter();
  const { workspaceId: activeWorkspaceId, workspaceName: ctxWorkspaceName } = useWorkspaceContext();

  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) { setLoading(false); return; }
    setWorkspaceId(activeWorkspaceId);
    setWorkspaceName(ctxWorkspaceName ?? "");
    const supabase = createClient();
    const { data } = await (supabase as any)
      .from("integrations")
      .select("meeting_db_id, action_db_id, connected_at, last_sync_at")
      .eq("workspace_id", activeWorkspaceId)
      .eq("platform", "notion")
      .maybeSingle();
    setIntegration(data ?? null);
    setLoading(false);
  }, [activeWorkspaceId, ctxWorkspaceName]);

  useEffect(() => { load(); }, [load]);

  async function handleDisconnect() {
    if (!workspaceId || disconnecting) return;
    setDisconnecting(true);
    const supabase = createClient();
    await (supabase as any).from("integrations").delete().eq("workspace_id", workspaceId).eq("platform", "notion");
    setIntegration(null);
    setDisconnecting(false);
    setShowDisconnectModal(false);
  }

  const isConnected = !!integration;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DashboardHeader title="Workspace Settings" backHref="/meetings" />

      {showDisconnectModal && (
        <DisconnectModal
          onConfirm={handleDisconnect}
          onCancel={() => setShowDisconnectModal(false)}
          loading={disconnecting}
          workspaceName={workspaceName}
        />
      )}

      <div className="flex-1 overflow-y-auto bg-[#F8FAFC]">
        <div className="px-[29px] py-[35px]">

          {bannerError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {bannerError}
            </div>
          )}

          {/* Notion Integration card */}
          <div className="flex flex-col gap-5 rounded-[12px] border border-[#E9ECEF] bg-white p-7">

            {/* Section header */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-[5px]">
                <p className="text-[18px] font-semibold text-[#212529]">Notion Integration</p>
                <p className="text-[14px] text-[#6C757D]">Publish meeting notes and auto-create action item tickets</p>
              </div>

              {/* Status badge */}
              {loading ? null : isConnected ? (
                <div className="flex items-center gap-[6px] rounded-[8px] bg-[#D1FAE5] px-3 py-[6px]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="5.5" fill="#065F46" />
                    <path d="M3 6L5 8L9 4" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[13px] font-semibold text-[#065F46]">Connected</span>
                </div>
              ) : (
                <div className="flex items-center gap-[6px]">
                  <span className="size-1.5 shrink-0 rounded-full bg-black" aria-hidden />
                  <span className="text-[14px] text-[#000]">Not Connected</span>
                </div>
              )}
            </div>

            {loading ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#F26522] border-t-transparent" />
              </div>
            ) : isConnected ? (
              <>
                {/* Integration info card */}
                <div className="flex items-center gap-4 rounded-[10px] bg-[#F8F9FA] p-5">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-[#F1F3F5]">
                    <NotionIcon size={24} color="#191919" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="text-[15px] font-semibold text-[#212529]">Notion</p>
                    <p className="text-[13px] text-[#6C757D]">
                      Connected on {formatDate(integration.connected_at)} · Last synced {formatRelative(integration.last_sync_at)}
                    </p>
                  </div>
                </div>

                {/* DB list */}
                <div className="flex flex-col gap-3">
                  {/* Meeting Notes DB */}
                  <div className="flex items-center gap-3 rounded-[8px] border border-[#E9ECEF] bg-white px-4 py-[14px]">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-[#F1F3F5]">
                      <NotionIcon size={14} color="#495057" />
                    </div>
                    <div className="flex flex-1 flex-col gap-[3px]">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.36px] text-[#6C757D]">Meeting Notes Database</p>
                      <p className="text-[14px] font-medium text-[#212529]">
                        {integration.meeting_db_id ? `Notion DB ${shortenDbId(integration.meeting_db_id)}` : "Not set"}
                      </p>
                      {!integration.meeting_db_id ? (
                        <NotionTemplateDuplicateBox variant="meeting" compact />
                      ) : null}
                    </div>
                    <button
                      onClick={() => router.push("/settings/integrations/meeting-db")}
                      className="flex h-[33px] w-[80px] items-center justify-center rounded-[6px] border border-[#DEE2E6] bg-white text-[13px] text-[#495057] hover:bg-[#f8f9fa]"
                    >
                      Change
                    </button>
                  </div>

                  {/* Action Items DB */}
                  <div className="flex items-center gap-3 rounded-[8px] border border-[#E9ECEF] bg-white px-4 py-[14px]">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-[6px] bg-[#F1F3F5]">
                      <NotionIcon size={14} color="#495057" />
                    </div>
                    <div className="flex flex-1 flex-col gap-[3px]">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.36px] text-[#6C757D]">Action Items Database</p>
                      <p className="text-[14px] font-medium text-[#212529]">
                        {integration.action_db_id ? `Notion DB ${shortenDbId(integration.action_db_id)}` : "Not set"}
                      </p>
                      {!integration.action_db_id ? (
                        <NotionTemplateDuplicateBox variant="ticket" compact />
                      ) : null}
                    </div>
                    <button
                      onClick={() => router.push("/settings/integrations/action-db")}
                      className="flex h-[33px] w-[80px] items-center justify-center rounded-[6px] border border-[#DEE2E6] bg-white text-[13px] text-[#495057] hover:bg-[#f8f9fa]"
                    >
                      Change
                    </button>
                  </div>
                </div>

                {(!integration.meeting_db_id || !integration.action_db_id) && (
                  <NotionTemplateDuplicateBox
                    variant={!integration.meeting_db_id && !integration.action_db_id ? "both" : integration.meeting_db_id ? "ticket" : "meeting"}
                  />
                )}

                {/* Disconnect button */}
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowDisconnectModal(true)}
                    className="flex h-[38px] w-[114px] items-center justify-center rounded-[8px] border border-[#FCA5A5] bg-white text-[14px] font-bold text-[#DC2626] hover:bg-[#FEF2F2]"
                  >
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Empty state */}
                <div className="flex flex-col items-center gap-[6px] rounded-[10px] bg-[#F8F9FA] px-6 pb-11 pt-7">
                  <div className="flex size-14 items-center justify-center rounded-[12px] bg-[#F1F3F5]">
                    <NotionDocIcon size={28} color="#ADB5BD" />
                  </div>
                  <div className="flex flex-col items-center pt-[10px]">
                    <p className="text-[15px] font-semibold text-[#212529]">Notion is not connected</p>
                    <p className="mt-1 max-w-[621px] text-center text-[13px] leading-[21px] text-[#6C757D]">
                      Connect Notion to publish meeting notes and auto-create action item tickets directly from ACTNOTE.
                    </p>
                  </div>
                </div>

                {/* Warning box */}
                <div className="flex items-start gap-[10px] rounded-[10px] border border-[#FDE68A] bg-[#FFFBEB] px-4 py-[14px]">
                  <svg className="mt-[1px] shrink-0" width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1.5L14 13.5H2L8 1.5Z" stroke="#F59E0B" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M8 6V9" stroke="#F59E0B" strokeWidth="1.3" strokeLinecap="round" />
                    <circle cx="8" cy="11" r="0.6" fill="#F59E0B" />
                  </svg>
                  <p className="text-[13px] font-bold leading-[21px] text-[#92400E]">
                    Publishing is disabled. Meeting notes cannot be published to Notion and action items won&apos;t be auto-created until you connect.
                  </p>
                </div>

                <NotionTemplateDuplicateBox variant="both" />

                {/* Connect Notion button */}
                <div className="flex">
                  <button
                    onClick={() => router.push("/onboarding/notion/apikey?from=settings")}
                    className="flex h-[36px] items-center gap-2 rounded-[8px] bg-[#F26522] px-[18px] text-[14px] font-bold text-white hover:opacity-90"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                      <rect x="1" y="1" width="12" height="12" rx="2" stroke="#FFFFFF" strokeWidth="1.6" />
                    </svg>
                    Connect Notion
                  </button>
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
