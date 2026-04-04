"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { GrubrHeader } from "@/components/grubr-header";
import { getTargetRestaurantId, setTargetRestaurantId } from "@/lib/grubr-storage";
import { getRestaurantById } from "@/lib/mock-food";
import { getCuisineVisual } from "@/lib/cuisine-utils";
import { useIsClient } from "@/lib/use-is-client";

const SPRING = { type: "spring" as const, stiffness: 460, damping: 36 };

export default function RestaurantConfirmPage() {
  const router = useRouter();
  const isClient = useIsClient();

  const restaurantId = isClient
    ? (new URLSearchParams(window.location.search).get("restaurantId") ?? getTargetRestaurantId() ?? "")
    : "";

  const restaurant = useMemo(
    () => (restaurantId ? getRestaurantById(restaurantId) : undefined),
    [restaurantId],
  );

  useEffect(() => {
    if (!isClient) return;
    if (!restaurant) { router.replace("/swiping"); return; }
    setTargetRestaurantId(restaurant.id);
  }, [isClient, restaurant, router]);

  if (!isClient || !restaurant) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 rounded-full border-[3px] border-white/25 border-t-white animate-spin-ring" />
      </div>
    );
  }

  const visual = getCuisineVisual(restaurant.cuisine);

  return (
    <div className="flex min-h-screen flex-col">
      <GrubrHeader />

      <main className="flex flex-1 items-center justify-center px-4 py-6">
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={SPRING}
          className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/20"
        >
          {/* Hero area */}
          <div className={`relative h-40 overflow-hidden bg-gradient-to-br ${visual.gradient}`}>
            <div className={`absolute -top-8 -right-8 h-40 w-40 rounded-full blur-3xl ${visual.orbA} animate-orb-a`} />
            <div className={`absolute bottom-0 left-6 h-28 w-28 rounded-full blur-2xl ${visual.orbB} animate-orb-b`} />
            <div className="absolute inset-0 flex items-center justify-center text-[80px] select-none" style={{ filter: "drop-shadow(0 8px 20px rgba(0,0,0,0.10))" }}>
              {visual.emoji}
            </div>
            <div className="absolute left-4 bottom-3">
              <span className="rounded-full border border-white/50 bg-white/70 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-i1 backdrop-blur-sm">
                {restaurant.cuisine}
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 py-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand">
              Suggested for you
            </p>
            <h1
              className="mt-1 text-2xl font-extrabold text-i0"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {restaurant.name}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-sm text-i2">{restaurant.stars.toFixed(1)} ★</span>
              <span className="text-i3">·</span>
              <span className="text-sm text-i2">{restaurant.reviewCount} reviews</span>
            </div>

            <div className="mt-5 rounded-xl border border-b1 bg-s1 p-3.5">
              <p className="text-sm font-semibold text-i0">How would you like to proceed?</p>
              <p className="mt-1 text-xs leading-relaxed text-i2">
                Keep swiping on this restaurant&apos;s dishes one-by-one, or browse their full menu imported directly from Grubhub.
              </p>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => router.push(`/restaurant-swipe?restaurantId=${restaurant.id}`)}
                className="rounded-xl bg-brand py-3.5 text-sm font-bold text-white shadow-md shadow-brand/25 transition-all hover:bg-brand-dk"
              >
                <span className="block text-lg mb-0.5">🎴</span>
                Keep swiping
              </motion.button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => router.push(`/restaurant-menu?restaurantId=${restaurant.id}`)}
                className="rounded-xl border-2 border-b2 bg-s1 py-3.5 text-sm font-bold text-i0 transition-all hover:bg-s2"
              >
                <span className="block text-lg mb-0.5">📋</span>
                Browse full menu
              </motion.button>
            </div>

            <Link
              href="/swiping"
              className="mt-4 flex justify-center text-xs font-semibold text-brand underline underline-offset-4"
            >
              ← Back to discovery
            </Link>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
