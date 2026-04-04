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
import { useIsClient } from "@/lib/use-is-client";

export default function RestaurantMenuPage() {
  const router = useRouter();
  const isClient = useIsClient();

  const [loading, setLoading] = useState(true);
  const [menuItems, setMenuItems] = useState<FoodItem[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
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

    let active = true;
    getScrapedMenuForRestaurant(restaurant.id).then((res) => {
      if (!active) return;
      setSourceUrl(res.sourceUrl);
      setMenuItems(res.items);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [isClient, restaurant, router]);

  const refreshCart = () => setCartRefreshKey((k) => k + 1);

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
        <section className="flex-1">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-white/30 bg-white/95 p-5 text-grubr-ink shadow-xl"
          >
            <h1 className="text-2xl font-bold">{restaurant.name} menu import</h1>
            <p className="mt-1 text-sm text-grubr-muted-ink">
              Pulling menu data and rebuilding it inside Grubr.
            </p>
            {sourceUrl && (
              <p className="mt-2 text-xs text-grubr-muted-ink">
                Source: <span className="font-medium">{sourceUrl}</span>
              </p>
            )}
          </motion.div>

          {loading ? (
            <div className="mt-6 flex items-center gap-3 rounded-xl border border-white/30 bg-white/95 p-4 text-grubr-ink">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-grubr-orange border-t-transparent" />
              <p className="text-sm font-medium">Importing menu items...</p>
            </div>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {menuItems.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-2xl border border-white/30 bg-white/95 p-4 text-grubr-ink shadow-lg"
                >
                  <p className="text-sm font-bold">{item.name}</p>
                  <p className="mt-1 text-xs text-grubr-muted-ink">{item.description}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-sm font-bold text-grubr-orange">
                      ${(getItemPriceCents(item) / 100).toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        addItemToCart({
                          id: item.id,
                          restaurantId: item.restaurantId,
                          name: item.name,
                          priceCents: getItemPriceCents(item),
                        });
                        refreshCart();
                      }}
                      className="rounded-lg bg-grubr-orange px-3 py-1.5 text-xs font-bold text-white"
                    >
                      Add
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
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
          emptyLabel="Imported menu is ready. Add dishes to continue."
        />
      </main>
    </div>
  );
}
