"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "framer-motion";
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

/** Left → right: lower → higher mood */
const EMOJI_RATINGS: { rating: number; emoji: string; label: string }[] = [
  { rating: 1, emoji: "😞", label: "Skip" },
  { rating: 2, emoji: "😕", label: "Meh" },
  { rating: 3, emoji: "😐", label: "Okay" },
  { rating: 4, emoji: "😊", label: "Like it" },
  { rating: 5, emoji: "🤩", label: "Love it" },
];

const SPRING_SNAP = { type: "spring" as const, stiffness: 520, damping: 38 };
const SPRING_EXIT = { type: "spring" as const, stiffness: 420, damping: 32 };
const STAGGER = 0.04;

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

type SwipeDeckProps = {
  item: FoodItem;
  restaurant: NonNullable<ReturnType<typeof getRestaurantById>>;
  onComplete: (rating: number) => void;
};

function SwipeDeck({ item, restaurant, onComplete }: SwipeDeckProps) {
  const reduceMotion = useReducedMotion();
  const busy = useRef(false);
  const exitX = typeof window !== "undefined" ? window.innerWidth * 0.55 : 400;

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-10, 10], { clamp: true });

  const transitionEnter = useMemo(
    () =>
      reduceMotion ? { duration: 0.15 } : { ...SPRING_SNAP, mass: 0.85 },
    [reduceMotion],
  );
  const transitionExit = useMemo(
    () =>
      reduceMotion ? { duration: 0.12 } : { ...SPRING_EXIT, mass: 0.75 },
    [reduceMotion],
  );

  const runExit = useCallback(
    async (toRight: boolean) => {
      const target = toRight ? exitX : -exitX;
      await animate(x, target, transitionExit);
    },
    [exitX, transitionExit, x],
  );

  const commit = useCallback(
    async (rating: number, toRight: boolean) => {
      if (busy.current) return;
      busy.current = true;
      try {
        await runExit(toRight);
        onComplete(rating);
      } finally {
        busy.current = false;
      }
    },
    [onComplete, runExit],
  );

  const onEmojiPick = (rating: number) => {
    const positive = rating >= 4;
    void commit(rating, positive);
  };

  const onDragEnd = async (_: unknown, info: PanInfo) => {
    if (busy.current) return;
    const threshold = 96;
    const vx = info.velocity.x;
    const ox = info.offset.x;
    if (ox > threshold || vx > 420) {
      await commit(4, true);
    } else if (ox < -threshold || vx < -420) {
      await commit(2, false);
    } else {
      await animate(x, 0, SPRING_SNAP);
    }
  };

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-6">
      <div className="relative w-full px-1 pt-2">
        {/* Drag hints */}
        <motion.div
          className="pointer-events-none absolute inset-y-4 left-2 z-10 flex w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-[10px] font-bold uppercase tracking-wider text-white/50 backdrop-blur-sm"
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 0.35, x: 0 }}
          transition={{ delay: 0.35, ...transitionEnter }}
        >
          Pass
        </motion.div>
        <motion.div
          className="pointer-events-none absolute inset-y-4 right-2 z-10 flex w-16 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-[10px] font-bold uppercase tracking-wider text-white/50 backdrop-blur-sm"
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 0.35, x: 0 }}
          transition={{ delay: 0.35, ...transitionEnter }}
        >
          Like
        </motion.div>

        <motion.div
          key={item.id}
          drag="x"
          dragConstraints={{ left: -200, right: 200 }}
          dragElastic={0.12}
          onDragEnd={onDragEnd}
          initial={
            reduceMotion
              ? { opacity: 0 }
              : { opacity: 0, y: 36, scale: 0.94, filter: "blur(8px)" }
          }
          animate={
            reduceMotion
              ? { opacity: 1 }
              : {
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  filter: "blur(0px)",
                }
          }
          transition={transitionEnter}
          style={{ x, rotate }}
          whileDrag={{
            scale: 1.02,
            cursor: "grabbing",
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.18)",
          }}
          className="relative cursor-grab touch-pan-y overflow-hidden rounded-[1.75rem] border border-white/60 bg-grubr-surface/95 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.15)] ring-1 ring-white/80 backdrop-blur-md will-change-transform active:cursor-grabbing"
        >
          <motion.div
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/80 via-transparent to-orange-100/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.45 }}
          />
          <div className="relative h-36 overflow-hidden bg-gradient-to-br from-white/50 via-grubr-surface to-orange-50/90">
            <motion.div
              className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-grubr-orange/15 blur-2xl"
              animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.55, 0.4] }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
            <motion.div
              className="absolute -bottom-6 left-6 h-24 w-24 rounded-full bg-amber-200/30 blur-xl"
              animate={{ scale: [1, 1.12, 1] }}
              transition={{
                duration: 5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </div>
          <div className="relative flex min-h-[200px] flex-col p-6">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-grubr-orange/90">
                  {restaurant.name}
                </p>
                <div className="mt-1.5 flex items-center gap-2">
                  <StarRow value={restaurant.stars} />
                  <span className="text-sm font-bold text-grubr-ink">
                    {restaurant.stars.toFixed(1)}
                  </span>
                  <span className="text-xs text-grubr-muted-ink">
                    ({restaurant.reviewCount})
                  </span>
                </div>
              </div>
            </div>
            <h3 className="text-[1.35rem] font-bold leading-snug tracking-tight text-grubr-ink">
              {item.name}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-grubr-muted-ink">
              {item.description}
            </p>
          </div>
        </motion.div>
      </div>

      <div className="flex w-full flex-col items-center gap-3">
        <motion.p
          className="text-[11px] font-semibold uppercase tracking-[0.25em] text-white/55"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.35 }}
        >
          How does it feel?
        </motion.p>
        <div className="flex w-full max-w-sm items-center justify-between gap-1.5 sm:gap-2">
          {EMOJI_RATINGS.map(({ rating, emoji, label }, i) => (
            <motion.button
              key={rating}
              type="button"
              title={label}
              aria-label={label}
              initial={{ opacity: 0, y: 16, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{
                delay: 0.12 + i * STAGGER,
                ...SPRING_SNAP,
              }}
              whileHover={{
                scale: 1.12,
                y: -4,
                transition: { type: "spring", stiffness: 500, damping: 28 },
              }}
              whileTap={{ scale: 0.92 }}
              onClick={() => onEmojiPick(rating)}
              className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/30 bg-white/12 text-xl shadow-sm backdrop-blur-md transition-colors hover:border-white/50 hover:bg-white/20 sm:h-14 sm:w-14 sm:text-2xl"
            >
              <span className="select-none">{emoji}</span>
            </motion.button>
          ))}
        </div>
        <motion.p
          className="max-w-xs text-center text-xs leading-relaxed text-white/45"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
        >
          Tap a mood to send it — or drag the card. No extra taps.
        </motion.p>
      </div>
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
  }, [persist, promptDraft]);

  const current = queue[index];
  const restaurant = current
    ? getRestaurantById(current.restaurantId)
    : undefined;

  const suggestions = useMemo(() => {
    return Object.entries(swipeState.restaurantLikes)
      .filter(([, n]) => n >= LIKES_THRESHOLD_SUGGEST)
      .map(([id]) => getRestaurantById(id))
      .filter(Boolean) as NonNullable<ReturnType<typeof getRestaurantById>>[];
  }, [swipeState.restaurantLikes]);

  const handleSwipeComplete = useCallback(
    (rating: number) => {
      if (!current) return;
      const prev = getSwipeState();
      const seenItemIds = [...new Set([...prev.seenItemIds, current.id])];
      const restaurantLikes = { ...prev.restaurantLikes };
      const positive = rating >= 4;
      if (positive) {
        restaurantLikes[current.restaurantId] =
          (restaurantLikes[current.restaurantId] ?? 0) + 1;
      }
      const next: GrubrSwipeState = {
        ...prev,
        seenItemIds,
        restaurantLikes,
      };
      persist(next);

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
    },
    [current, index, persist, queue.length],
  );

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
      <div className="flex min-h-screen items-center justify-center bg-transparent">
        <motion.div
          className="h-10 w-10 rounded-full border-2 border-white border-t-transparent"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.85, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-transparent">
      <motion.div
        initial={{ y: -12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={SPRING_SNAP}
      >
        <GrubrHeader />
      </motion.div>
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 lg:flex-row lg:gap-8">
        <motion.aside
          className="order-2 flex w-full flex-col gap-3 lg:order-1 lg:w-64 lg:shrink-0"
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08, ...SPRING_SNAP }}
        >
          <h2 className="text-xs font-bold uppercase tracking-wide text-white/75">
            For you
          </h2>
          {suggestions.length === 0 ? (
            <motion.div
              className="rounded-2xl border border-dashed border-white/35 bg-grubr-surface/90 p-4 text-sm text-grubr-muted-ink shadow-lg backdrop-blur-sm"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={SPRING_SNAP}
            >
              Like {LIKES_THRESHOLD_SUGGEST}+ dishes you are into from the same
              spot and we will spotlight that restaurant here.
            </motion.div>
          ) : (
            <ul className="flex flex-col gap-3">
              {suggestions.map((r, i) => (
                <motion.li
                  key={r.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06, ...SPRING_SNAP }}
                  className="rounded-2xl border border-grubr-border-surface bg-grubr-surface p-4 shadow-lg"
                >
                  <p className="font-bold text-grubr-ink">{r.name}</p>
                  <p className="mt-1 text-xs text-grubr-muted-ink">{r.cuisine}</p>
                  <p className="mt-2 text-xs font-medium text-grubr-orange">
                    You liked {swipeState.restaurantLikes[r.id] ?? 0} dishes
                    here
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className="rounded-xl bg-grubr-orange py-2 text-xs font-bold text-white shadow-md hover:bg-grubr-orange-dark"
                      onClick={() =>
                        alert(
                          `${r.name} — order flow would open here in the full product.`,
                        )
                      }
                    >
                      Continue to restaurant
                    </motion.button>
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      className="rounded-xl border border-grubr-border-surface bg-white/90 py-2 text-xs font-semibold text-grubr-ink hover:bg-grubr-surface"
                      onClick={() => {}}
                    >
                      No, keep swiping
                    </motion.button>
                  </div>
                </motion.li>
              ))}
            </ul>
          )}
          <motion.button
            type="button"
            onClick={handleReset}
            whileHover={{ scale: 1.02, backgroundColor: "rgba(255,255,255,0.22)" }}
            whileTap={{ scale: 0.98 }}
            className="mt-auto rounded-xl border border-white/40 bg-white/15 py-2.5 text-xs font-semibold text-white backdrop-blur-sm"
          >
            Reset data & memory
          </motion.button>
        </motion.aside>

        <section className="order-1 flex min-h-0 flex-1 flex-col items-center justify-center lg:order-2">
          {!current || !restaurant ? (
            <motion.div
              className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={SPRING_SNAP}
            >
              <p className="text-lg font-semibold text-white">
                You are caught up for now
              </p>
              <p className="max-w-md text-sm text-white/80">
                Tweak the prompt on the right or reset data to see more demo
                dishes.
              </p>
              <motion.button
                type="button"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
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
                className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-grubr-orange shadow-lg"
              >
                Replay demo dishes
              </motion.button>
            </motion.div>
          ) : (
            <SwipeDeck
              key={current.id}
              item={current}
              restaurant={restaurant}
              onComplete={handleSwipeComplete}
            />
          )}
        </section>

        <motion.aside
          className="order-3 w-full lg:w-72 lg:shrink-0"
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, ...SPRING_SNAP }}
        >
          <h2 className="text-xs font-bold uppercase tracking-wide text-white/75">
            Food mood
          </h2>
          <p className="mt-1 text-xs text-white/80">
            Tell Grubr how you feel — demo filters adjust the dish list.
          </p>
          <motion.textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            placeholder='e.g. "I am feeling Mediterranean right now" or "I do not really want Mexican food"'
            rows={6}
            whileFocus={{
              scale: 1.01,
              boxShadow: "0 0 0 3px rgba(255,255,255,0.35)",
            }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="mt-3 w-full resize-none rounded-2xl border border-grubr-border-surface bg-grubr-surface p-3 text-sm text-grubr-ink outline-none placeholder:text-grubr-muted-ink"
          />
          <motion.button
            type="button"
            onClick={applyPrompt}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="mt-3 w-full rounded-xl bg-white py-2.5 text-sm font-bold text-grubr-orange shadow-md"
          >
            Update context
          </motion.button>
        </motion.aside>
      </div>
    </div>
  );
}
