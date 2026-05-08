"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutDashboard, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function DashboardHeader() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-primary">
      <div className="container flex h-14 items-center justify-between">
        <Link
          href="/meetings"
          className="flex items-center gap-2 font-bold text-lg text-primary-foreground tracking-tight"
        >
          <LayoutDashboard className="h-5 w-5" />
          ACTNOTE
        </Link>

        <button
          onClick={handleLogout}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-primary-foreground/80 hover:text-primary-foreground hover:bg-white/10 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          로그아웃
        </button>
      </div>
    </header>
  );
}
