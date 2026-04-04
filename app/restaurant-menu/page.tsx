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
  getScrapedMenuForRestaurant,
  type FoodItem,
} from "@/lib/mock-food";
import { getCuisineVisual } from "@/lib/cuisine-utils";
import { useIsClient } from "@/lib/use-is-client";

const SPRING = { type: "spring" as const, stiffness: 440, damping: 34 };

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RestaurantMenuPage() {
  const router = useRouter();
  const isClient = useIsClient();

  const [loading, setLoading] = useState(true);
  const [menuItems, setMenuItems] = useState<FoodItem[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [cartRefreshKey, setCartRefreshKey] = useState(0);

  const restaurantId = isClient
    ? (new URLSearchParams(window.location.search).get("restaurantId") ?? getTargetRestaurantId() ?? "")
    : "";
  const restaurant = useMemo(() => (restaurantId ? getRestaurantById(restaurantId) : undefined), [restaurantId]);
  const cart: GrubrCartItem[] = useMemo(() => {
    void cartRefreshKey;
    return isClient ? getCartItems() : [];
  }, [isClient, cartRefreshKey]);

  useEffect(() => {
    if (!isClient) return;
    if (!restaurant) { router.replace("/swiping"); return; }
    setTargetRestaurantId(restaurant.id);
    let active = true;
    getScrapedMenuForRestaurant(restaurant.id).then((res) => {
      if (!active) return;
      setSourceUrl(res.sourceUrl);
      setMenuItems(res.items);
      setLoading(false);
    });
    return () => { active = false; };
  }, [isClient, restaurant, router]);

  const refreshCart = () => setCartRefreshKey((k) => k + 1);

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

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 lg:flex-row lg:items-start lg:gap-5">
        {/* Menu section */}
        <section className="flex-1 min-w-0">
          {/* Restaurant hero card */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING}
            className="mb-4 overflow-hidden rounded-2xl bg-white shadow-xl shadow-black/10"
          >
            <div className={`relative h-20 overflow-hidden bg-gradient-to-br ${visual.gradient}`}>
              <div className={`absolute -top-6 -right-6 h-28 w-28 rounded-full blur-3xl ${visual.orbA} animate-orb-a`} />
              <div className={`absolute bottom-0 left-6 h-20 w-20 rounded-full blur-2xl ${visual.orbB} animate-orb-b`} />
              <div className="absolute inset-0 flex items-center px-6">
                <div className="flex items-center gap-4">
                  <span className="text-5xl select-none" style={{ filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.10))" }}>
                    {visual.emoji}
                  </span>
                  <div>
                    <p
                      className="text-xl font-extrabold text-i0"
                      style={{ fontFamily: "var(--font-syne)" }}
                    >
                      {restaurant.name}
                    </p>
                    <p className="text-xs text-i2">{restaurant.stars} ★ · {restaurant.reviewCount} reviews · {restaurant.cuisine}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-b1 bg-s1 px-5 py-2.5">
              <div className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
              <p className="text-xs text-i2">
                Menu imported from Grubhub
                {sourceUrl && (
                  <span className="ml-1 text-i3">· {sourceUrl.replace("https://", "")}</span>
                )}
              </p>
            </div>
          </motion.div>

          {/* Items */}
          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-36 rounded-2xl shimmer" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {menuItems.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, ...SPRING }}
                  className="group overflow-hidden rounded-2xl bg-white shadow-md shadow-black/8 transition-shadow hover:shadow-lg"
                >
                  {/* Mini gradient header */}
                  <div className={`h-10 bg-gradient-to-r ${visual.gradient} relative overflow-hidden`}>
                    <div className={`absolute -right-3 -top-3 h-12 w-12 rounded-full blur-xl ${visual.orbA}`} />
                  </div>

                  <div className="px-4 py-3">
                    <p className="text-sm font-bold text-i0 leading-snug">{item.name}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-i2 line-clamp-2">{item.description}</p>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-sm font-extrabold text-brand">
                        {formatPrice(getItemPriceCents(item))}
                      </span>
                      <motion.button
                        type="button"
                        whileHover={{ scale: 1.04 }}
                        whileTap={{ scale: 0.94 }}
                        onClick={() => {
                          addItemToCart({
                            id: item.id,
                            restaurantId: item.restaurantId,
                            name: item.name,
                            priceCents: getItemPriceCents(item),
                          });
                          refreshCart();
                        }}
                        className="rounded-lg bg-brand px-3.5 py-1.5 text-xs font-bold text-white shadow-sm shadow-brand/25 transition-all hover:bg-brand-dk"
                      >
                        + Add
                      </motion.button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Cart */}
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
            emptyLabel="Browse the menu and add dishes here."
          />
        </div>
      </main>
    </div>
  );
}
