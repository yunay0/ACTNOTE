"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Draft 모달 — body 포털 + 상위 overflow/transform 영향 제거 */
export function DraftModalPortal({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}): ReactElement | null {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;
  return createPortal(children, document.body);
}
