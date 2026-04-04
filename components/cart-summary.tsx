"use client";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import type { GrubrCartItem } from "@/lib/grubr-storage";

type CartSummaryProps = {
  items: GrubrCartItem[];
  onAdd?: (itemId: string) => void;
  onRemove?: (itemId: string) => void;
  emptyLabel?: string;
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function cartTotalCents(items: GrubrCartItem[]): number {
  return items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
}

export function CartSummary({
  items,
  onAdd,
  onRemove,
  emptyLabel = "Add items to start your order.",
}: CartSummaryProps) {
  const total = cartTotalCents(items);

  return (
    <aside className="card flex w-full flex-col overflow-hidden rounded-2xl lg:w-80">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-stone-100 bg-stone-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🛒</span>
          <h2
            className="text-sm font-extrabold tracking-tight text-gray-900"
            style={{ fontFamily: "var(--font-syne)" }}
          >
            Your Cart
          </h2>
        </div>
        {items.length > 0 && (
          <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-white">
            {items.reduce((s, i) => s + i.quantity, 0)}
          </span>
        )}
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-200 bg-stone-50 px-4 py-6">
            <span className="text-3xl">🍴</span>
            <p className="text-center text-sm text-gray-500">{emptyLabel}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-xl border border-stone-200 bg-white text-gray-900 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-snug text-gray-900">
                      {item.name}
                    </p>
                    <span className="shrink-0 text-xs font-bold text-brand">
                      {formatCurrency(item.priceCents * item.quantity)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {formatCurrency(item.priceCents)} ea.
                    </span>
                    {(onAdd || onRemove) && (
                      <div className="flex items-center gap-1.5 rounded-full border border-stone-200 bg-stone-100 px-1 py-0.5">
                        {onRemove && (
                          <button
                            type="button"
                            onClick={() => onRemove(item.id)}
                            className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-gray-700 transition-colors hover:bg-stone-200"
                          >
                            −
                          </button>
                        )}
                        <span className="min-w-[16px] text-center text-xs font-bold text-gray-900">
                          {item.quantity}
                        </span>
                        {onAdd && (
                          <button
                            type="button"
                            onClick={() => onAdd(item.id)}
                            className="flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold text-brand transition-colors hover:bg-orange-50"
                          >
                            +
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-stone-100 bg-white px-4 py-3 text-gray-900">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Subtotal</span>
          <span className="text-sm font-bold text-brand">
            {formatCurrency(total)}
          </span>
        </div>
        <Link
          href="/checkout"
          className={`block rounded-xl py-2.5 text-center text-sm font-bold transition-all ${
            items.length === 0
              ? "cursor-not-allowed bg-stone-200 text-gray-400"
              : "bg-brand text-white shadow-md shadow-brand/30 hover:bg-brand-dk"
          }`}
          aria-disabled={items.length === 0}
        >
          {items.length === 0 ? "Add items first" : "Go to Checkout →"}
        </Link>
      </div>
    </aside>
  );
}
