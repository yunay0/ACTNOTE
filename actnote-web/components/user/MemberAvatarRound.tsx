"use client";

import { useEffect, useState } from "react";
import { workspaceMemberDisplayName, workspaceMemberInitials } from "@/lib/user/member-display";

function initialsForMember(name: string, email: string): string {
  return workspaceMemberInitials(name, email);
}

/** Round avatar for workspace members — display URL (signed) with initials fallback. */
export function MemberAvatarRound(props: {
  avatarUrl: string | null;
  name: string;
  email: string;
  size: number;
  className?: string;
}) {
  const { avatarUrl, name, email, size, className = "" } = props;
  const [broken, setBroken] = useState(false);
  const dim = `${size}px`;

  useEffect(() => {
    setBroken(false);
  }, [avatarUrl]);

  if (avatarUrl?.trim() && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        // 인라인 style 로 정사각형 고정 — Tailwind preflight 의 `img { height: auto }`
        // 가 width/height 속성을 덮어 비율이 깨지는(늘어나는) 문제 방지.
        style={{ width: dim, height: dim }}
        className={`shrink-0 rounded-full object-cover ${className}`}
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
      />
    );
  }

  const initials = initialsForMember(name, email);
  const label = workspaceMemberDisplayName(name, email);

  return (
    <div
      aria-hidden
      title={label}
      className={`flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white sm:text-[11px] ${className}`}
      style={{
        width: dim,
        height: dim,
        background: "linear-gradient(135deg, #2e5c8a 0%, #ff6b35 50%)",
      }}
    >
      {initials}
    </div>
  );
}
