"use client";

import type { ReactElement } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";

export type HomeNotionBannerVariant = "owner_not_connected" | "member_not_connected";

type HomeNotionStatusBannerProps = {
  variant: HomeNotionBannerVariant;
};

/** Figma 214:10682 (owner) / 214:10745 (member) — Home 상단 Notion 미연동 안내. */
export function HomeNotionStatusBanner({ variant }: HomeNotionStatusBannerProps): ReactElement {
  const router = useRouter();

  if (variant === "owner_not_connected") {
    return (
      <div className="flex items-start gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-[19px] py-[15px]">
        <AlertCircle className="mt-0.5 size-[18px] shrink-0 text-[#f59e0b]" strokeWidth={2} aria-hidden />
        <div className="min-w-0 text-[12px] leading-[19.2px] text-[#78350f]">
          <p className="text-[13px] font-semibold text-[#92400e]">Notion is not connected</p>
          <p className="mt-0.5">
            You can still create and edit meeting notes in ACTNOTE. However, notes can&apos;t be
            published to Notion and action items won&apos;t be auto-created as tickets.
          </p>
          <p className="mt-0.5">
            <button
              type="button"
              onClick={() => router.push("/settings/integrations")}
              className="font-bold text-[#78350f] underline decoration-solid underline-offset-2 hover:opacity-90"
            >
              Connect Notion now
            </button>{" "}
            to enable publishing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-[#fde68a] bg-[#fffbeb] px-[19px] py-[15px]">
      <AlertCircle className="mt-0.5 size-[18px] shrink-0 text-[#f59e0b]" strokeWidth={2} aria-hidden />
      <div className="min-w-0 text-[12px] leading-[19.2px] text-[#78350f]">
        <p className="text-[13px] font-semibold text-[#92400e]">Notion is not connected</p>
        <p className="mt-0.5">
          You can still create and edit meeting notes in ACTNOTE. However, notes can&apos;t be
          published to Notion and action items won&apos;t be auto-created as tickets.
        </p>
        <p className="mt-0.5">To enable publishing, ask your workspace Owner to connect Notion.</p>
      </div>
    </div>
  );
}
