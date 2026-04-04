"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hasCompletedOnboarding } from "@/lib/grubr-storage";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (hasCompletedOnboarding()) {
      router.replace("/swiping");
    } else {
      router.replace("/onboarding");
    }
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-grubr-cream">
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-grubr-orange border-t-transparent"
          aria-hidden
        />
        <p className="text-sm font-medium text-grubr-muted">Loading…</p>
      </div>
    </div>
  );
}
