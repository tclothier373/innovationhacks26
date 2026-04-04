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
          className="overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/16"
        >

          {/* Section: Delivery mode */}
          <div className="border-b border-b1 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-i2">
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
                      ? "bg-brand text-white shadow-md shadow-brand/25"
                      : "border-2 border-b2 bg-s1 text-i1 hover:bg-s2"
                  }`}
                >
                  {m === "delivery" ? "🚗 Delivery" : "🏠 Pickup"}
                </button>
              ))}
            </div>
          </div>

          {/* Section: Address & time */}
          <div className="border-b border-b1 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-i2">
              Details
            </p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-semibold text-i0">
                  {mode === "delivery" ? "Delivery address" : "Pickup address"}
                </label>
                <div className="flex items-center gap-2 rounded-xl border border-b1 bg-s1 px-3 py-2.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
                  <span className="text-brand">📍</span>
                  <input
                    type="text"
                    value={currentAddress}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Enter your address"
                    className="flex-1 bg-transparent text-sm text-i0 placeholder:text-i3 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-i0">
                  {mode === "delivery" ? "Delivery time" : "Pickup time"}
                </label>
                <div className="flex items-center gap-2 rounded-xl border border-b1 bg-s1 px-3 py-2.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
                  <span className="text-brand">🕐</span>
                  <input
                    type="text"
                    value={readyTime}
                    onChange={(e) => setReadyTime(e.target.value)}
                    placeholder="e.g. 7:30 PM"
                    className="flex-1 bg-transparent text-sm text-i0 placeholder:text-i3 outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section: Cart items */}
          <div className="border-b border-b1 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-i2">
              Your Order
            </p>
            {cart.length === 0 ? (
              <div className="rounded-xl border border-dashed border-b2 bg-s1 px-4 py-5 text-center">
                <p className="text-sm text-i3">Cart is empty</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-b1 bg-s1 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-i0">{item.name}</p>
                      <p className="text-xs text-i3">Qty {item.quantity}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-brand">
                        {formatCurrency(item.priceCents * item.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          removeItemFromCart(item.id);
                          setCartRefreshKey((k) => k + 1);
                        }}
                        className="rounded-lg border border-b2 bg-white px-2 py-1 text-[11px] font-semibold text-i2 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-500"
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
          <div className="border-b border-b1 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-i2">
              Pricing
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-i2">Subtotal</span>
                <span className="font-semibold text-i0">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-i2">Platform fee (5%)</span>
                <span className="font-semibold text-i0">{formatCurrency(platformCut)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-i2">Tax (8.875%)</span>
                <span className="font-semibold text-i0">{formatCurrency(tax)}</span>
              </div>
              <div className="flex justify-between border-t border-b1 pt-2.5 mt-2">
                <span className="text-base font-bold text-i0">Total</span>
                <span className="text-base font-extrabold text-brand">{formatCurrency(totalAfterTax)}</span>
              </div>
            </div>
          </div>

          {/* Section: Payment */}
          <div className="border-b border-b1 px-5 py-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-i2">
              Payment
            </p>
            <div className="rounded-xl border border-b1 bg-s1 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#635BFF]">
                  <span className="text-lg">💳</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-i0">Stripe Checkout</p>
                  <p className="text-xs text-i3">Secure payment powered by Stripe</p>
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
                  ? "bg-brand text-white shadow-lg shadow-brand/30 hover:bg-brand-dk"
                  : "bg-s3 text-i3 cursor-not-allowed"
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
              <p className="mt-2 text-center text-xs text-i3">
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
              className="mt-3 w-full rounded-xl border border-b1 bg-s1 py-2.5 text-sm font-semibold text-i2 transition-colors hover:bg-s2"
            >
              ← Back
            </button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
