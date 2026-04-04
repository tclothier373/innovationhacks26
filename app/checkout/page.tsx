"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { GrubrHeader } from "@/components/grubr-header";
import {
  clearCart,
  getCartItems,
  getCheckoutAddress,
  getProfile,
  removeItemFromCart,
  saveCheckoutAddress,
  type GrubrCartItem,
} from "@/lib/grubr-storage";
import { useIsClient } from "@/lib/use-is-client";

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

const PLATFORM_CUT_RATE = 0.05;
const TAX_RATE = 0.08875;

function toCents(amount: number): number {
  return Math.round(amount);
}

function nowPlusMinutesLabel(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

const SPRING = { type: "spring" as const, stiffness: 440, damping: 36 };

export default function CheckoutPage() {
  const router = useRouter();
  const isClient = useIsClient();
  const [cartRefreshKey, setCartRefreshKey] = useState(0);
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState<"delivery" | "pickup">("delivery");
  const [readyTime, setReadyTime] = useState(nowPlusMinutesLabel(35));
  const [stripeOpened, setStripeOpened] = useState(false);

  const cart: GrubrCartItem[] = useMemo(() => {
    void cartRefreshKey;
    return isClient ? getCartItems() : [];
  }, [isClient, cartRefreshKey]);

  const derivedAddress = useMemo(() => {
    if (!isClient) return "";
    const saved = getCheckoutAddress();
    if (saved) return saved;
    const profile = getProfile();
    if (!profile?.location) return "";
    return `${profile.location.label} (${profile.location.lat.toFixed(3)}, ${profile.location.lng.toFixed(3)})`;
  }, [isClient]);

  const currentAddress = address || derivedAddress;

  const subtotal     = useMemo(() => cart.reduce((s, i) => s + i.priceCents * i.quantity, 0), [cart]);
  const platformCut  = useMemo(() => toCents(subtotal * PLATFORM_CUT_RATE), [subtotal]);
  const tax          = useMemo(() => toCents(subtotal * TAX_RATE), [subtotal]);
  const totalAfterTax = useMemo(() => subtotal + platformCut + tax, [subtotal, platformCut, tax]);

  function handleStripe() {
    if (typeof window !== "undefined") {
      window.open("https://stripe.com/payments/checkout", "_blank", "noopener,noreferrer");
    }
    setStripeOpened(true);
  }

  function placeOrder() {
    if (!currentAddress.trim() || cart.length === 0 || !stripeOpened) return;
    saveCheckoutAddress(currentAddress);
    clearCart();
    setCartRefreshKey((k) => k + 1);
    router.push(`/order-confirmed?mode=${mode}&time=${encodeURIComponent(readyTime)}`);
  }

  const canConfirm = currentAddress.trim() !== "" && cart.length > 0 && stripeOpened;

  return (
    <div className="flex min-h-screen flex-col">
      <GrubrHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {/* Page title */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
          className="mb-4 text-center"
        >
          <p className="text-[10px] font-bold uppercase tracking-[0.20em] text-oo-s">Almost there</p>
          <h1
            className="mt-1 text-3xl font-extrabold text-white"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Checkout
          </h1>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, ...SPRING }}
          className="overflow-hidden rounded-3xl bg-white text-gray-900 shadow-2xl shadow-black/16"
        >

          {/* Section: Delivery mode */}
          <div className="border-b border-stone-100 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
              Fulfillment
            </p>
            <div className="flex gap-2">
              {(["delivery", "pickup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${
                    mode === m
                      ? "bg-[#FF5500] text-white shadow-md shadow-[#FF5500]/25"
                      : "border-2 border-stone-200 bg-stone-50 text-gray-800 hover:bg-stone-100"
                  }`}
                >
                  {m === "delivery" ? "🚗 Delivery" : "🏠 Pickup"}
                </button>
              ))}
            </div>
          </div>

          {/* Section: Address & time */}
          <div className="border-b border-stone-100 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
              Details
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-800">
                  {mode === "delivery" ? "Delivery address" : "Pickup address"}
                </label>
                <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 focus-within:border-[#FF5500] focus-within:ring-2 focus-within:ring-[#FF5500]/15">
                  <span className="text-[#FF5500]">📍</span>
                  <input
                    type="text"
                    value={currentAddress}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter your address"
                    className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-800">
                  {mode === "delivery" ? "Delivery time" : "Pickup time"}
                </label>
                <div className="flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 focus-within:border-[#FF5500] focus-within:ring-2 focus-within:ring-[#FF5500]/15">
                  <span className="text-[#FF5500]">🕐</span>
                  <input
                    type="text"
                    value={readyTime}
                    onChange={(e) => setReadyTime(e.target.value)}
                    placeholder="e.g. 7:30 PM"
                    className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section: Cart items */}
          <div className="border-b border-stone-100 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
              Your Order
            </p>
            {cart.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-4 py-5 text-center">
                <p className="text-sm text-gray-400">Cart is empty</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
                      <p className="text-xs text-gray-400">Qty {item.quantity}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-[#FF5500]">
                        {formatCurrency(item.priceCents * item.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          removeItemFromCart(item.id);
                          setCartRefreshKey((k) => k + 1);
                        }}
                        className="rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-semibold text-gray-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section: Pricing */}
          <div className="border-b border-stone-100 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
              Pricing
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Subtotal</span>
                <span className="font-semibold text-gray-900">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Platform fee (5%)</span>
                <span className="font-semibold text-gray-900">{formatCurrency(platformCut)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Tax (8.875%)</span>
                <span className="font-semibold text-gray-900">{formatCurrency(tax)}</span>
              </div>
              <div className="flex justify-between border-t border-stone-100 pt-2.5 mt-2">
                <span className="text-base font-bold text-gray-900">Total</span>
                <span className="text-base font-extrabold text-[#FF5500]">{formatCurrency(totalAfterTax)}</span>
              </div>
            </div>
          </div>

          {/* Section: Payment */}
          <div className="border-b border-stone-100 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-gray-500">
              Payment
            </p>
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#635BFF]">
                  <span className="text-lg">💳</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">Stripe Checkout</p>
                  <p className="text-xs text-gray-400">Secure payment powered by Stripe</p>
                </div>
              </div>
              <motion.button
                type="button"
                onClick={handleStripe}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className={`mt-3 w-full rounded-xl py-2.5 text-sm font-bold transition-all ${
                  stripeOpened
                    ? "bg-green-50 text-green-700 border-2 border-green-200"
                    : "bg-[#635BFF] text-white shadow-md shadow-[#635BFF]/25 hover:bg-[#5448d4]"
                }`}
              >
                {stripeOpened ? "✓ Payment verified" : "Pay with Stripe →"}
              </motion.button>
            </div>
          </div>

          {/* Section: Confirm */}
          <div className="px-5 py-4">
            <motion.button
              type="button"
              onClick={placeOrder}
              disabled={!canConfirm}
              whileHover={canConfirm ? { scale: 1.02 } : undefined}
              whileTap={canConfirm ? { scale: 0.97 } : undefined}
              className={`w-full rounded-xl py-4 text-base font-extrabold transition-all ${
                canConfirm
                  ? "bg-[#FF5500] text-white shadow-lg shadow-[#FF5500]/30 hover:bg-[#CC3D00]"
                  : "bg-stone-200 text-gray-400 cursor-not-allowed"
              }`}
            >
              {!currentAddress.trim()
                ? "Enter your address to continue"
                : cart.length === 0
                  ? "Add items to cart first"
                  : !stripeOpened
                    ? "Complete payment first"
                    : `Confirm order · ${formatCurrency(totalAfterTax)}`}
            </motion.button>

            {!canConfirm && (
              <p className="mt-2 text-center text-xs text-gray-400">
                {!currentAddress.trim()
                  ? "Please fill in your address above"
                  : cart.length === 0
                    ? "Go back and add items to your cart"
                    : "Verify payment through Stripe above"}
              </p>
            )}

            <button
              type="button"
              onClick={() => router.back()}
              className="mt-3 w-full rounded-xl border border-stone-200 bg-stone-50 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:bg-stone-100"
            >
              ← Back
            </button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
