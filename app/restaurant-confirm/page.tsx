"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { GrubrHeader } from "@/components/grubr-header";
import {
  getTargetRestaurantId,
  setTargetRestaurantId,
} from "@/lib/grubr-storage";
import { getRestaurantById } from "@/lib/mock-food";
import { useIsClient } from "@/lib/use-is-client";

export default function RestaurantConfirmPage() {
  const router = useRouter();
  const isClient = useIsClient();

  const restaurantId = isClient
    ? new URLSearchParams(window.location.search).get("restaurantId") ??
      getTargetRestaurantId() ??
      ""
    : "";

  const restaurant = useMemo(
    () => (restaurantId ? getRestaurantById(restaurantId) : undefined),
    [restaurantId],
  );

  useEffect(() => {
    if (!isClient) return;
    if (!restaurant) {
      router.replace("/swiping");
      return;
    }
    setTargetRestaurantId(restaurant.id);
  }, [isClient, restaurant, router]);

  if (!isClient || !restaurant) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <GrubrHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-white/30 bg-white/95 p-8 text-grubr-ink shadow-2xl"
        >
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-grubr-orange">
            Suggested Restaurant
          </p>
          <h1 className="mt-2 text-2xl font-bold">{restaurant.name}</h1>
          <p className="mt-2 text-sm text-grubr-muted-ink">
            Do you want to keep swiping, but only on items from this restaurant?
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() =>
                router.push(`/restaurant-swipe?restaurantId=${restaurant.id}`)
              }
              className="rounded-xl bg-grubr-orange py-3 text-sm font-bold text-white shadow-md hover:bg-grubr-orange-dark"
            >
              Yes — keep swiping this restaurant
            </button>
            <button
              type="button"
              onClick={() =>
                router.push(`/restaurant-menu?restaurantId=${restaurant.id}`)
              }
              className="rounded-xl border border-grubr-border-surface bg-white py-3 text-sm font-bold text-grubr-ink"
            >
              No — import full menu on Grubr
            </button>
          </div>

          <Link
            href="/swiping"
            className="mt-4 inline-block text-sm font-semibold text-grubr-orange underline underline-offset-4"
          >
            Back to discovery
          </Link>
        </motion.div>
      </main>
    </div>
  );
}
