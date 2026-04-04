"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useIsClient } from "@/lib/use-is-client";

export default function OrderConfirmedPage() {
  const isClient = useIsClient();

  const data = useMemo(() => {
    if (!isClient) return { mode: "delivery", time: "X:XX" };
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") === "pickup" ? "pickup" : "delivery";
    const time = params.get("time") || "X:XX";
    return { mode, time };
  }, [isClient]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-grubr-orange px-4 text-center text-white">
      <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl">
        Thank you ! Your order will be ready / delivered at {data.time}
      </h1>
      <p className="mt-4 text-sm font-medium uppercase tracking-[0.2em] text-white/85">
        {data.mode === "pickup" ? "Pickup confirmed" : "Delivery confirmed"}
      </p>
      <Link
        href="/"
        className="mt-10 rounded-xl bg-white px-6 py-3 text-sm font-bold text-grubr-orange shadow-xl"
      >
        Return to landing
      </Link>
    </div>
  );
}
