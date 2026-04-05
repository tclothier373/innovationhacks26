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
  getDiscoveryCache,
  saveDiscoveryCache,
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
  mergeProposedMenusIntoRestaurants,
  type PlacesApiRestaurantRow,
  type ProposedMenuItem,
} from "@/lib/places-bridge";
import { getCuisineVisual } from "@/lib/cuisine-utils";
import { useIsClient } from "@/lib/use-is-client";

const DISCOVERY_BLURBS = [
  { emoji: "🍽️", text: "Fetching your dream restaurant…" },
  { emoji: "🧠", text: "Consulting the food oracle…" },
  { emoji: "🔍", text: "Sniffing out the good stuff…" },
  { emoji: "⚙️", text: "Crunching the heavy numbers…" },
  { emoji: "📖", text: "Reading menus so you don't have to…" },
  { emoji: "🤖", text: "Asking Gemini for its hot takes…" },
  { emoji: "🗺️", text: "Scouting your neighborhood…" },
  { emoji: "🌶️", text: "Taste-testing the algorithm…" },
  { emoji: "💅", text: "Curating only the finest options…" },
  { emoji: "🧑‍🍳", text: "Negotiating with local chefs…" },
];

function DiscoveryLoader() {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const cycle = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % DISCOVERY_BLURBS.length);
        setVisible(true);
      }, 350);
    }, 2600);
    return () => clearInterval(cycle);
  }, []);

  const blurb = DISCOVERY_BLURBS[idx];

  return (
    <motion.div
      key="discovery-loader"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-8"
      style={{ background: "linear-gradient(135deg, #C82C00 0%, #FF5500 50%, #ff7a33 100%)" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Orb accents */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-white/10 blur-3xl animate-orb-a" />
        <div className="absolute -bottom-16 -right-16 h-56 w-56 rounded-full bg-black/15 blur-3xl animate-orb-b" />
      </div>

      {/* Logo */}
      <p className="relative text-2xl font-extrabold tracking-tight text-white/90" style={{ fontFamily: "var(--font-syne)" }}>
        grubr
      </p>

      {/* Spinning ring */}
      <motion.div
        className="relative h-20 w-20 rounded-full border-[3px] border-white/20 border-t-white"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
      />

      {/* Cycling blurb */}
      <div className="relative flex flex-col items-center gap-2 text-center">
        <motion.span
          key={`emoji-${idx}`}
          className="text-4xl"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: visible ? 1 : 0, scale: visible ? 1 : 0.6 }}
          transition={{ duration: 0.3 }}
        >
          {blurb.emoji}
        </motion.span>
        <motion.p
          key={`text-${idx}`}
          className="text-base font-semibold text-white"
          style={{ fontFamily: "var(--font-syne)" }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: visible ? 1 : 0, y: visible ? 0 : -6 }}
          transition={{ duration: 0.3 }}
        >
          {blurb.text}
        </motion.p>
        <p className="text-xs text-white/60">This may take up to 30 seconds</p>
      </div>
    </motion.div>
  );
}

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
    <div className="relative flex w-full max-w-[540px] flex-col items-center gap-6">
      {/* Soft spotlight behind the card */}
      <div
        className="pointer-events-none absolute left-1/2 top-6 -z-10 h-[min(420px,70vh)] w-[min(100%,500px)] -translate-x-1/2 rounded-[3.5rem] bg-gradient-to-b from-white/[0.14] via-white/[0.05] to-transparent blur-2xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-8 left-1/2 -z-10 h-32 w-[90%] max-w-md -translate-x-1/2 rounded-full bg-black/20 blur-3xl"
        aria-hidden
      />

      {/* Card */}
      <div className="relative w-full px-2 pt-1 sm:px-3 sm:pt-2">
        {/* Pass / Like ghost labels */}
        <motion.div
          style={{ opacity: passOpacity }}
          className="pointer-events-none absolute left-0 top-1/3 z-20 ml-4 rounded-2xl border border-red-400/60 bg-red-50/95 px-4 py-2 text-xs font-extrabold tracking-[0.2em] text-red-600 uppercase shadow-lg shadow-red-900/10 backdrop-blur-sm rotate-[-12deg] sm:ml-6 sm:text-sm"
        >
          Pass
        </motion.div>
        <motion.div
          style={{ opacity: likeOpacity }}
          className="pointer-events-none absolute right-0 top-1/3 z-20 mr-4 rounded-2xl border border-emerald-500/60 bg-emerald-50/95 px-4 py-2 text-xs font-extrabold tracking-[0.2em] text-emerald-700 uppercase shadow-lg shadow-emerald-900/10 backdrop-blur-sm rotate-[12deg] sm:mr-6 sm:text-sm"
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
          className="relative cursor-grab touch-pan-y overflow-hidden rounded-[2rem] bg-white shadow-[0_40px_90px_-20px_rgba(80,20,0,0.28),0_16px_40px_-12px_rgba(255,85,0,0.12),0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-white/40 will-change-transform active:cursor-grabbing"
        >
          {/* Food hero area */}
          <div className={`relative h-60 overflow-hidden ${item.imageUrl ? "bg-black" : `bg-gradient-to-br ${visual.gradient}`}`}>
            {item.imageUrl && (
              <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-t from-black/25 via-transparent to-black/10" aria-hidden />
            )}
            {item.imageUrl ? (
              /* Real food photo from Places API / restaurant website */
              <img
                src={item.imageUrl}
                alt={item.name}
                className="absolute inset-0 h-full w-full object-cover opacity-92"
                draggable={false}
              />
            ) : (
              /* Fallback: animated gradient + cuisine emoji */
              <>
                <div className={`absolute -top-12 -right-12 h-56 w-56 rounded-full blur-3xl ${visual.orbA} animate-orb-a`} />
                <div className={`absolute bottom-0 left-0 h-44 w-44 rounded-full blur-2xl ${visual.orbB} animate-orb-b`} style={{ animationDelay: "0.8s" }} />
                <div className={`absolute top-10 left-1/2 h-32 w-32 -translate-x-1/2 rounded-full blur-xl ${visual.orbC} animate-orb-c`} style={{ animationDelay: "1.6s" }} />
                <motion.div
                  initial={{ scale: 0.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.12, type: "spring", stiffness: 400, damping: 24 }}
                  className="absolute inset-0 flex items-center justify-center text-[100px] select-none"
                  style={{ filter: "drop-shadow(0 12px 32px rgba(0,0,0,0.14))" }}
                >
                  {visual.emoji}
                </motion.div>
              </>
            )}

            {/* Cuisine pill — always visible */}
            <div className="absolute bottom-4 left-4 z-[2]">
              <span className="rounded-full border border-white/55 bg-white/88 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-i0 shadow-md shadow-black/10 backdrop-blur-md">
                {restaurant.cuisine}
              </span>
            </div>
          </div>

          {/* Card body */}
          <div className="border-t border-b1/40 bg-gradient-to-b from-white to-s1/30 px-6 py-5 text-gray-900">
            {/* Restaurant row */}
            <div className="mb-3 flex items-center justify-between gap-3">
              <p
                className="text-sm font-extrabold uppercase tracking-[0.14em] text-brand"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                {restaurant.name}
              </p>
              <div className="flex items-center gap-1.5">
                <StarRow value={restaurant.stars} />
                <span className="text-sm font-bold text-i0">{restaurant.stars.toFixed(1)}</span>
                <span className="text-xs text-i3">({restaurant.reviewCount})</span>
              </div>
            </div>

            <h3
              className="text-2xl font-extrabold leading-snug tracking-tight text-i0"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              {item.name}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-i2">
              {item.description}
            </p>
          </div>
        </motion.div>
      </div>

      {/* Emoji rating strip */}
      <div className="w-full max-w-[460px] rounded-[1.75rem] border border-white/18 bg-white/[0.08] p-5 shadow-[0_20px_56px_-18px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md">
        <div className="flex flex-col items-center gap-4">
          <div className="flex w-full flex-col items-center gap-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-white/55">
              Rate to advance
            </p>
            <span className="h-px w-12 bg-gradient-to-r from-transparent via-white/35 to-transparent" aria-hidden />
          </div>

          <div className="flex w-full max-w-[420px] items-end justify-between gap-1.5 sm:gap-2">
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
                className="group flex flex-col items-center gap-1.5"
              >
                <div
                  className={`flex h-[58px] w-[58px] items-center justify-center rounded-2xl bg-gradient-to-br ${color} shadow-lg shadow-black/20 ring-1 ring-white/25 transition-all group-hover:shadow-xl group-hover:ring-white/40 sm:h-[62px] sm:w-[62px]`}
                >
                  <span className="select-none text-[1.65rem] sm:text-3xl">{emoji}</span>
                </div>
                <span className="text-[9px] font-semibold uppercase tracking-wide text-white/50 sm:text-[10px]">
                  {label}
                </span>
              </motion.button>
            ))}
          </div>

          <p className="text-[10px] text-white/40">or drag the card left / right</p>
        </div>
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

      // Check localStorage cache first
      const cached = getDiscoveryCache(prof, s.contextPrompt);
      if (cached && !cancelled) {
        const built = mergeProposedMenusIntoRestaurants(
          cached.rows as PlacesApiRestaurantRow[],
          cached.menus as ProposedMenuItem[][],
        );
        setDynamicRestaurants(built);
        setPlacesStatus("ready");
        setPlacesDiag(null);
      } else {
        try {
          const res = await fetch("/api/discover", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              profile: prof,
              contextPrompt: s.contextPrompt,
            }),
          });
          const rawText = await res.text();
          let json: { data?: unknown; menus?: unknown; error?: string; hint?: string } = {};
          try {
            json = rawText ? (JSON.parse(rawText) as typeof json) : {};
          } catch {
            if (!cancelled) {
              setPlacesDiag({
                error: `/api/discover returned invalid JSON (HTTP ${res.status}).`,
                hint: rawText.slice(0, 160).replace(/\s+/g, " "),
              });
              json = { data: [] };
            }
          }
          if (cancelled) return;

          const rows = json.data;
          const menus = json.menus;
          if (Array.isArray(rows) && rows.length > 0) {
            saveDiscoveryCache(prof, s.contextPrompt, rows, Array.isArray(menus) ? menus as unknown[][] : []);
            const built = mergeProposedMenusIntoRestaurants(
              rows as PlacesApiRestaurantRow[],
              Array.isArray(menus) ? (menus as ProposedMenuItem[][]) : [],
            );
            if (!cancelled) {
              setDynamicRestaurants(built);
              setPlacesStatus("ready");
              setPlacesDiag(null);
            }
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
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: getProfile(),
          contextPrompt: next.contextPrompt,
        }),
      });
      const rawText = await res.text();
      let json: { data?: unknown; menus?: unknown; error?: string; hint?: string } = {};
      try {
        json = rawText ? (JSON.parse(rawText) as typeof json) : {};
      } catch {
        setPlacesDiag({
          error: `/api/discover returned invalid JSON (HTTP ${res.status}).`,
          hint: rawText.slice(0, 160).replace(/\s+/g, " "),
        });
        json = { data: [] };
      }
      const rows = json.data;
      const menus = json.menus;
      if (Array.isArray(rows) && rows.length > 0) {
        saveDiscoveryCache(getProfile(), next.contextPrompt, rows, Array.isArray(menus) ? menus as unknown[][] : []);
        const built = mergeProposedMenusIntoRestaurants(
          rows as PlacesApiRestaurantRow[],
          Array.isArray(menus) ? (menus as ProposedMenuItem[][]) : [],
        );
        setDynamicRestaurants(built);
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
      <AnimatePresence>
        {(placesStatus === "loading" || contextRefreshing) && <DiscoveryLoader />}
      </AnimatePresence>
      {toastLayer}

      <GrubrHeader />

      {/* Three-column layout — fills remaining viewport exactly */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT — For You (desktop only) */}
        <motion.aside
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.06, ...SPRING }}
          className="hidden min-h-0 w-[min(20.5rem,100%)] shrink-0 flex-col py-4 pl-4 pr-1 sm:pl-5 sm:pr-2 lg:flex"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto rounded-[2rem] border border-white/40 bg-gradient-to-b from-white/95 via-s1 to-s2/65 px-6 py-7 shadow-[0_24px_56px_-16px_rgba(0,0,0,0.28),0_8px_24px_-8px_rgba(255,85,0,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-white/60 backdrop-blur-lg">
          {/* Header */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br from-brand-lt to-brand-dk shadow-[0_0_0_3px_rgba(255,85,0,0.12)]"
                aria-hidden
              />
              <p
                className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand"
              >
                Personalized
              </p>
            </div>
            <div>
              <p
                className="bg-gradient-to-r from-i0 to-i1 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                For You
              </p>
              <p className="mt-1.5 max-w-[16rem] text-sm leading-relaxed text-i2">
                Restaurants Grubr thinks you&apos;ll love
              </p>
            </div>
          </div>

          {/* Status card */}
          {suggestions.length === 0 ? (
            <div className="flex flex-col gap-4 rounded-3xl border border-b1/70 bg-white/85 p-5 shadow-[0_4px_24px_-6px_rgba(255,85,0,0.09),0_1px_0_rgba(255,255,255,0.8)_inset] ring-1 ring-white/60 backdrop-blur-sm">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-s3 to-s2 text-3xl shadow-inner shadow-b1/30">
                🎯
              </span>
              <div>
                <p className="text-base font-bold text-i0">Discovering your taste…</p>
                <p className="mt-2 text-sm leading-relaxed text-i2">
                  Like {LIKES_THRESHOLD_SUGGEST}+ dishes from the same spot and we&apos;ll suggest that restaurant here with a notification.
                </p>
              </div>
            </div>
          ) : pendingSuggestion ? (
            <div className="rounded-3xl border border-b1/70 bg-white/85 p-5 shadow-[0_4px_24px_-6px_rgba(255,85,0,0.09)] ring-1 ring-white/60 backdrop-blur-sm">
              <p className="text-base font-bold text-i0">👀 Heads up</p>
              <p className="mt-2 text-sm leading-relaxed text-i2">
                A restaurant suggestion just slid in from the right — auto-hides in ~10 s.
              </p>
            </div>
          ) : (
            <div className="rounded-3xl border border-b1/70 bg-white/85 p-5 shadow-[0_4px_24px_-6px_rgba(255,85,0,0.09)] ring-1 ring-white/60 backdrop-blur-sm">
              <p className="text-base font-bold text-i0">👍 Snoozed</p>
              <p className="mt-2 text-sm leading-relaxed text-i2">
                Keep swiping. Like {LIKES_THRESHOLD_SUGGEST} more dishes from the same place and we&apos;ll nudge you again.
              </p>
            </div>
          )}

          {/* Interest meter */}
          {Object.keys(swipeState.restaurantLikes).length > 0 && (
            <div className="rounded-3xl border border-b1/70 bg-white/85 p-5 shadow-[0_4px_24px_-6px_rgba(255,85,0,0.07)] ring-1 ring-white/60 backdrop-blur-sm">
              <div className="mb-4 flex items-center gap-2">
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-b2/60 to-transparent" aria-hidden />
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-i3">
                  Interest meter
                </p>
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-b2/60 to-transparent" aria-hidden />
              </div>
              <div className="space-y-5">
                {Object.entries(swipeState.restaurantLikes).map(([id, count]) => {
                  const r = getRestaurantById(id);
                  if (!r) return null;
                  const pct = Math.min(100, (count / LIKES_THRESHOLD_SUGGEST) * 100);
                  const reached = count >= LIKES_THRESHOLD_SUGGEST;
                  return (
                    <div key={id}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-i0">{r.name}</span>
                        <span className={`ml-2 shrink-0 tabular-nums text-xs font-bold ${reached ? "text-brand" : "text-i3"}`}>
                          {count}/{LIKES_THRESHOLD_SUGGEST}
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-s3/90 shadow-[inset_0_1px_2px_rgba(26,9,0,0.06)] ring-1 ring-b1/40">
                        <motion.div
                          className={`h-full rounded-full shadow-sm ${reached ? "bg-gradient-to-r from-brand-lt to-brand" : "bg-gradient-to-r from-brand-lt/70 to-brand/55"}`}
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

          <div className="mt-auto pt-2">
            <button
              type="button"
              onClick={handleReset}
              className="w-full rounded-2xl border border-b2/35 bg-white/70 px-4 py-3.5 text-sm font-semibold text-i2 shadow-sm transition-all hover:border-brand/25 hover:bg-brand/[0.04] hover:text-i1 hover:shadow-md active:scale-[0.99]"
            >
              Reset data & memory
            </button>
          </div>
          </div>
        </motion.aside>

        {/* CENTER — Deck */}
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.02, ...SPRING }}
          className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-6 sm:px-8"
        >
          <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden>
            <div className="absolute -top-32 left-1/2 h-[min(480px,55vh)] w-[min(100%,640px)] -translate-x-1/2 rounded-full bg-white/[0.07] blur-3xl" />
            <div className="absolute bottom-0 left-1/2 h-40 w-[min(90%,520px)] -translate-x-1/2 rounded-full bg-[#5C0F00]/25 blur-3xl" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>

          <div className="relative z-[1] flex min-h-full w-full flex-1 flex-col items-center justify-center">
          {placesStatus === "loading" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#9B2000]/25 p-4 backdrop-blur-[3px]">
              <div className="flex max-w-sm flex-col items-center gap-5 rounded-3xl border border-white/25 bg-white/[0.12] px-10 py-9 text-center shadow-[0_24px_64px_-16px_rgba(0,0,0,0.45)] backdrop-blur-lg">
                <div className="relative">
                  <div className="absolute inset-0 rounded-full bg-white/20 blur-xl" aria-hidden />
                  <div className="relative h-11 w-11 rounded-full border-[3px] border-white/20 border-t-white animate-spin-ring" />
                </div>
                <p className="text-sm font-semibold leading-relaxed text-white/95" style={{ fontFamily: "var(--font-syne)" }}>
                  Grubr Agent is finding restaurants & popular dishes…
                </p>
                <p className="text-[11px] text-white/45">This usually takes a few seconds</p>
              </div>
            </div>
          )}
          {placesStatus === "fallback" && (
            <div className="absolute top-3 left-1/2 z-10 max-w-lg -translate-x-1/2 px-2 sm:top-5">
              <div className="rounded-3xl border border-white/22 bg-black/40 px-4 py-3 text-left text-[11px] text-white/90 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.5)] backdrop-blur-md ring-1 ring-white/10 sm:px-5 sm:py-3.5">
                <p className="font-semibold text-white">Using sample restaurants</p>
                {placesDiag?.error && (
                  <p className="mt-1.5 text-white/80">{placesDiag.error}</p>
                )}
                {placesDiag?.hint && (
                  <p className="mt-1.5 text-white/70">{placesDiag.hint}</p>
                )}
                {!placesDiag?.error && (
                  <p className="mt-1.5 text-white/75">
                    Start the FastAPI app, set{" "}
                    <code className="rounded-md bg-white/12 px-1.5 py-0.5">RESTAURANTS_API_URL</code> in{" "}
                    <code className="rounded-md bg-white/12 px-1.5 py-0.5">.env.local</code>, and use a{" "}
                    <strong className="font-semibold text-white">Maps Places–enabled</strong> key as{" "}
                    <code className="rounded-md bg-white/12 px-1.5 py-0.5">GOOGLE_MAPS_API_KEY</code> in the repo{" "}
                    <code className="rounded-md bg-white/12 px-1.5 py-0.5">.env</code> (Gemini-only keys do not work for Places).
                  </p>
                )}
              </div>
            </div>
          )}
          {!current || !restaurant ? (
            <motion.div
              className="flex max-w-sm flex-col items-center gap-5 rounded-3xl border border-white/20 bg-white/[0.09] px-8 py-10 text-center shadow-[0_28px_72px_-20px_rgba(0,0,0,0.4)] backdrop-blur-lg ring-1 ring-white/10"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={SPRING}
            >
              <span className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl bg-white/15 text-4xl shadow-inner shadow-black/10">
                🎉
              </span>
              <div className="space-y-2">
                <p
                  className="bg-gradient-to-b from-white to-white/75 bg-clip-text text-2xl font-extrabold text-transparent"
                  style={{ fontFamily: "var(--font-syne)" }}
                >
                  You&apos;re caught up
                </p>
                <p className="max-w-xs text-sm leading-relaxed text-white/75">
                  Adjust Food Mood or clear seen dishes to keep swiping.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const prev = getSwipeState();
                  persist({ ...prev, seenItemIds: [] });
                  setQueue(filterItemsByPrompt(prev.contextPrompt, getProfile()));
                  setIndex(0);
                }}
                className="rounded-full bg-gradient-to-b from-white to-s1 px-8 py-3 text-sm font-bold text-brand shadow-[0_8px_28px_-6px_rgba(0,0,0,0.35)] ring-1 ring-white/50 transition-all hover:shadow-[0_12px_36px_-8px_rgba(255,85,0,0.35)] hover:ring-white active:scale-[0.97]"
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
          </div>
        </motion.section>

        {/* RIGHT — Food Mood (desktop only) */}
        <motion.aside
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.08, ...SPRING }}
          className="hidden min-h-0 w-[min(20.5rem,100%)] shrink-0 flex-col py-4 pr-4 pl-1 sm:pr-5 sm:pl-2 lg:flex"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto rounded-[2rem] border border-white/40 bg-gradient-to-b from-white/95 via-s1 to-s2/65 px-6 py-7 shadow-[0_24px_56px_-16px_rgba(0,0,0,0.28),0_8px_24px_-8px_rgba(255,85,0,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-white/60 backdrop-blur-lg">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br from-brand-lt to-brand-dk shadow-[0_0_0_3px_rgba(255,85,0,0.12)]"
                aria-hidden
              />
              <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand">
                Live context
              </p>
            </div>
            <div>
              <p
                className="text-xl font-extrabold tracking-tight text-i0"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                Food Mood
              </p>
              <p className="mt-1.5 max-w-[16rem] text-xs leading-relaxed text-i2">
                Describe what you&apos;re craving — Grubr adjusts what you see in real time.
              </p>
            </div>
          </div>

          <div className="flex flex-col overflow-hidden rounded-3xl border border-b1/70 bg-white/90 shadow-[0_8px_32px_-10px_rgba(255,85,0,0.12),0_1px_0_rgba(255,255,255,0.9)_inset] ring-1 ring-white/70 transition-shadow focus-within:shadow-[0_12px_40px_-10px_rgba(255,85,0,0.16),0_0_0_3px_rgba(255,85,0,0.08)] focus-within:ring-brand/20">
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
              className="w-full resize-none bg-transparent px-4 py-4 text-sm leading-relaxed text-i0 outline-none placeholder:text-i3/90"
            />
            <div className="border-t border-b1/60 bg-gradient-to-b from-s1/90 to-s2/40 px-3 py-3">
              <button
                type="button"
                disabled={contextRefreshing}
                onClick={() => void applyPrompt()}
                className="w-full rounded-xl bg-gradient-to-b from-white to-s1 py-2.5 text-sm font-bold text-brand shadow-[0_2px_8px_-2px_rgba(255,85,0,0.25)] ring-1 ring-b1/80 transition-all hover:shadow-[0_4px_16px_-4px_rgba(255,85,0,0.35)] hover:ring-brand/25 active:scale-[0.98] disabled:opacity-60"
              >
                {contextRefreshing ? "Updating…" : "Update context ↵"}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative overflow-hidden rounded-3xl border border-b1/70 bg-white/80 p-4 text-center shadow-sm ring-1 ring-white/50">
              <div className="pointer-events-none absolute inset-x-3 top-0 h-0.5 rounded-full bg-gradient-to-r from-transparent via-brand/45 to-transparent" aria-hidden />
              <p className="text-2xl font-extrabold tabular-nums text-brand" style={{ fontFamily: "var(--font-syne)" }}>
                {swipeState.seenItemIds.length}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-i3">Dishes seen</p>
            </div>
            <div className="relative overflow-hidden rounded-3xl border border-b1/70 bg-white/80 p-4 text-center shadow-sm ring-1 ring-white/50">
              <div className="pointer-events-none absolute inset-x-3 top-0 h-0.5 rounded-full bg-gradient-to-r from-transparent via-brand/45 to-transparent" aria-hidden />
              <p className="text-2xl font-extrabold tabular-nums text-brand" style={{ fontFamily: "var(--font-syne)" }}>
                {Object.values(swipeState.restaurantLikes).reduce((a, b) => a + b, 0)}
              </p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-i3">Dishes liked</p>
            </div>
          </div>

          {/* Prompt examples */}
          <div className="rounded-3xl border border-b1/70 bg-white/75 p-4 shadow-sm ring-1 ring-white/50 backdrop-blur-sm">
            <p className="mb-3.5 text-[10px] font-bold uppercase tracking-[0.18em] text-i3">
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
                  className="block w-full rounded-2xl border border-transparent bg-white/90 px-3.5 py-2.5 text-left text-xs font-medium text-i1 shadow-sm transition-all hover:border-brand/20 hover:bg-s0 hover:shadow-md active:scale-[0.99]"
                >
                  <span className="text-i3/80">&ldquo;</span>
                  {ex}
                  <span className="text-i3/80">&rdquo;</span>
                </button>
              ))}
            </div>
          </div>
          </div>
        </motion.aside>
      </div>
    </div>
  );
}
