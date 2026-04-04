"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GrubrHeader } from "@/components/grubr-header";
import {
  saveProfile,
  type GrubrProfile,
} from "@/lib/grubr-storage";

const DIETARY_OPTIONS = [
  "None",
  "Vegetarian",
  "Vegan",
  "Gluten-free",
  "Nut-free",
  "Dairy-free",
  "Halal",
  "Kosher",
] as const;

export default function OnboardingPage() {
  const router = useRouter();
  const [dietary, setDietary] = useState<string[]>(["None"]);
  const [favoriteFood, setFavoriteFood] = useState("");
  const [radiusMiles, setRadiusMiles] = useState(5);
  const [priceLevel, setPriceLevel] = useState<1 | 2 | 3 | 4>(2);
  const [location, setLocation] = useState<GrubrProfile["location"]>(null);
  const [locStatus, setLocStatus] = useState<"idle" | "loading" | "ok" | "err">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  function toggleDietary(option: string) {
    if (option === "None") {
      setDietary(["None"]);
      return;
    }
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
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: "Current location",
        });
        setLocStatus("ok");
      },
      () => {
        setLocStatus("err");
        setError(
          "We could not access your location. You can still continue — we will use your saved radius and area later.",
        );
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const profile: GrubrProfile = {
      dietaryRestrictions: dietary.filter((d) => d !== "None"),
      favoriteFood: favoriteFood.trim() || "Everything",
      radiusMiles,
      priceLevel,
      location,
    };
    saveProfile(profile);
    router.push("/swiping");
  }

  return (
    <div className="flex min-h-screen flex-col bg-transparent">
      <GrubrHeader />
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Tell us a bit about yourself
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-white/85">
          We will use this to tune dish ideas near you. You can change it anytime
          by resetting from the swipe screen.
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-8">
          <section>
            <h2 className="text-sm font-semibold text-white">
              Dietary restrictions
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {DIETARY_OPTIONS.map((opt) => {
                const active =
                  opt === "None"
                    ? dietary.includes("None")
                    : dietary.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => toggleDietary(opt)}
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                      active
                        ? "border-white bg-white text-grubr-orange shadow-sm"
                        : "border-white/30 bg-white/10 text-white hover:bg-white/15"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <label
              htmlFor="favorite"
              className="text-sm font-semibold text-white"
            >
              Favorite kind of food
            </label>
            <input
              id="favorite"
              type="text"
              value={favoriteFood}
              onChange={(e) => setFavoriteFood(e.target.value)}
              placeholder="e.g. spicy noodles, sushi, brunch"
              className="mt-2 w-full rounded-lg border border-grubr-border-surface bg-grubr-surface px-3 py-2.5 text-sm text-grubr-ink outline-none ring-white/30 placeholder:text-grubr-muted-ink focus:border-white focus:ring-2"
            />
          </section>

          <section>
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-white">
                Search radius
              </label>
              <span className="text-sm font-bold text-white">
                {radiusMiles} mi
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={25}
              value={radiusMiles}
              onChange={(e) => setRadiusMiles(Number(e.target.value))}
              className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-white"
            />
            <p className="mt-1 text-xs text-white/75">
              Restaurants within this distance of you
            </p>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-white">
              Typical price range
            </h2>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {([1, 2, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPriceLevel(n)}
                  className={`rounded-lg border py-2.5 text-center text-sm font-bold transition-colors ${
                    priceLevel === n
                      ? "border-white bg-white text-grubr-orange shadow-sm"
                      : "border-white/30 bg-white/10 text-white hover:bg-white/20"
                  }`}
                  aria-pressed={priceLevel === n}
                >
                  {"$".repeat(n)}
                </button>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-white">Location</h2>
            <p className="mt-1 text-xs text-white/75">
              We only use this on your device for now to center recommendations.
            </p>
            <button
              type="button"
              onClick={requestLocation}
              disabled={locStatus === "loading"}
              className="mt-3 w-full rounded-lg border border-white/40 bg-white py-2.5 text-sm font-semibold text-grubr-orange shadow-sm transition-colors hover:bg-white/90 disabled:opacity-60"
            >
              {locStatus === "loading"
                ? "Requesting location…"
                : location
                  ? "Update location"
                  : "Use my current location"}
            </button>
            {location && (
              <p className="mt-2 text-xs text-white/80">
                {location.label} — {location.lat.toFixed(3)},{" "}
                {location.lng.toFixed(3)}
              </p>
            )}
            {error && (
              <p className="mt-2 text-xs text-amber-100" role="alert">
                {error}
              </p>
            )}
          </section>

          <button
            type="submit"
            className="rounded-lg bg-white py-3 text-sm font-bold text-grubr-orange shadow-md transition-colors hover:bg-white/90"
          >
            Start swiping
          </button>
        </form>
      </main>
    </div>
  );
}
