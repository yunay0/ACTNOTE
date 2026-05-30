"use client";

import { useEffect, useState } from "react";

function initialsFromWorkspaceName(name: string): string {
  const t = name.trim();
  if (!t) return "WS";
  return t.slice(0, 2).toUpperCase();
}

/** Workspace logo with signed URL display; falls back to name initials. */
export function WorkspaceLogoAvatar(props: {
  name: string;
  logoDisplayUrl?: string | null;
  size: number;
  className?: string;
  roundedClass?: string;
  fallbackStyle?: React.CSSProperties;
  textClass?: string;
}) {
  const {
    name,
    logoDisplayUrl,
    size,
    className = "",
    roundedClass = "rounded-[6px]",
    fallbackStyle = {
      background: "linear-gradient(135deg, #ff6b35 0%, #ff8555 100%)",
    },
    textClass = "text-[14px] font-bold text-white",
  } = props;
  const [broken, setBroken] = useState(false);
  const dim = `${size}px`;

  useEffect(() => {
    setBroken(false);
  }, [logoDisplayUrl]);

  if (logoDisplayUrl?.trim() && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoDisplayUrl}
        alt=""
        className={`shrink-0 object-cover ${roundedClass} ${className}`}
        style={{ width: dim, height: dim }}
        onError={() => setBroken(true)}
      />
    );
  }

  const letter = (name.trim()[0] ?? "?").toUpperCase();
  const initials = initialsFromWorkspaceName(name);

  return (
    <div
      aria-hidden
      className={`flex shrink-0 items-center justify-center ${roundedClass} ${textClass} ${className}`}
      style={{ width: dim, height: dim, ...fallbackStyle }}
      title={name.trim() || "Workspace"}
    >
      {size >= 56 ? initials.slice(0, 2) : letter}
    </div>
  );
}
