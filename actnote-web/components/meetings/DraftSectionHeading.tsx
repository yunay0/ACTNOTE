"use client";

import type { ReactElement, ReactNode } from "react";

export interface DraftSectionHeadingProps {
  /** 1–4 단계 표시용 */
  step: number;
  title: string;
  /** 업로드 녹음 등 섹션 제목 옆 필수 표시 */
  titleRequiredMark?: boolean;
  /** 피그마 S-18-01: 업로드 섹션 제목 조금 더 큼 (~18px) */
  titleSize?: "default" | "large";
  /** 회의 유형 칩 등 */
  trailing?: ReactNode;
}

/**
 * Draft 좌측 폼 단계 헤더 — Figma S-18-01 / S-18-02 공통 넘버 뱃지 + 제목.
 */
export function DraftSectionHeading(props: DraftSectionHeadingProps): ReactElement {
  const titleCls =
    props.titleSize === "large"
      ? "text-[18px] font-bold leading-snug text-[#0a2540]"
      : "text-[17px] font-bold leading-snug text-[#0a2540]";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-[14px] bg-[#fff4f0] text-[14px] font-bold leading-none text-[#ff6b35]"
          aria-hidden
        >
          {props.step}
        </span>
        <h2 className={`min-w-0 ${titleCls}`}>
          {props.title}
          {props.titleRequiredMark ? (
            <>
              {" "}
              <span className="font-bold text-[#ff6b35]" aria-hidden>
                *
              </span>
            </>
          ) : null}
        </h2>
      </div>
      {props.trailing ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{props.trailing}</div>
      ) : null}
    </div>
  );
}
