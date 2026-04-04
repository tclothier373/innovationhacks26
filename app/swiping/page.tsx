"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type PanInfo,
} from "framer-motion";
import { GrubrHeader } from "@/components/grubr-header";
import {
  clearCart,
  getSuggestionDismissLikeCheckpoints,
  setSuggestionDismissLikeCheckpoint,
  getProfile,
  getSwipeState,
  resetAllGrubrData,
  saveSwipeState,
  setTargetRestaurantId,
  type GrubrSwipeState,
} from "@/lib/grubr-storage";
import {
  filterItemsByPrompt,
  getRestaurantById,
  LIKES_THRESHOLD_SUGGEST,
  setDynamicRestaurants,
  type FoodItem,
  type Restaurant,
} from "@/lib/mock-food";
import {
  mapPlacesApiToRestaurants,
  type PlacesApiRestaurantRow,
} from "@/lib/places-bridge";
import { getCuisineVisual } from "@/lib/cuisine-utils";
import { useIsClient } from "@/lib/use-is-client";

const EMOJI_RATINGS = [
  { rating: 1, emoji: "😞", label: "Skip", color: "from-slate-100 to-slate-200" },
  { rating: 2, emoji: "😕", label: "Meh",  color: "from-orange-50 to-amber-100" },
  { rating: 3, emoji: "😐", label: "Okay", color: "from-amber-50 to-yellow-100" },
  { rating: 4, emoji: "😊", label: "Like", color: "from-lime-50 to-green-100" },
  { rating: 5, emoji: "🤩", label: "Love", color: "from-green-50 to-emerald-100" },
];

const SPRING = { type: "spring" as const, stiffness: 520, damping: 38 };
const SPRING_SOFT = { type: "spring" as const, stiffness: 420, damping: 32 };
const SUGGESTION_MS = 10_000;

function StarRow({ value }: { value: number }) {
  const full = Math.min(5, Math.max(0, Math.round(value)));
  return (
    <div className="flex items-center gap-0.5 text-[#FF5500]" aria-label={`${value} stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`text-sm ${i < full ? "opacity-100" : "opacity-25"}`}>★</span>
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
  const exitX = typeof window !== "undefined" ? window.innerWidth * 0.62 : 420;
  const visual = getCuisineVisual(restaurant.cuisine);

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-12, 12], { clamp: true });
  const likeOpacity = useTransform(x, [0, 100], [0, 1]);
  const passOpacity = useTransform(x, [-100, 0], [1, 0]);

  const transitionIn  = useMemo(() => reduceMotion ? { duration: 0.15 } : { ...SPRING, mass: 0.8 }, [reduceMotion]);
  const transitionOut = useMemo(() => reduceMotion ? { duration: 0.12 } : { ...SPRING_SOFT, mass: 0.7 }, [reduceMotion]);

  const runExit = useCallback(async (toRight: boolean) => {
    await animate(x, toRight ? exitX : -exitX, transitionOut);
  }, [exitX, transitionOut, x]);

  const commit = useCallback(async (rating: number, toRight: boolean) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await runExit(toRight);
      onComplete(rating);
    } finally {
      busy.current = false;
    }
  }, [onComplete, runExit]);

  const onDragEnd = useCallback(async (_: unknown, info: PanInfo) => {
    if (busy.current) return;
    const threshold = 96;
    if (info.offset.x > threshold || info.velocity.x > 420) {
      await commit(4, true);
    } else if (info.offset.x < -threshold || info.velocity.x < -420) {
      await commit(2, false);
    } else {
      await animate(x, 0, SPRING);
    }
  }, [commit, x]);

  return (
    <div className="flex w-full max-w-[520px] flex-col items-center gap-5">
      {/* Card */}
      <div className="relative w-full px-3 pt-2">
        {/* Pass / Like ghost labels */}
        <motion.div
          style={{ opacity: passOpacity }}
          className="pointer-events-none absolute left-0 top-1/3 z-20 ml-6 rounded-xl border-2 border-red-400 bg-red-50 px-4 py-1.5 text-sm font-extrabold tracking-widest text-red-500 uppercase rotate-[-12deg]"
        >
          Pass
        </motion.div>
        <motion.div
          style={{ opacity: likeOpacity }}
          className="pointer-events-none absolute right-0 top-1/3 z-20 mr-6 rounded-xl border-2 border-green-500 bg-green-50 px-4 py-1.5 text-sm font-extrabold tracking-widest text-green-600 uppercase rotate-[12deg]"
        >
          Like
        </motion.div>

        <motion.div
          key={item.id}
          drag="x"
          dragConstraints={{ left: -280, right: 280 }}
          dragElastic={0.10}
          onDragEnd={onDragEnd}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40, scale: 0.92, filter: "blur(10px)" }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
          transition={transitionIn}
          style={{ x, rotate }}
          whileDrag={{ scale: 1.025, cursor: "grabbing" }}
          className="relative cursor-grab touch-pan-y overflow-hidden rounded-[2rem] bg-white shadow-[0_32px_72px_-12px_rgba(80,20,0,0.22),0_8px_24px_-4px_rgba(80,20,0,0.10)] will-change-transform active:cursor-grabbing"
        >
          {/* Food hero area */}
          <div className={`relative h-60 overflow-hidden bg-gradient-to-br ${visual.gradient}`}>
            {/* Ambient orbs */}
            <div className={`absolute -top-12 -right-12 h-56 w-56 rounded-full blur-3xl ${visual.orbA} animate-orb-a`} />
            <div className={`absolute bottom-0 left-0 h-44 w-44 rounded-full blur-2xl ${visual.orbB} animate-orb-b`} style={{ animationDelay: "0.8s" }} />
            <div className={`absolute top-10 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full blur-xl ${visual.orbC} animate-orb-c`} style={{ animationDelay: "1.6s" }} />

            {/* Emoji */}
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.12, type: "spring", stiffness: 400, damping: 24 }}
              className="absolute inset-0 flex items-center justify-center text-[100px] select-none"
              style={{ filter: "drop-shadow(0 12px 32px rgba(0,0,0,0.14))" }}
            >
              {visual.emoji}
            </motion.div>

            {/* Cuisine pill */}
            <div className="absolute bottom-4 left-4">
              <span className="rounded-full border border-white/50 bg-white/75 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gray-800 backdrop-blur-sm">
                {restaurant.cuisine}
              </span>
            </div>
          </div>

          {/* Card body */}
          <div className="px-6 py-5 text-gray-900">
            {/* Restaurant row */}
            <div className="flex items-center justify-between gap-3 mb-3">
              <p
                className="text-sm font-extrabold uppercase tracking-[0.14em] text-[#FF5500]"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                {restaurant.name}
              </p>
              <div className="flex items-center gap-1.5">
                <StarRow value={restaurant.stars} />
                <span className="text-sm font-bold text-gray-800">{restaurant.stars.toFixed(1)}</span>
                <span className="text-xs text-gray-400">({restaurant.reviewCount})</span>
              </div>
            </div>

            <h3
              className="text-2xl font-extrabold leading-snug tracking-tight text-gray-900"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {item.name}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600">
              {item.description}
            </p>
          </div>
        </motion.div>
      </div>

      {/* Emoji rating strip */}
      <div className="flex w-full flex-col items-center gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-oo-s">
          Rate to advance
        </p>

        <div className="flex w-full max-w-[420px] items-end justify-between gap-2">
          {EMOJI_RATINGS.map(({ rating, emoji, label, color }, i) => (
            <motion.button
              key={rating}
              type="button"
              aria-label={label}
              title={label}
              initial={{ opacity: 0, y: 18, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.08 + i * 0.04, ...SPRING }}
              whileHover={{
                y: -7,
                scale: 1.18,
                transition: { type: "spring", stiffness: 600, damping: 22 },
              }}
              whileTap={{ scale: 0.88 }}
              onClick={() => void commit(rating, rating >= 4)}
              className="flex flex-col items-center gap-1 group"
            >
              <div
                className={`flex h-[62px] w-[62px] items-center justify-center rounded-2xl bg-gradient-to-br ${color} shadow-md shadow-black/10 ring-1 ring-black/5 transition-all group-hover:shadow-xl`}
              >
                <span className="text-3xl select-none">{emoji}</span>
              </div>
              <span className="text-[10px] font-semibold tracking-wide text-oo-s uppercase">
                {label}
              </span>
            </motion.button>
          ))}
        </div>

        <p className="text-[11px] text-oo-xs">or drag the card left / right</p>
      </div>
    </div>
  );
}

type SuggestionToastProps = {
  restaurant: Restaurant;
  likeCount: number;
  onContinue: () => void;
  onDismiss: () => void;
};

function SuggestionToast({ restaurant, likeCount, onContinue, onDismiss }: SuggestionToastProps) {
  const reduceMotion = useReducedMotion();
  const visual = getCuisineVisual(restaurant.cuisine);

  return (
    <motion.div
      role="status"
      aria-live="polite"
      initial={reduceMotion ? { opacity: 0 } : { x: "115%", opacity: 0, rotate: 3 }}
      animate={{ x: 0, opacity: 1, rotate: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { x: "115%", opacity: 0, rotate: -2 }}
      transition={reduceMotion ? { duration: 0.2 } : { type: "spring", stiffness: 440, damping: 36 }}
      className="pointer-events-auto fixed right-4 top-20 z-[100] w-[min(100vw-2rem,20rem)] overflow-hidden rounded-2xl bg-white text-gray-900 shadow-2xl shadow-black/20 ring-1 ring-black/5 sm:top-24"
    >
      {/* Progress bar */}
      <div className="h-1 w-full bg-orange-100">
        <motion.div
          key={`pb-${restaurant.id}`}
          className="h-full bg-[#FF5500]"
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: SUGGESTION_MS / 1000, ease: "linear" }}
          style={{ transformOrigin: "left center" }}
        />
      </div>

      <div className={`px-4 pt-3 pb-1 bg-gradient-to-br ${visual.gradient}`}>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{visual.emoji}</span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-brand">
              Trending for you
            </p>
            <p
              className="text-base font-extrabold leading-tight text-gray-900"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {restaurant.name}
            </p>
          </div>
        </div>
        <p className="mt-1.5 mb-2.5 text-xs text-gray-600">
          You&apos;ve liked <strong className="text-brand font-bold">{likeCount} dishes</strong> from here — sounds like a match.
        </p>
      </div>

      <div className="flex flex-col gap-2 p-3">
        <button
          type="button"
          onClick={onContinue}
          className="w-full rounded-xl bg-brand py-2.5 text-xs font-bold text-white shadow-md shadow-brand/25 transition-all hover:bg-brand-dk active:scale-[0.98]"
        >
          Continue to restaurant →
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="w-full rounded-xl border border-stone-200 bg-stone-50 py-2 text-xs font-semibold text-gray-700 transition-colors hover:bg-stone-100"
        >
          No, keep swiping
        </button>
      </div>
    </motion.div>
  );
}

export default function SwipingPage() {
  const router = useRouter();
  const isClient = useIsClient();
  const [queue, setQueue] = useState<FoodItem[]>([]);
  const [index, setIndex] = useState(0);
  const [swipeState, setSwipeState] = useState<GrubrSwipeState>(getSwipeState);
  const [promptDraft, setPromptDraft] = useState("");
  /** Like count per restaurant when user last cleared a suggestion (repeat every +threshold likes). */
  const [suggestionDismissCheckpoints, setSuggestionDismissCheckpoints] = useState<
    Record<string, number>
  >(() =>
    typeof window !== "undefined" ? getSuggestionDismissLikeCheckpoints() : {},
  );
  const [placesStatus, setPlacesStatus] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  const [placesDiag, setPlacesDiag] = useState<{
    error?: string;
    hint?: string;
  } | null>(null);
  const [contextRefreshing, setContextRefreshing] = useState(false);
  const suggestionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profile = useMemo(() => (isClient ? getProfile() : null), [isClient]);

  useEffect(() => {
    if (!isClient) return;
    if (!getProfile()) {
      router.replace("/onboarding");
      return;
    }

    let cancelled = false;

    (async () => {
      setPlacesStatus("loading");
      const s = getSwipeState();
      const prof = getProfile();

      try {
        const res = await fetch("/api/restaurants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: prof,
            contextPrompt: s.contextPrompt,
          }),
        });
        const rawText = await res.text();
        let json: { data?: unknown; error?: string; hint?: string } = {};
        try {
          json = rawText ? (JSON.parse(rawText) as typeof json) : {};
        } catch {
          if (!cancelled) {
            setPlacesDiag({
              error: `/api/restaurants returned invalid JSON (HTTP ${res.status}).`,
              hint: rawText.slice(0, 160).replace(/\s+/g, " "),
            });
            json = { data: [] };
          }
        }
        if (cancelled) return;

        const rows = json.data;
        if (Array.isArray(rows) && rows.length > 0) {
          setDynamicRestaurants(
            mapPlacesApiToRestaurants(rows as PlacesApiRestaurantRow[]),
          );
          setPlacesStatus("ready");
          setPlacesDiag(null);
        } else {
          setDynamicRestaurants(null);
          setPlacesStatus("fallback");
          setPlacesDiag({
            error: typeof json.error === "string" ? json.error : undefined,
            hint: typeof json.hint === "string" ? json.hint : undefined,
          });
        }
      } catch {
        if (!cancelled) {
          setDynamicRestaurants(null);
          setPlacesStatus("fallback");
          setPlacesDiag({
            error: "Could not reach the restaurant API. Is the FastAPI server running and RESTAURANTS_API_URL set?",
          });
        }
      }

      if (cancelled) return;
      const latest = getSwipeState();
      const items = filterItemsByPrompt(latest.contextPrompt, getProfile());
      const unseen = items.filter((i) => !latest.seenItemIds.includes(i.id));
      queueMicrotask(() => {
        setSwipeState(latest);
        setPromptDraft(latest.contextPrompt);
        setQueue(unseen.length ? unseen : items);
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [router, isClient]);

  /** Keep React state aligned with session checkpoints (hydration / remount safety). */
  useEffect(() => {
    if (!isClient) return;
    setSuggestionDismissCheckpoints(getSuggestionDismissLikeCheckpoints());
  }, [isClient]);

  const persist = useCallback((next: GrubrSwipeState) => {
    setSwipeState(next);
    saveSwipeState(next);
  }, []);

  const applyPrompt = useCallback(async () => {
    const prev = getSwipeState();
    const next: GrubrSwipeState = { ...prev, contextPrompt: promptDraft.trim() };
    persist(next);
    setContextRefreshing(true);
    setPlacesStatus("loading");
    try {
      const res = await fetch("/api/restaurants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: getProfile(),
          contextPrompt: next.contextPrompt,
        }),
      });
      const rawText = await res.text();
      let json: { data?: unknown; error?: string; hint?: string } = {};
      try {
        json = rawText ? (JSON.parse(rawText) as typeof json) : {};
      } catch {
        setPlacesDiag({
          error: `/api/restaurants returned invalid JSON (HTTP ${res.status}).`,
          hint: rawText.slice(0, 160).replace(/\s+/g, " "),
        });
        json = { data: [] };
      }
      const rows = json.data;
      if (Array.isArray(rows) && rows.length > 0) {
        setDynamicRestaurants(
          mapPlacesApiToRestaurants(rows as PlacesApiRestaurantRow[]),
        );
        setPlacesStatus("ready");
        setPlacesDiag(null);
      } else {
        setDynamicRestaurants(null);
        setPlacesStatus("fallback");
        setPlacesDiag({
          error: typeof json.error === "string" ? json.error : undefined,
          hint: typeof json.hint === "string" ? json.hint : undefined,
        });
      }
    } catch {
      setDynamicRestaurants(null);
      setPlacesStatus("fallback");
      setPlacesDiag({
        error: "Could not reach the restaurant API. Is the FastAPI server running?",
      });
    } finally {
      setContextRefreshing(false);
    }
    const items = filterItemsByPrompt(next.contextPrompt, getProfile());
    const unseen = items.filter((i) => !next.seenItemIds.includes(i.id));
    setQueue(unseen.length ? unseen : items);
    setIndex(0);
  }, [persist, promptDraft]);

  const current = queue[index];
  const restaurant = current ? getRestaurantById(current.restaurantId) : undefined;

  const suggestions = useMemo(() =>
    Object.entries(swipeState.restaurantLikes)
      .filter(([, n]) => n >= LIKES_THRESHOLD_SUGGEST)
      .map(([id]) => getRestaurantById(id))
      .filter(Boolean) as NonNullable<ReturnType<typeof getRestaurantById>>[]
  , [swipeState.restaurantLikes]);

  const pendingSuggestion = useMemo(() => {
    for (const r of suggestions) {
      const likes = swipeState.restaurantLikes[r.id] ?? 0;
      const baseline = suggestionDismissCheckpoints[r.id] ?? 0;
      if (
        likes >= LIKES_THRESHOLD_SUGGEST &&
        likes - baseline >= LIKES_THRESHOLD_SUGGEST
      ) {
        return r;
      }
    }
    return null;
  }, [suggestions, swipeState.restaurantLikes, suggestionDismissCheckpoints]);

  const clearSuggestionTimer = useCallback(() => {
    if (suggestionTimerRef.current) {
      clearTimeout(suggestionTimerRef.current);
      suggestionTimerRef.current = null;
    }
  }, []);

  const recordSuggestionCleared = useCallback((restaurantId: string) => {
    const likeCount = getSwipeState().restaurantLikes[restaurantId] ?? 0;
    setSuggestionDismissLikeCheckpoint(restaurantId, likeCount);
    setSuggestionDismissCheckpoints((prev) => ({
      ...prev,
      [restaurantId]: likeCount,
    }));
  }, []);

  const dismissPendingSuggestion = useCallback(() => {
    if (!pendingSuggestion) return;
    clearSuggestionTimer();
    recordSuggestionCleared(pendingSuggestion.id);
  }, [pendingSuggestion, clearSuggestionTimer, recordSuggestionCleared]);

  /** Restarts auto-dismiss when the same restaurant qualifies again (e.g. 3 → 6 likes). */
  const pendingSuggestionToastKey = pendingSuggestion
    ? `${pendingSuggestion.id}:${swipeState.restaurantLikes[pendingSuggestion.id] ?? 0}`
    : null;

  useEffect(() => {
    clearSuggestionTimer();
    const id = pendingSuggestion?.id;
    if (!id) return;
    suggestionTimerRef.current = setTimeout(() => {
      const likeCount = getSwipeState().restaurantLikes[id] ?? 0;
      setSuggestionDismissLikeCheckpoint(id, likeCount);
      setSuggestionDismissCheckpoints((prev) => ({ ...prev, [id]: likeCount }));
      suggestionTimerRef.current = null;
    }, SUGGESTION_MS);
    return clearSuggestionTimer;
  }, [pendingSuggestionToastKey, clearSuggestionTimer]);

  const handleSwipeComplete = useCallback((rating: number) => {
    if (!current) return;
    const prev = getSwipeState();
    const seenItemIds = [...new Set([...prev.seenItemIds, current.id])];
    const restaurantLikes = { ...prev.restaurantLikes };
    if (rating >= 4) {
      restaurantLikes[current.restaurantId] = (restaurantLikes[current.restaurantId] ?? 0) + 1;
    }
    const next: GrubrSwipeState = { ...prev, seenItemIds, restaurantLikes };
    persist(next);

    const nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      const items = filterItemsByPrompt(next.contextPrompt, getProfile());
      const unseen = items.filter((i) => !seenItemIds.includes(i.id));
      setQueue(unseen.length ? unseen : items);
      setIndex(0);
    } else {
      setIndex(nextIndex);
    }
  }, [current, index, persist, queue.length]);

  function handleReset() {
    if (typeof window !== "undefined" && !window.confirm("Reset all preferences and swipe history?")) return;
    resetAllGrubrData();
    router.push("/onboarding");
  }

  if (!isClient || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <motion.div
          className="h-10 w-10 rounded-full border-[3px] border-white/25 border-t-white"
          animate={{ rotate: 360 }}
          transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
        />
      </div>
    );
  }

  const toastLayer =
    typeof document !== "undefined"
      ? createPortal(
          <AnimatePresence mode="wait">
            {pendingSuggestion && (
              <SuggestionToast
                key={pendingSuggestionToastKey ?? pendingSuggestion.id}
                restaurant={pendingSuggestion}
                likeCount={swipeState.restaurantLikes[pendingSuggestion.id] ?? 0}
                onContinue={() => {
                  clearSuggestionTimer();
                  recordSuggestionCleared(pendingSuggestion.id);
                  clearCart();
                  setTargetRestaurantId(pendingSuggestion.id);
                  router.push(`/restaurant-confirm?restaurantId=${pendingSuggestion.id}`);
                }}
                onDismiss={dismissPendingSuggestion}
              />
            )}
          </AnimatePresence>,
          document.body,
        )
      : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {toastLayer}

      <GrubrHeader />

      {/* Three-column layout — fills remaining viewport exactly */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT — For You (desktop only) */}
        <motion.aside
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.06, ...SPRING }}
          className="hidden lg:flex w-80 shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/10 px-6 py-7"
        >
          {/* Header */}
          <div>
            <p
              className="text-xl font-extrabold text-white"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              For You
            </p>
            <p className="mt-1 text-sm text-white/65">
              Restaurants Grubr thinks you&apos;ll love
            </p>
          </div>

          {/* Status card */}
          {suggestions.length === 0 ? (
            <div className="flex flex-col gap-4 rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur-md">
              <span className="text-4xl">🎯</span>
              <div>
                <p className="text-base font-bold text-white">Discovering your taste…</p>
                <p className="mt-2 text-sm leading-relaxed text-white/75">
                  Like {LIKES_THRESHOLD_SUGGEST}+ dishes from the same spot and we&apos;ll suggest that restaurant here with a notification.
                </p>
              </div>
            </div>
          ) : pendingSuggestion ? (
            <div className="rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur-md">
              <p className="text-base font-bold text-white">👀 Heads up</p>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                A restaurant suggestion just slid in from the right — auto-hides in ~10 s.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur-md">
              <p className="text-base font-bold text-white">👍 Snoozed</p>
              <p className="mt-2 text-sm leading-relaxed text-white/75">
                Keep swiping. Like {LIKES_THRESHOLD_SUGGEST} more dishes from the same place and we&apos;ll nudge you again.
              </p>
            </div>
          )}

          {/* Interest meter */}
          {Object.keys(swipeState.restaurantLikes).length > 0 && (
            <div className="rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur-md">
              <p className="mb-4 text-xs font-bold uppercase tracking-widest text-white/50">
                Interest meter
              </p>
              <div className="space-y-5">
                {Object.entries(swipeState.restaurantLikes).map(([id, count]) => {
                  const r = getRestaurantById(id);
                  if (!r) return null;
                  const pct = Math.min(100, (count / LIKES_THRESHOLD_SUGGEST) * 100);
                  const reached = count >= LIKES_THRESHOLD_SUGGEST;
                  return (
                    <div key={id}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-white truncate">{r.name}</span>
                        <span className={`text-sm font-bold ml-2 shrink-0 ${reached ? "text-white" : "text-white/60"}`}>
                          {count} / {LIKES_THRESHOLD_SUGGEST}
                        </span>
                      </div>
                      <div className="h-2.5 w-full rounded-full bg-white/15 overflow-hidden">
                        <motion.div
                          className={`h-full rounded-full ${reached ? "bg-white" : "bg-white/55"}`}
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mt-auto">
            <button
              type="button"
              onClick={handleReset}
              className="w-full rounded-xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold text-white/80 backdrop-blur-md transition-colors hover:bg-white/16"
            >
              Reset data & memory
            </button>
          </div>
        </motion.aside>

        {/* CENTER — Deck */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.02, ...SPRING }}
          className="relative flex flex-1 min-h-0 flex-col items-center justify-center overflow-y-auto px-4 py-4"
        >
          {placesStatus === "loading" && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#C82C00]/35 backdrop-blur-[2px]">
              <div className="h-10 w-10 rounded-full border-[3px] border-white/25 border-t-white animate-spin-ring" />
              <p className="text-sm font-semibold text-white" style={{ fontFamily: "var(--font-syne)" }}>
                Grubr Agent is finding restaurants…
              </p>
            </div>
          )}
          {placesStatus === "fallback" && (
            <div className="absolute top-2 left-1/2 z-10 max-w-lg -translate-x-1/2 rounded-2xl border border-white/20 bg-black/35 px-4 py-2.5 text-left text-[11px] text-white/90 backdrop-blur-md">
              <p className="font-semibold text-white">Using sample restaurants</p>
              {placesDiag?.error && (
                <p className="mt-1 text-white/80">{placesDiag.error}</p>
              )}
              {placesDiag?.hint && (
                <p className="mt-1 text-white/70">{placesDiag.hint}</p>
              )}
              {!placesDiag?.error && (
                <p className="mt-1 text-white/75">
                  Start the FastAPI app, set{" "}
                  <code className="rounded bg-white/10 px-1">RESTAURANTS_API_URL</code> in{" "}
                  <code className="rounded bg-white/10 px-1">.env.local</code>, and use a{" "}
                  <strong className="font-semibold text-white">Maps Places–enabled</strong> key as{" "}
                  <code className="rounded bg-white/10 px-1">GOOGLE_MAPS_API_KEY</code> in the repo{" "}
                  <code className="rounded bg-white/10 px-1">.env</code> (Gemini-only keys do not work for Places).
                </p>
              )}
            </div>
          )}
          {!current || !restaurant ? (
            <motion.div
              className="flex flex-col items-center gap-3 text-center"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={SPRING}
            >
              <span className="text-5xl">🎉</span>
              <p
                className="text-2xl font-extrabold text-white"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                You&apos;re caught up
              </p>
              <p className="max-w-xs text-sm text-oo-m">
                Adjust Food Mood or clear seen dishes to keep swiping.
              </p>
              <button
                type="button"
                onClick={() => {
                  const prev = getSwipeState();
                  persist({ ...prev, seenItemIds: [] });
                  setQueue(filterItemsByPrompt(prev.contextPrompt, getProfile()));
                  setIndex(0);
                }}
                className="rounded-full bg-white px-7 py-2.5 text-sm font-bold text-brand shadow-xl transition-all hover:bg-s2 active:scale-[0.97]"
              >
                Show dishes again
              </button>
            </motion.div>
          ) : (
            <SwipeDeck
              key={current.id}
              item={current}
              restaurant={restaurant}
              onComplete={handleSwipeComplete}
            />
          )}
        </motion.section>

        {/* RIGHT — Food Mood (desktop only) */}
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08, ...SPRING }}
          className="hidden lg:flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 px-5 py-6"
        >
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.20em] text-oo-s mb-1">
              Food Mood
            </p>
            <p className="text-xs text-oo-xs">
              Describe what you&apos;re craving — Grubr adjusts what you see in real time.
            </p>
          </div>

          <div className="flex flex-col overflow-hidden rounded-2xl border border-oo-xs bg-gl backdrop-blur-xl">
            <textarea
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void applyPrompt();
                }
              }}
              placeholder={"\"I'm feeling Mediterranean tonight\"\n\"No Mexican food today\"\n\"Something spicy and cheap\"\n\"Craving something warm\""}
              rows={7}
              className="w-full resize-none bg-transparent px-4 py-4 text-sm text-white placeholder:text-oo-xs outline-none leading-relaxed"
            />
            <div className="border-t border-oo-xs px-3 py-3">
              <button
                type="button"
                disabled={contextRefreshing}
                onClick={() => void applyPrompt()}
                className="w-full rounded-xl bg-white py-2.5 text-sm font-bold text-brand shadow-md transition-all hover:bg-s2 active:scale-[0.98] disabled:opacity-60"
              >
                {contextRefreshing ? "Updating…" : "Update context ↵"}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-oo-xs bg-gl p-4 text-center backdrop-blur-md">
              <p className="text-2xl font-extrabold text-white" style={{ fontFamily: "var(--font-syne)" }}>
                {swipeState.seenItemIds.length}
              </p>
              <p className="text-[11px] text-oo-s mt-0.5">Dishes seen</p>
            </div>
            <div className="rounded-2xl border border-oo-xs bg-gl p-4 text-center backdrop-blur-md">
              <p className="text-2xl font-extrabold text-white" style={{ fontFamily: "var(--font-syne)" }}>
                {Object.values(swipeState.restaurantLikes).reduce((a, b) => a + b, 0)}
              </p>
              <p className="text-[11px] text-oo-s mt-0.5">Dishes liked</p>
            </div>
          </div>

          {/* Prompt examples */}
          <div className="rounded-2xl border border-oo-xs bg-gl p-4 backdrop-blur-md">
            <p className="text-[11px] font-bold uppercase tracking-wider text-oo-s mb-3">
              Try saying…
            </p>
            <div className="space-y-2">
              {[
                "I'm feeling Mediterranean",
                "No Mexican tonight",
                "Something spicy",
                "Vegetarian options",
              ].map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => { setPromptDraft(ex); }}
                  className="block w-full rounded-xl border border-oo-xs bg-white/5 px-3 py-2 text-left text-xs text-oo-m transition-colors hover:bg-white/10"
                >
                  &ldquo;{ex}&rdquo;
                </button>
              ))}
            </div>
          </div>
        </motion.aside>
      </div>
    </div>
  );
}
