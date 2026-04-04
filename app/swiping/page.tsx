"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GrubrHeader } from "@/components/grubr-header";
import {
  getProfile,
  getSwipeState,
  resetAllGrubrData,
  saveSwipeState,
  type GrubrSwipeState,
} from "@/lib/grubr-storage";
import {
  filterItemsByPrompt,
  getRestaurantById,
  LIKES_THRESHOLD_SUGGEST,
  type FoodItem,
} from "@/lib/mock-food";
import { useIsClient } from "@/lib/use-is-client";

/** Top = best (5), bottom = worst (1) */
const EMOJI_RATINGS: { rating: number; emoji: string; label: string }[] = [
  { rating: 5, emoji: "🤩", label: "Love it" },
  { rating: 4, emoji: "😊", label: "Like it" },
  { rating: 3, emoji: "😐", label: "Okay" },
  { rating: 2, emoji: "😕", label: "Meh" },
  { rating: 1, emoji: "😞", label: "Skip" },
];

function StarRow({ value }: { value: number }) {
  const full = Math.min(5, Math.max(0, Math.floor(value)));
  return (
    <div className="flex items-center gap-0.5 text-grubr-orange" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i}>{i < full ? "★" : "☆"}</span>
      ))}
    </div>
  );
}

export default function SwipingPage() {
  const router = useRouter();
  const isClient = useIsClient();
  const [queue, setQueue] = useState<FoodItem[]>([]);
  const [index, setIndex] = useState(0);
  const [swipeState, setSwipeState] = useState<GrubrSwipeState>(getSwipeState);
  const [promptDraft, setPromptDraft] = useState("");
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const profile = useMemo(() => (isClient ? getProfile() : null), [isClient]);

  useEffect(() => {
    if (!isClient) return;
    const s = getSwipeState();
    if (!getProfile()) {
      router.replace("/onboarding");
      return;
    }
    const items = filterItemsByPrompt(s.contextPrompt, getProfile());
    const unseen = items.filter((i) => !s.seenItemIds.includes(i.id));
    queueMicrotask(() => {
      setSwipeState(s);
      setPromptDraft(s.contextPrompt);
      setQueue(unseen.length ? unseen : items);
    });
  }, [router, isClient]);

  const persist = useCallback((next: GrubrSwipeState) => {
    setSwipeState(next);
    saveSwipeState(next);
  }, []);

  const applyPrompt = useCallback(() => {
    const prev = getSwipeState();
    const next: GrubrSwipeState = {
      ...prev,
      contextPrompt: promptDraft.trim(),
    };
    persist(next);
    const items = filterItemsByPrompt(next.contextPrompt, getProfile());
    const unseen = items.filter((i) => !next.seenItemIds.includes(i.id));
    setQueue(unseen.length ? unseen : items);
    setIndex(0);
    setSelectedRating(null);
  }, [persist, promptDraft]);

  const current = queue[index];
  const restaurant = current ? getRestaurantById(current.restaurantId) : null;

  const suggestions = useMemo(() => {
    return Object.entries(swipeState.restaurantLikes)
      .filter(([, n]) => n >= LIKES_THRESHOLD_SUGGEST)
      .map(([id]) => getRestaurantById(id))
      .filter(Boolean) as NonNullable<ReturnType<typeof getRestaurantById>>[];
  }, [swipeState.restaurantLikes]);

  function advance(item: FoodItem, direction: "pass" | "like") {
    const prev = getSwipeState();
    const seenItemIds = [...new Set([...prev.seenItemIds, item.id])];
    const restaurantLikes = { ...prev.restaurantLikes };
    if (direction === "like") {
      restaurantLikes[item.restaurantId] =
        (restaurantLikes[item.restaurantId] ?? 0) + 1;
    }
    const next: GrubrSwipeState = {
      ...prev,
      seenItemIds,
      restaurantLikes,
    };
    persist(next);
    setSelectedRating(null);
    setDragX(0);

    const len = queue.length;
    const nextIndex = index + 1;
    if (nextIndex >= len) {
      const items = filterItemsByPrompt(next.contextPrompt, getProfile());
      const unseen = items.filter((i) => !seenItemIds.includes(i.id));
      setQueue(unseen.length ? unseen : items);
      setIndex(0);
    } else {
      setIndex(nextIndex);
    }
  }

  function onPass() {
    if (!current || selectedRating === null) return;
    advance(current, "pass");
  }

  function onLike() {
    if (!current || selectedRating === null) return;
    advance(current, "like");
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!current || selectedRating === null) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
    startX.current = e.clientX;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    setDragX(e.clientX - startX.current);
  }

  function onPointerUp() {
    if (!dragging) return;
    setDragging(false);
    const threshold = 100;
    if (dragX > threshold) {
      if (selectedRating !== null && current) advance(current, "like");
    } else if (dragX < -threshold) {
      if (selectedRating !== null && current) advance(current, "pass");
    }
    setDragX(0);
  }

  function handleReset() {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Reset all saved preferences and swipe history? You will go through setup again.",
      )
    ) {
      return;
    }
    resetAllGrubrData();
    router.push("/onboarding");
  }

  if (!isClient || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-grubr-cream">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-grubr-orange border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-grubr-cream">
      <GrubrHeader />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 lg:flex-row lg:gap-6">
        {/* Left: suggestions */}
        <aside className="order-2 flex w-full flex-col gap-3 lg:order-1 lg:w-64 lg:shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-wide text-grubr-muted">
            For you
          </h2>
          {suggestions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-grubr-border bg-white p-4 text-sm text-grubr-muted">
              Like {LIKES_THRESHOLD_SUGGEST}+ dishes you are into from the same
              spot and we will spotlight that restaurant here.
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {suggestions.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border border-grubr-border bg-white p-4 shadow-sm"
                >
                  <p className="font-bold text-foreground">{r.name}</p>
                  <p className="mt-1 text-xs text-grubr-muted">{r.cuisine}</p>
                  <p className="mt-2 text-xs font-medium text-grubr-orange">
                    You liked {swipeState.restaurantLikes[r.id] ?? 0} dishes
                    here
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-grubr-orange py-2 text-xs font-bold text-white hover:bg-grubr-orange-dark"
                      onClick={() =>
                        alert(
                          `${r.name} — order flow would open here in the full product.`,
                        )
                      }
                    >
                      Continue to restaurant
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-grubr-border py-2 text-xs font-semibold text-foreground hover:bg-grubr-cream"
                      onClick={() => {}}
                    >
                      No, keep swiping
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="mt-auto rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-semibold text-red-800 hover:bg-red-100"
          >
            Reset data & memory
          </button>
        </aside>

        {/* Center: card + emojis */}
        <section className="order-1 flex min-h-0 flex-1 flex-col items-center lg:order-2">
          {!current ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
              <p className="text-lg font-semibold text-foreground">
                You are caught up for now
              </p>
              <p className="max-w-md text-sm text-grubr-muted">
                Tweak the prompt on the right or reset data to see more demo
                dishes.
              </p>
              <button
                type="button"
                onClick={() => {
                  const prev = getSwipeState();
                  persist({ ...prev, seenItemIds: [] });
                  const items = filterItemsByPrompt(
                    prev.contextPrompt,
                    getProfile(),
                  );
                  setQueue(items);
                  setIndex(0);
                }}
                className="rounded-lg bg-grubr-orange px-4 py-2 text-sm font-bold text-white"
              >
                Replay demo dishes
              </button>
            </div>
          ) : (
            <>
              <div className="flex w-full max-w-md flex-1 flex-col gap-4 sm:flex-row sm:items-stretch sm:justify-center">
                <div
                  ref={cardRef}
                  className="relative flex min-h-[340px] flex-1 touch-pan-y flex-col overflow-hidden rounded-2xl border border-grubr-border bg-white shadow-md"
                  style={{
                    transform: `translateX(${dragX}px) rotate(${dragX * 0.05}deg)`,
                    transition: dragging ? "none" : "transform 0.2s ease-out",
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                >
                  <div className="h-40 bg-gradient-to-br from-grubr-orange-light via-white to-amber-50" />
                  <div className="flex flex-1 flex-col p-5">
                    {restaurant && (
                      <div className="mb-3 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-grubr-orange">
                            {restaurant.name}
                          </p>
                          <div className="mt-1 flex items-center gap-2">
                            <StarRow value={restaurant.stars} />
                            <span className="text-sm font-bold text-foreground">
                              {restaurant.stars.toFixed(1)}
                            </span>
                            <span className="text-xs text-grubr-muted">
                              ({restaurant.reviewCount})
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    <h3 className="text-xl font-bold leading-tight text-foreground">
                      {current.name}
                    </h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-grubr-muted">
                      {current.description}
                    </p>
                    <p className="mt-3 text-xs text-grubr-muted">
                      Drag card right to like, left to pass — after you pick a
                      mood below.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col items-center justify-center gap-1 sm:w-14">
                  <span className="mb-1 text-[10px] font-bold uppercase tracking-wide text-grubr-muted">
                    Mood
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {EMOJI_RATINGS.map(({ rating, emoji, label }) => {
                      const active = selectedRating === rating;
                      return (
                        <button
                          key={rating}
                          type="button"
                          onClick={() => setSelectedRating(rating)}
                          title={label}
                          className={`flex h-11 w-11 items-center justify-center rounded-xl border-2 text-xl transition-all ${
                            active
                              ? "border-grubr-orange bg-grubr-orange-light scale-110"
                              : "border-grubr-border bg-white hover:border-grubr-orange/40"
                          }`}
                          aria-label={label}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6 flex w-full max-w-md gap-3">
                <button
                  type="button"
                  onClick={onPass}
                  disabled={selectedRating === null}
                  className="flex-1 rounded-xl border-2 border-grubr-border bg-white py-3 text-sm font-bold text-grubr-muted transition-colors hover:bg-grubr-cream disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Pass
                </button>
                <button
                  type="button"
                  onClick={onLike}
                  disabled={selectedRating === null}
                  className="flex-1 rounded-xl bg-grubr-orange py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-grubr-orange-dark disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Like
                </button>
              </div>
            </>
          )}
        </section>

        {/* Right: prompt */}
        <aside className="order-3 w-full lg:w-72 lg:shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-wide text-grubr-muted">
            Food mood
          </h2>
          <p className="mt-1 text-xs text-grubr-muted">
            Tell Grubr how you feel — demo filters adjust the dish list.
          </p>
          <textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            placeholder='e.g. "I am feeling Mediterranean right now" or "I do not really want Mexican food"'
            rows={6}
            className="mt-3 w-full resize-none rounded-xl border border-grubr-border bg-white p-3 text-sm outline-none ring-grubr-orange/30 placeholder:text-grubr-muted focus:border-grubr-orange focus:ring-2"
          />
          <button
            type="button"
            onClick={applyPrompt}
            className="mt-3 w-full rounded-lg bg-grubr-orange py-2.5 text-sm font-bold text-white hover:bg-grubr-orange-dark"
          >
            Update context
          </button>
        </aside>
      </div>
    </div>
  );
}
