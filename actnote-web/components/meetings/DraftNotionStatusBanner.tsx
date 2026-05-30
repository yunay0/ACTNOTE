"use client";

import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";

export type DraftNotionBannerVariant =
  | "owner_not_connected"
  | "member_not_connected"
  | "owner_connected"
  | "member_connected"
  | "owner_published_not_synced";

export function resolveDraftNotionBannerVariant(
  isWsOwner: boolean,
  notionConnected: boolean,
): DraftNotionBannerVariant {
  if (notionConnected) {
    return isWsOwner ? "owner_connected" : "member_connected";
  }
  return isWsOwner ? "owner_not_connected" : "member_not_connected";
}

type DraftNotionStatusBannerProps = {
  variant: DraftNotionBannerVariant;
  workspaceName: string;
};

/** Figma 202:11057–11082 — Draft 상단 Notion 연동 상태 배너. */
export function DraftNotionStatusBanner({ variant, workspaceName }: DraftNotionStatusBannerProps) {
  const router = useRouter();
  const wsLabel = workspaceName.trim() || "your";

  if (variant === "owner_published_not_synced") {
    return (
      <div className="flex items-start gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-[17px] py-3.5">
        <AlertCircle className="mt-0.5 size-[18px] shrink-0 text-[#f59e0b]" strokeWidth={2} aria-hidden />
        <div className="text-[13px] leading-[20.8px] text-[#92400e]">
          <span>
            Published in ACTNOTE only — not synced to Notion. Connect Notion to publish future
            meeting notes.{" "}
          </span>
          <button
            type="button"
            onClick={() => router.push("/settings/integrations")}
            className="font-semibold text-[#f26522] hover:opacity-90"
          >
            Connect now →
          </button>
        </div>
      </div>
    );
  }

  if (variant === "owner_not_connected") {
    return (
      <div className="flex items-start gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-[17px] py-3.5">
        <AlertCircle className="mt-0.5 size-[18px] shrink-0 text-[#f59e0b]" strokeWidth={2} aria-hidden />
        <div className="text-[13px] leading-[20.8px] text-[#92400e]">
          <span className="font-bold">Notion is not connected.</span>
          <span>
            {" "}
            Connect Notion to publish meeting notes and auto-create action items.{" "}
          </span>
          <button
            type="button"
            onClick={() => router.push("/settings/integrations")}
            className="font-semibold text-[#f26522] hover:opacity-90"
          >
            Connect now →
          </button>
        </div>
      </div>
    );
  }

  if (variant === "member_not_connected") {
    return (
      <div className="flex items-start gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-[17px] py-3.5">
        <AlertCircle className="mt-0.5 size-[18px] shrink-0 text-[#f59e0b]" strokeWidth={2} aria-hidden />
        <p className="text-[13px] leading-[20.8px] text-[#92400e]">
          <span className="font-bold">Notion is not connected.</span>
          <span>
            {" "}
            Notes can&apos;t be published and action items won&apos;t be auto-created. Only your
            workspace Owner can set this up.
          </span>
        </p>
      </div>
    );
  }

  if (variant === "owner_connected") {
    return (
      <div className="flex items-start gap-3 rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] px-[17px] py-3.5">
        <Check className="mt-0.5 size-[18px] shrink-0 text-[#166534]" strokeWidth={2.5} aria-hidden />
        <p className="text-[13px] leading-[20.8px] text-[#166534]">
          Ready to publish to <span className="font-bold">Meeting Notes</span> in {wsLabel}{" "}
          Workspace
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-[#bbf7d0] bg-[#f0fdf4] px-[17px] py-3.5">
      <Check className="mt-0.5 size-[18px] shrink-0 text-[#166534]" strokeWidth={2.5} aria-hidden />
      <p className="text-[13px] leading-[20.8px] text-[#166534]">
        Published notes will be saved to <span className="font-bold">Meeting Notes</span> in{" "}
        {wsLabel} Workspace
      </p>
    </div>
  );
}
