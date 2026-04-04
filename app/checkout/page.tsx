"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
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

export default function CheckoutPage() {
  const router = useRouter();
  const isClient = useIsClient();
  const [cartRefreshKey, setCartRefreshKey] = useState(0);
  const [address, setAddress] = useState("");
  const [mode, setMode] = useState<"delivery" | "pickup">("delivery");
  const [readyTime, setReadyTime] = useState(nowPlusMinutesLabel(35));
  const [stripeOpened, setStripeOpened] = useState(false);
  const cart: GrubrCartItem[] = useMemo(
    () => {
      void cartRefreshKey;
      return isClient ? getCartItems() : [];
    },
    [isClient, cartRefreshKey],
  );
  const derivedAddress = useMemo(() => {
    if (!isClient) return "";
    const saved = getCheckoutAddress();
    if (saved) return saved;
    const profile = getProfile();
    if (!profile?.location) return "";
    return `${profile.location.label} (${profile.location.lat.toFixed(3)}, ${profile.location.lng.toFixed(3)})`;
  }, [isClient]);
  const currentAddress = address || derivedAddress;

  const total = useMemo(
    () => cart.reduce((sum, i) => sum + i.priceCents * i.quantity, 0),
    [cart],
  );
  const platformCut = useMemo(
    () => toCents(total * PLATFORM_CUT_RATE),
    [total],
  );
  const tax = useMemo(() => toCents(total * TAX_RATE), [total]);
  const totalAfterTax = useMemo(
    () => total + platformCut + tax,
    [total, platformCut, tax],
  );

  function handleStripe() {
    if (typeof window !== "undefined") {
      window.open(
        "https://stripe.com/payments/checkout",
        "_blank",
        "noopener,noreferrer",
      );
    }
    setStripeOpened(true);
  }

  function placeOrder() {
    if (!currentAddress.trim() || cart.length === 0 || !stripeOpened) return;
    saveCheckoutAddress(currentAddress);
    clearCart();
    setCartRefreshKey((k) => k + 1);
    router.push(
      `/order-confirmed?mode=${mode}&time=${encodeURIComponent(readyTime)}`,
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <GrubrHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-8">
        <div className="rounded-2xl border border-white/35 bg-white/95 p-6 text-grubr-ink shadow-xl">
          <h1 className="text-2xl font-bold">Checkout</h1>
          <p className="mt-1 text-sm text-grubr-muted-ink">
            Confirm your delivery info and place the order.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-sm font-semibold">Delivery or pickup</p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("delivery")}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    mode === "delivery"
                      ? "bg-grubr-orange text-white"
                      : "border border-grubr-border-surface"
                  }`}
                >
                  Delivery
                </button>
                <button
                  type="button"
                  onClick={() => setMode("pickup")}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                    mode === "pickup"
                      ? "bg-grubr-orange text-white"
                      : "border border-grubr-border-surface"
                  }`}
                >
                  Pickup
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold">
                Time of {mode === "delivery" ? "delivery" : "pickup"}
              </label>
              <input
                type="text"
                value={readyTime}
                onChange={(e) => setReadyTime(e.target.value)}
                placeholder="e.g. 7:30 PM"
                className="mt-2 w-full rounded-xl border border-grubr-border-surface px-3 py-2.5 text-sm outline-none focus:border-grubr-orange"
              />
            </div>
          </div>

          <label className="mt-5 block text-sm font-semibold">Address</label>
          <input
            type="text"
            value={currentAddress}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Enter your delivery address"
            className="mt-2 w-full rounded-xl border border-grubr-border-surface px-3 py-2.5 text-sm outline-none focus:border-grubr-orange"
          />

          <div className="mt-5 border-t border-grubr-border-surface pt-4">
            <p className="text-sm font-semibold">Cart</p>
            {cart.length === 0 ? (
              <p className="mt-2 text-sm text-grubr-muted-ink">Your cart is empty.</p>
            ) : (
              <div className="mt-2 space-y-2">
                {cart.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between rounded-lg border border-grubr-border-surface p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold">{item.name}</p>
                      <p className="text-xs text-grubr-muted-ink">Qty {item.quantity}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-grubr-orange">
                        {formatCurrency(item.priceCents * item.quantity)}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          removeItemFromCart(item.id);
                          setCartRefreshKey((k) => k + 1);
                        }}
                        className="rounded-md border border-grubr-border-surface px-2 py-1 text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 space-y-2 border-t border-grubr-border-surface pt-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Subtotal</span>
              <span className="font-semibold">{formatCurrency(total)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Our cut (5%)</span>
              <span className="font-semibold">{formatCurrency(platformCut)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">Tax</span>
              <span className="font-semibold">{formatCurrency(tax)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-grubr-border-surface pt-3">
              <span className="text-sm font-semibold">Total after tax</span>
              <span className="text-lg font-bold text-grubr-orange">
                {formatCurrency(totalAfterTax)}
              </span>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-grubr-border-surface bg-white p-4">
            <p className="text-sm font-semibold">Payment</p>
            <p className="mt-1 text-xs text-grubr-muted-ink">
              Payment is outsourced through Stripe Checkout.
            </p>
            <button
              type="button"
              onClick={handleStripe}
              className="mt-3 rounded-lg border border-grubr-border-surface px-4 py-2 text-sm font-semibold"
            >
              {stripeOpened ? "Stripe checkout opened" : "Pay with Stripe"}
            </button>
          </div>

          <button
            type="button"
            onClick={placeOrder}
            disabled={!currentAddress.trim() || cart.length === 0 || !stripeOpened}
            className="mt-5 rounded-xl bg-grubr-orange px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            Confirm order
          </button>

          <button
            type="button"
            onClick={() => router.push("/swiping")}
            className="ml-3 mt-5 rounded-xl border border-grubr-border-surface px-5 py-2.5 text-sm font-semibold"
          >
            Back to Grubr
          </button>
        </div>
      </main>
    </div>
  );
}
