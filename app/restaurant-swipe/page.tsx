"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { GrubrHeader } from "@/components/grubr-header";
import { CartSummary } from "@/components/cart-summary";
import {
  addItemToCart,
  getCartItems,
  getTargetRestaurantId,
  removeItemFromCart,
  setTargetRestaurantId,
  type GrubrCartItem,
} from "@/lib/grubr-storage";
import {
  getItemPriceCents,
  getRestaurantById,
  getRestaurantItems,
  type FoodItem,
} from "@/lib/mock-food";
import { useIsClient } from "@/lib/use-is-client";

export default function RestaurantSwipePage() {
  const router = useRouter();
  const isClient = useIsClient();

  const [index, setIndex] = useState(0);
  const [cartRefreshKey, setCartRefreshKey] = useState(0);

  const restaurantId = isClient
    ? new URLSearchParams(window.location.search).get("restaurantId") ??
      getTargetRestaurantId() ??
      ""
    : "";
  const restaurant = useMemo(
    () => (restaurantId ? getRestaurantById(restaurantId) : undefined),
    [restaurantId],
  );
  const items = useMemo<FoodItem[]>(
    () => (restaurant ? getRestaurantItems(restaurant.id) : []),
    [restaurant],
  );
  const current = items[index];
  const cart: GrubrCartItem[] = useMemo(
    () => {
      void cartRefreshKey;
      return isClient ? getCartItems() : [];
    },
    [isClient, cartRefreshKey],
  );

  useEffect(() => {
    if (!isClient) return;
    if (!restaurant) {
      router.replace("/swiping");
      return;
    }
    setTargetRestaurantId(restaurant.id);
  }, [isClient, restaurant, router]);

  const refreshCart = () => setCartRefreshKey((k) => k + 1);

  function handleAdd(item: FoodItem) {
    addItemToCart({
      id: item.id,
      restaurantId: item.restaurantId,
      name: item.name,
      priceCents: getItemPriceCents(item),
    });
    refreshCart();
    setIndex((i) => i + 1);
  }

  function handlePass() {
    setIndex((i) => i + 1);
  }

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
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 p-4 lg:flex-row">
        <section className="flex flex-1 flex-col items-center justify-center">
          {!current ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md rounded-2xl border border-white/30 bg-white/95 p-8 text-center text-grubr-ink shadow-xl"
            >
              <h2 className="text-xl font-bold">Done swiping {restaurant.name}</h2>
              <p className="mt-2 text-sm text-grubr-muted-ink">
                You can checkout now or jump back for more discovery.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/checkout")}
                  className="rounded-xl bg-grubr-orange py-2.5 text-sm font-bold text-white"
                >
                  Checkout
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/swiping")}
                  className="rounded-xl border border-grubr-border-surface py-2.5 text-sm font-semibold"
                >
                  Back to discovery
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="w-full max-w-md rounded-3xl border border-white/40 bg-white/95 p-6 text-grubr-ink shadow-2xl"
            >
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-grubr-orange">
                {restaurant.name}
              </p>
              <h1 className="mt-3 text-2xl font-bold leading-tight">{current.name}</h1>
              <p className="mt-3 text-sm leading-relaxed text-grubr-muted-ink">
                {current.description}
              </p>
              <p className="mt-4 text-sm font-semibold text-grubr-orange">
                ${(getItemPriceCents(current) / 100).toFixed(2)}
              </p>

              <div className="mt-6 flex gap-3">
                <button
                  type="button"
                  onClick={handlePass}
                  className="flex-1 rounded-xl border border-grubr-border-surface py-3 text-sm font-semibold"
                >
                  Pass
                </button>
                <button
                  type="button"
                  onClick={() => handleAdd(current)}
                  className="flex-1 rounded-xl bg-grubr-orange py-3 text-sm font-bold text-white"
                >
                  Add to cart
                </button>
              </div>
            </motion.div>
          )}
        </section>

        <CartSummary
          items={cart}
          onAdd={(itemId) => {
            const target = cart.find((c) => c.id === itemId);
            if (!target) return;
            addItemToCart({
              id: target.id,
              restaurantId: target.restaurantId,
              name: target.name,
              priceCents: target.priceCents,
            });
            refreshCart();
          }}
          onRemove={(itemId) => {
            removeItemFromCart(itemId);
            refreshCart();
          }}
          emptyLabel="Swipe and add dishes to build your order."
        />
      </main>
    </div>
  );
}
