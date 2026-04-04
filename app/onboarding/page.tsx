"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { GrubrHeader } from "@/components/grubr-header";
import { agentTransitionHref } from "@/lib/agent-transition";
import { saveProfile, type GrubrProfile } from "@/lib/grubr-storage";

const DIETARY_OPTIONS = [
  { label: "No restrictions", value: "None", icon: "✨" },
  { label: "Vegetarian", value: "Vegetarian", icon: "🥦" },
  { label: "Vegan", value: "Vegan", icon: "🌱" },
  { label: "Gluten-free", value: "Gluten-free", icon: "🌾" },
  { label: "Nut-free", value: "Nut-free", icon: "🥜" },
  { label: "Dairy-free", value: "Dairy-free", icon: "🥛" },
  { label: "Halal", value: "Halal", icon: "🌙" },
  { label: "Kosher", value: "Kosher", icon: "✡️" },
] as const;

const STEPS = ["Preferences", "Location", "Vibe"] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);

  const [dietary, setDietary] = useState<string[]>(["None"]);
  const [favoriteFood, setFavoriteFood] = useState("");
  const [radiusMiles, setRadiusMiles] = useState(5);
  const [priceLevel, setPriceLevel] = useState<1 | 2 | 3 | 4>(2);
  const [location, setLocation] = useState<GrubrProfile["location"]>(null);
  const [locStatus, setLocStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [error, setError] = useState<string | null>(null);
  const [prototypeGrubhubUrlsText, setPrototypeGrubhubUrlsText] = useState("");

  function toggleDietary(option: string) {
    if (option === "None") { setDietary(["None"]); return; }
    setDietary((prev) => {
      const withoutNone = prev.filter((x) => x !== "None");
      if (withoutNone.includes(option)) {
        const next = withoutNone.filter((x) => x !== option);
        return next.length ? next : ["None"];
      }
      return [...withoutNone, option];
    });
  }

  function requestLocation() {
    setLocStatus("loading");
    setError(null);
    if (!navigator.geolocation) {
      setLocStatus("err");
      setError("Location is not supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: "Current location" });
        setLocStatus("ok");
      },
      () => {
        setLocStatus("err");
        setError("Could not access location — we'll use your radius settings instead.");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const prototypeGrubhubUrls = prototypeGrubhubUrlsText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.includes("grubhub.com"));
    const profile: GrubrProfile = {
      dietaryRestrictions: dietary.filter((d) => d !== "None"),
      favoriteFood: favoriteFood.trim() || "Everything",
      radiusMiles,
      priceLevel,
      location,
      ...(prototypeGrubhubUrls.length
        ? { prototypeGrubhubUrls }
        : {}),
    };
    saveProfile(profile);
    router.push(agentTransitionHref("/swiping", "after_onboarding"));
  }

  const slideIn = {
    initial: { opacity: 0, x: 28 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -28 },
    transition: { duration: 0.32, ease: "easeOut" as const },
  };

  return (
    <div className="flex min-h-screen flex-col">
      <GrubrHeader />

      <main className="flex flex-1 items-start justify-center px-4 py-5 md:items-center">
        <div className="w-full max-w-md">

          {/* Brand headline */}
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mb-4 text-center"
          >
            <p className="mb-1 text-xs font-bold tracking-[0.18em] uppercase text-white/50">
              Welcome to
            </p>
            <h1
              className="text-5xl font-extrabold tracking-tight text-white"
              style={{ fontFamily: "var(--font-syne)" }}
            >
              Grubr
            </h1>
            <p className="mt-2 text-sm text-white/70">
              Tell us about yourself so we can find food you&apos;ll love.
            </p>
          </motion.div>

          {/* Step pill indicators */}
          <div className="mb-4 flex items-center justify-center gap-2">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => i <= step && setStep(i)}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold transition-all ${
                    i === step
                      ? "bg-white text-brand shadow-md"
                      : i < step
                        ? "bg-white/40 text-white"
                        : "bg-white/15 text-white/40"
                  }`}
                >
                  {i < step ? "✓" : i + 1}
                </button>
                {i < STEPS.length - 1 && (
                  <div className={`h-px w-8 transition-colors ${i < step ? "bg-white/50" : "bg-white/20"}`} />
                )}
              </div>
            ))}
          </div>

          {/* Card */}
          <div className="overflow-hidden rounded-3xl border border-white/15 bg-white/10 backdrop-blur-xl shadow-2xl shadow-black/20">
            <form onSubmit={handleSubmit}>
              <AnimatePresence mode="wait">

                {/* STEP 0 — Dietary + price */}
                {step === 0 && (
                  <motion.div key="step0" {...slideIn} className="p-6">
                    <h2
                      className="mb-1 text-xl font-extrabold text-white"
                      style={{ fontFamily: "var(--font-syne)" }}
                    >
                      Your preferences
                    </h2>
                    <p className="mb-5 text-sm text-white/65">
                      What should we keep in mind while swiping?
                    </p>

                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/55">
                      Dietary
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {DIETARY_OPTIONS.map(({ label, value, icon }) => {
                        const active = value === "None" ? dietary.includes("None") : dietary.includes(value);
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => toggleDietary(value)}
                            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all ${
                              active
                                ? "border-white bg-white text-brand shadow-sm"
                                : "border-white/25 bg-white/8 text-white/85 hover:bg-white/14"
                            }`}
                          >
                            <span>{icon}</span>
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-6">
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/55">
                        Price range
                      </p>
                      <div className="grid grid-cols-4 gap-2">
                        {([1, 2, 3, 4] as const).map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setPriceLevel(n)}
                            className={`rounded-xl border py-3 text-center text-sm font-bold transition-all ${
                              priceLevel === n
                                ? "border-white bg-white text-brand shadow-sm scale-[1.03]"
                                : "border-white/25 bg-white/8 text-white/80 hover:bg-white/14"
                            }`}
                            aria-pressed={priceLevel === n}
                          >
                            {"$".repeat(n)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setStep(1)}
                      className="mt-6 w-full rounded-xl bg-white py-3 text-sm font-bold text-brand shadow-lg transition-all hover:bg-white/92 active:scale-[0.98]"
                    >
                      Continue →
                    </button>
                  </motion.div>
                )}

                {/* STEP 1 — Location */}
                {step === 1 && (
                  <motion.div key="step1" {...slideIn} className="p-6">
                    <h2
                      className="mb-1 text-xl font-extrabold text-white"
                      style={{ fontFamily: "var(--font-syne)" }}
                    >
                      Where are you?
                    </h2>
                    <p className="mb-5 text-sm text-white/65">
                      Used only on your device to surface nearby spots.
                    </p>

                    <button
                      type="button"
                      onClick={requestLocation}
                      disabled={locStatus === "loading"}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition-all ${
                        locStatus === "ok"
                          ? "border-white bg-white text-brand"
                          : "border-white/35 bg-white/10 text-white hover:bg-white/16"
                      } disabled:opacity-60`}
                    >
                      {locStatus === "loading" && (
                        <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin-ring" />
                      )}
                      {locStatus === "ok" ? "📍 Location saved" : locStatus === "loading" ? "Locating…" : "📍 Use my location"}
                    </button>

                    {location && (
                      <p className="mt-2 text-center text-xs text-white/65">
                        {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                      </p>
                    )}
                    {error && <p className="mt-2 text-center text-xs text-amber-200" role="alert">{error}</p>}

                    <div className="mt-6">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wider text-white/55">Search radius</p>
                        <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-bold text-white">
                          {radiusMiles} mi
                        </span>
                      </div>
                      <div className="relative">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                          <div
                            className="h-full rounded-full bg-white transition-all"
                            style={{ width: `${((radiusMiles - 1) / 24) * 100}%` }}
                          />
                        </div>
                        <input
                          type="range"
                          min={1}
                          max={25}
                          value={radiusMiles}
                          onChange={(e) => setRadiusMiles(Number(e.target.value))}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        />
                      </div>
                      <div className="mt-1 flex justify-between text-[10px] text-white/40">
                        <span>1 mi</span>
                        <span>25 mi</span>
                      </div>
                    </div>

                    <div className="mt-6 flex gap-3">
                      <button
                        type="button"
                        onClick={() => setStep(0)}
                        className="flex-1 rounded-xl border border-white/25 bg-white/8 py-3 text-sm font-semibold text-white/80 transition-all hover:bg-white/14"
                      >
                        ← Back
                      </button>
                      <button
                        type="button"
                        onClick={() => setStep(2)}
                        className="flex-[2] rounded-xl bg-white py-3 text-sm font-bold text-brand shadow-lg transition-all hover:bg-white/92 active:scale-[0.98]"
                      >
                        Continue →
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* STEP 2 — Favorite food + submit */}
                {step === 2 && (
                  <motion.div key="step2" {...slideIn} className="p-6">
                    <h2
                      className="mb-1 text-xl font-extrabold text-white"
                      style={{ fontFamily: "var(--font-syne)" }}
                    >
                      Your food vibe
                    </h2>
                    <p className="mb-5 text-sm text-white/65">
                      What&apos;s your go-to? We&apos;ll use this as a starting point.
                    </p>

                    <label htmlFor="favorite" className="block text-xs font-semibold uppercase tracking-wider text-white/55">
                      Favorite food
                    </label>
                    <input
                      id="favorite"
                      type="text"
                      value={favoriteFood}
                      onChange={(e) => setFavoriteFood(e.target.value)}
                      placeholder="e.g. spicy ramen, crispy tacos, sushi…"
                      className="mt-2 w-full rounded-xl border border-white/20 bg-white px-4 py-3 text-sm font-medium text-i0 shadow-inner placeholder:text-i3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />

                    <label
                      htmlFor="demo-grubhub-urls"
                      className="mt-5 block text-xs font-semibold uppercase tracking-wider text-white/55"
                    >
                      Demo: Grubhub menu URLs (optional)
                    </label>
                    <p className="mt-1 text-[11px] leading-snug text-white/45">
                      Optional override: one URL per line or comma-separated, index-aligned with Places
                      results. If you leave this blank and the backend has scraping + Gemini enabled,
                      it will try to infer Grubhub links from names automatically (demo only).
                    </p>
                    <textarea
                      id="demo-grubhub-urls"
                      value={prototypeGrubhubUrlsText}
                      onChange={(e) => setPrototypeGrubhubUrlsText(e.target.value)}
                      placeholder="https://www.grubhub.com/restaurant/…"
                      rows={3}
                      className="mt-2 w-full resize-y rounded-xl border border-white/20 bg-white/95 px-3 py-2 text-xs font-medium text-i0 shadow-inner placeholder:text-i3 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />

                    {/* Preview summary */}
                    <div className="mt-5 space-y-2 rounded-xl border border-white/15 bg-white/8 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-white/45 mb-2">Your profile</p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-white/65">Diet</span>
                        <span className="text-xs font-semibold text-white">{dietary.join(", ")}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-white/65">Price</span>
                        <span className="text-xs font-semibold text-white">{"$".repeat(priceLevel)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-white/65">Radius</span>
                        <span className="text-xs font-semibold text-white">{radiusMiles} mi</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-white/65">Location</span>
                        <span className="text-xs font-semibold text-white">{locStatus === "ok" ? "Saved" : "Skipped"}</span>
                      </div>
                    </div>

                    <div className="mt-6 flex gap-3">
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="flex-1 rounded-xl border border-white/25 bg-white/8 py-3 text-sm font-semibold text-white/80 transition-all hover:bg-white/14"
                      >
                        ← Back
                      </button>
                      <button
                        type="submit"
                        className="flex-[2] rounded-xl bg-white py-3 text-sm font-bold text-brand shadow-lg transition-all hover:bg-white/92 active:scale-[0.98]"
                      >
                        Start Swiping 🍴
                      </button>
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </form>
          </div>

        </div>
      </main>
    </div>
  );
}
