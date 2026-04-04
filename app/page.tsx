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
    <div className="flex min-h-screen flex-col items-center justify-center bg-transparent">
      <div className="flex flex-col items-center gap-3">
        <div
          className="h-10 w-10 animate-spin-ring rounded-full border-[3px] border-white/25 border-t-white"
          aria-hidden
        />
        <p className="text-sm font-semibold text-oo-m" style={{ fontFamily: "var(--font-syne)" }}>Grubr</p>
      </div>
    </div>
  );
}
