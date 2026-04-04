import Link from "next/link";
import { motion } from "framer-motion";
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
  emptyLabel = "No items in cart yet.",
}: CartSummaryProps) {
  const total = cartTotalCents(items);

  return (
    <aside className="w-full rounded-2xl border border-grubr-border-surface bg-grubr-surface/95 p-4 text-grubr-ink shadow-xl backdrop-blur-sm lg:w-80">
      <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-grubr-orange">
        Cart
      </h2>
      <div className="mt-3 space-y-2">
        {items.length === 0 ? (
          <p className="rounded-xl border border-dashed border-grubr-border-surface p-3 text-sm text-grubr-muted-ink">
            {emptyLabel}
          </p>
        ) : (
          items.map((item) => (
            <motion.div
              key={item.id}
              layout
              className="rounded-xl border border-grubr-border-surface bg-white/90 p-3"
            >
              <p className="text-sm font-semibold">{item.name}</p>
              <p className="text-xs text-grubr-muted-ink">
                {formatCurrency(item.priceCents)} each
              </p>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-grubr-orange">
                  Qty {item.quantity}
                </span>
                <div className="flex gap-2">
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(item.id)}
                      className="rounded-md border border-grubr-border-surface px-2 py-1 text-xs font-semibold"
                    >
                      -
                    </button>
                  )}
                  {onAdd && (
                    <button
                      type="button"
                      onClick={() => onAdd(item.id)}
                      className="rounded-md border border-grubr-border-surface px-2 py-1 text-xs font-semibold"
                    >
                      +
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-grubr-border-surface pt-3">
        <span className="text-sm font-semibold">Subtotal</span>
        <span className="text-sm font-bold text-grubr-orange">
          {formatCurrency(total)}
        </span>
      </div>

      <Link
        href="/checkout"
        className="mt-4 block rounded-xl bg-grubr-orange py-2.5 text-center text-sm font-bold text-white shadow-md hover:bg-grubr-orange-dark"
      >
        Checkout
      </Link>
    </aside>
  );
}
