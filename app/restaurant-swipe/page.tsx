"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
import { getCuisineVisual } from "@/lib/cuisine-utils";
import { useIsClient } from "@/lib/use-is-client";

const SPRING = { type: "spring" as const, stiffness: 480, damping: 36 };

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function ItemCard({
  item,
  restaurant,
  onAdd,
  onPass,
}: {
  item: FoodItem;
  restaurant: NonNullable<ReturnType<typeof getRestaurantById>>;
  onAdd: () => void;
  onPass: () => void;
}) {
  const visual = getCuisineVisual(restaurant.cuisine);
  const price = getItemPriceCents(item);

  return (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, y: 32, scale: 0.93 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.90, y: -20 }}
      transition={SPRING}
      className="w-full max-w-sm overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/18"
    >
      {/* Image area */}
      <div className={`relative h-44 overflow-hidden bg-gradient-to-br ${visual.gradient}`}>
        <div className={`absolute -top-8 -right-8 h-36 w-36 rounded-full blur-3xl ${visual.orbA} animate-orb-a`} />
        <div className={`absolute bottom-0 left-4 h-28 w-28 rounded-full blur-2xl ${visual.orbB} animate-orb-b`} />
        <div
          className="absolute inset-0 flex items-center justify-center text-[76px] select-none"
          style={{ filter: "drop-shadow(0 6px 18px rgba(0,0,0,0.10))" }}
        >
          {visual.emoji}
        </div>
        <div className="absolute bottom-3 left-3 flex items-center gap-2">
          <span className="rounded-full border border-white/50 bg-white/70 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-i1 backdrop-blur-sm">
            {restaurant.cuisine}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand">
          {restaurant.name}
        </p>
        <h2
          className="mt-1.5 text-xl font-extrabold leading-snug text-i0"
          style={{ fontFamily: "var(--font-syne)" }}
        >
          {item.name}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-i2">{item.description}</p>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-lg font-extrabold text-brand">{formatPrice(price)}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <motion.button
            type="button"
            onClick={onPass}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            className="rounded-xl border-2 border-b2 bg-s1 py-3 text-sm font-bold text-i1 transition-all hover:bg-s2"
          >
            Pass ✕
          </motion.button>
          <motion.button
            type="button"
            onClick={onAdd}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.96 }}
            className="rounded-xl bg-brand py-3 text-sm font-bold text-white shadow-md shadow-brand/25 transition-all hover:bg-brand-dk"
          >
            Add to cart +
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

export default function RestaurantSwipePage() {
  const router = useRouter();
  const isClient = useIsClient();

  const [index, setIndex] = useState(0);
  const [cartRefreshKey, setCartRefreshKey] = useState(0);

  const restaurantId = isClient
    ? (new URLSearchParams(window.location.search).get("restaurantId") ?? getTargetRestaurantId() ?? "")
    : "";
  const restaurant = useMemo(() => (restaurantId ? getRestaurantById(restaurantId) : undefined), [restaurantId]);
  const items = useMemo<FoodItem[]>(() => (restaurant ? getRestaurantItems(restaurant.id) : []), [restaurant]);
  const current = items[index];
  const cart: GrubrCartItem[] = useMemo(() => {
    void cartRefreshKey;
    return isClient ? getCartItems() : [];
  }, [isClient, cartRefreshKey]);

  useEffect(() => {
    if (!isClient) return;
    if (!restaurant) { router.replace("/swiping"); return; }
    setTargetRestaurantId(restaurant.id);
  }, [isClient, restaurant, router]);

  const refreshCart = () => setCartRefreshKey((k) => k + 1);

  function handleAdd(item: FoodItem) {
    addItemToCart({ id: item.id, restaurantId: item.restaurantId, name: item.name, priceCents: getItemPriceCents(item) });
    refreshCart();
    setIndex((i) => i + 1);
  }

  if (!isClient || !restaurant) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 rounded-full border-[3px] border-white/25 border-t-white animate-spin-ring" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <GrubrHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 lg:flex-row lg:items-start lg:gap-5">
        {/* Center deck */}
        <section className="flex flex-1 flex-col items-center justify-center py-2">
          <div className="mb-3 text-center">
            <p className="text-[10px] font-bold uppercase tracking-[0.20em] text-oo-s">
              Building your order
            </p>
            <h1
              className="mt-1 text-2xl font-extrabold text-white"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {restaurant.name}
            </h1>
            <p className="mt-0.5 text-sm text-oo-s">
              {index} of {items.length} dishes · {cart.length} in cart
            </p>
          </div>

          <AnimatePresence mode="wait">
            {current ? (
              <ItemCard
                key={current.id}
                item={current}
                restaurant={restaurant}
                onAdd={() => handleAdd(current)}
                onPass={() => setIndex((i) => i + 1)}
              />
            ) : (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={SPRING}
                className="w-full max-w-sm overflow-hidden rounded-3xl bg-white p-8 text-center shadow-2xl shadow-black/18"
              >
                <span className="text-5xl">🛒</span>
                <h2
                  className="mt-3 text-xl font-extrabold text-i0"
                  style={{ fontFamily: "var(--font-syne)" }}
                >
                  That&apos;s the menu!
                </h2>
                <p className="mt-2 text-sm text-i2">
                  You&apos;ve gone through all dishes from {restaurant.name}.
                  {cart.length > 0 ? " Ready to checkout?" : " Head back to add more."}
                </p>
                <div className="mt-5 flex flex-col gap-2">
                  {cart.length > 0 && (
                    <button
                      type="button"
                      onClick={() => router.push("/checkout")}
                      className="w-full rounded-xl bg-brand py-3 text-sm font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dk"
                    >
                      Checkout →
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => router.push("/swiping")}
                    className="w-full rounded-xl border-2 border-b2 bg-s1 py-3 text-sm font-semibold text-i1 hover:bg-s2"
                  >
                    Back to discovery
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Cart sidebar */}
        <div className="lg:sticky lg:top-20 lg:w-80 lg:shrink-0">
          <CartSummary
            items={cart}
            onAdd={(itemId) => {
              const target = cart.find((c) => c.id === itemId);
              if (!target) return;
              addItemToCart({ id: target.id, restaurantId: target.restaurantId, name: target.name, priceCents: target.priceCents });
              refreshCart();
            }}
            onRemove={(itemId) => { removeItemFromCart(itemId); refreshCart(); }}
            emptyLabel="Swipe through dishes and add them here."
          />
        </div>
      </main>
    </div>
  );
}
