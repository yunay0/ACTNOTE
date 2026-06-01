"use client";

import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, FileText } from "lucide-react";

export type DraftNotionBannerVariant =
  | "owner_not_connected"
  | "member_not_connected"
  | "owner_connected"
  | "member_connected"
  | "owner_published_not_synced"
  | "member_published_not_synced"
  | "owner_published_synced"
  | "member_published_synced";

export function resolveDraftNotionBannerVariant(
  isWsOwner: boolean,
  notionConnected: boolean,
): DraftNotionBannerVariant {
  if (notionConnected) {
    return isWsOwner ? "owner_connected" : "member_connected";
  }
  return isWsOwner ? "owner_not_connected" : "member_not_connected";
}

/** Published meeting — Figma 219:11179 / 11188 / 11206 / 11196. */
export function resolvePublishedNotionBannerVariant(
  isWsOwner: boolean,
  notionConnected: boolean,
  hasNotionMeetingPage: boolean,
): Extract<
  DraftNotionBannerVariant,
  | "owner_published_not_synced"
  | "member_published_not_synced"
  | "owner_published_synced"
  | "member_published_synced"
> {
  if (notionConnected && hasNotionMeetingPage) {
    return isWsOwner ? "owner_published_synced" : "member_published_synced";
  }
  return isWsOwner ? "owner_published_not_synced" : "member_published_not_synced";
}

function notionPageUrlFromId(notionPageId: string): string {
  return `https://www.notion.so/${notionPageId.replace(/-/g, "")}`;
}

function formatPublishedAtLabel(iso: string | null | undefined): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

type DraftNotionStatusBannerProps = {
  variant: DraftNotionBannerVariant;
  workspaceName: string;
  publishedAtIso?: string | null;
  notionPageId?: string | null;
};

/** Figma 202:11057–11082 (draft) · 219:11179+ (published) — Notion 연동 상태 배너. */
export function DraftNotionStatusBanner({
  variant,
  workspaceName,
  publishedAtIso,
  notionPageId,
}: DraftNotionStatusBannerProps): ReactElement {
  const router = useRouter();
  const wsLabel = workspaceName.trim() || "your";
  const publishedAtLabel = formatPublishedAtLabel(publishedAtIso);
  const notionUrl =
    notionPageId?.trim() ? notionPageUrlFromId(notionPageId.trim()) : null;

  if (variant === "owner_published_not_synced") {
    return (
      <div className="flex items-start gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-[17px] py-3.5">
        <AlertCircle className="mt-0.5 size-[18px] shrink-0 text-[#f59e0b]" strokeWidth={2} aria-hidden />
        <p className="text-[13px] leading-[20.8px] text-[#92400e]">
          Published in ACTNOTE only — not synced to Notion. Connect Notion to publish future
          meeting notes.{" "}
          <button
            type="button"
            onClick={() => router.push("/settings/integrations")}
            className="font-semibold text-[#f26522] hover:opacity-90"
          >
            Connect now →
          </button>
        </p>
      </div>
    );
  }

  if (variant === "member_published_not_synced") {
    return (
      <div className="flex items-start gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-[17px] py-3.5">
        <AlertCircle className="mt-0.5 size-[18px] shrink-0 text-[#f59e0b]" strokeWidth={2} aria-hidden />
        <p className="text-[13px] leading-[20.8px] text-[#92400e]">
          Published in ACTNOTE only — not synced to Notion. Ask your workspace Owner to connect
          Notion to enable future publishing.
        </p>
      </div>
    );
  }

  if (variant === "owner_published_synced" || variant === "member_published_synced") {
    return (
      <div className="flex flex-wrap items-start gap-3 rounded-[10px] border border-[#bfdbfe] bg-[#eff6ff] px-[17px] py-3.5">
        <FileText className="mt-0.5 size-[18px] shrink-0 text-[#3b82f6]" strokeWidth={2} aria-hidden />
        <div className="min-w-0 flex-1 text-[13px] leading-[20.8px] text-[#1e40af]">
          <span>
            Published to <span className="font-bold">Meeting Notes</span> in {wsLabel} Workspace
          </span>
          {publishedAtLabel ? (
            <span className="ml-2 text-[12px] text-[#3b82f6]">{publishedAtLabel}</span>
          ) : null}
        </div>
        {notionUrl ? (
          <a
            href={notionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[13px] font-semibold text-[#1e40af] hover:opacity-90"
          >
            View in Notion →
          </a>
        ) : null}
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
