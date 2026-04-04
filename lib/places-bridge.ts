import type { GrubrProfile } from "./grubr-storage";
import type { FoodItem, Restaurant } from "./mock-food";

export type ProposedMenuItem = {
  name: string;
  description: string;
  tags?: string[];
};

/** Row shape from FastAPI `/restaurants` */
export type PlacesApiRestaurantRow = {
  place_id?: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  cuisine?: string;
  main_food?: string;
  price_range?: string;
  vicinity?: string;
  formatted_address?: string;
  /** Optional per-row Grubhub URL for prototype menu scrape (backend). */
  grubhub_url?: string;
  grubhubUrl?: string;
};

function slugId(s: string, index: number): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return `${base || "place"}-${index}`;
}

function tagBlob(cuisine: string, mainFood: string): string[] {
  const tags = new Set<string>();
  const c = cuisine.toLowerCase().trim() || "restaurant";
  tags.add(c.split(/\s+/)[0] || "food");
  for (const w of mainFood.toLowerCase().split(/\s+/)) {
    if (w.length > 2) tags.add(w.replace(/[^a-z0-9]/g, ""));
  }
  return [...tags].filter(Boolean);
}

/** Build Google Places keyword / text query from onboarding + swipe context. */
export function buildPlacesSearchQuery(
  profile: GrubrProfile | null,
  contextPrompt: string,
): string {
  const parts: string[] = [];

  const prompt = contextPrompt.trim();
  if (prompt) parts.push(prompt);

  if (profile?.favoriteFood?.trim()) {
    parts.push(profile.favoriteFood.trim());
  }

  const diet = profile?.dietaryRestrictions?.filter((d) => d !== "None") ?? [];
  if (diet.length) parts.push(diet.join(" "));

  const pl = profile?.priceLevel ?? 2;
  const priceHint =
    pl <= 1 ? "budget cheap" : pl === 2 ? "" : pl === 3 ? "upscale" : "fine dining";
  if (priceHint) parts.push(priceHint);

  parts.push("restaurant food");

  const q = parts.join(" ").replace(/\s+/g, " ").trim();
  return q.length > 200 ? q.slice(0, 200) : q || "restaurants";
}

export function mapPlacesApiToRestaurants(rows: PlacesApiRestaurantRow[]): Restaurant[] {
  return rows.map((row, index) => {
    const name =
      typeof row.name === "string" && row.name.trim()
        ? row.name.trim()
        : `Restaurant ${index + 1}`;
    const id = row.place_id?.trim() || slugId(name, index);
    const cuisine = (row.cuisine || "Restaurant").trim();
    const mainFood = (row.main_food || "House favorite").trim();
    const tags = tagBlob(cuisine, mainFood);

    const items: FoodItem[] = [
      {
        id: `${id}::main`,
        restaurantId: id,
        name: mainFood,
        description: `Popular pick at ${name} — ${cuisine} flavors.`,
        tags,
      },
      {
        id: `${id}::sig`,
        restaurantId: id,
        name: `${cuisine} signature bowl`,
        description:
          row.price_range === "cheap"
            ? "Hearty portion, great value."
            : "Chef’s recommended combo plate.",
        tags: [...tags, cuisine.toLowerCase().split(/\s+/)[0] || "combo"],
      },
      {
        id: `${id}::side`,
        restaurantId: id,
        name: "Sides & refreshment",
        description: "Round out your order with classics from this spot.",
        tags: [...tags, "sides"],
      },
    ];

    return {
      id,
      name,
      stars: typeof row.rating === "number" ? row.rating : 4.2,
      reviewCount:
        typeof row.user_ratings_total === "number"
          ? row.user_ratings_total
          : 128,
      cuisine,
      items,
    };
  });
}

function slugPart(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 28)
      .replace(/(^-|-$)/g, "") || "dish"
  );
}

/**
 * Replace generic placeholder dishes with Gemini-proposed popular items (3–5 per place).
 * `menus[i]` aligns with `rows[i]` from the Places API.
 */
export function mergeProposedMenusIntoRestaurants(
  rows: PlacesApiRestaurantRow[],
  menus: ProposedMenuItem[][] | null | undefined,
): Restaurant[] {
  const base = mapPlacesApiToRestaurants(rows);
  if (!menus?.length) return base;
  return base.map((restaurant, i) => {
    const proposed = menus[i];
    if (!proposed?.length) return restaurant;
    const capped = proposed.slice(0, 5);
    const items: FoodItem[] = capped.map((it, j) => ({
      id: `${restaurant.id}::m${j}-${slugPart(it.name)}`,
      restaurantId: restaurant.id,
      name: (it.name || `Dish ${j + 1}`).trim().slice(0, 120),
      description: (it.description || "Popular pick.").trim().slice(0, 280),
      tags:
        Array.isArray(it.tags) && it.tags.length
          ? it.tags.map((t) => String(t).toLowerCase().replace(/\s+/g, ""))
          : tagBlob(restaurant.cuisine, it.name),
    }));
    return { ...restaurant, items };
  });
}

export type FetchPlacesMenuOptions = {
  /** Index-aligned with `rows` — sent to backend for prototype Grubhub scrape. */
  prototypeGrubhubUrls?: string[];
};

/** Load Places rows, then ask the backend for menus (Gemini and/or prototype Grubhub scrape). */
export async function fetchPlacesWithProposedMenus(
  rows: PlacesApiRestaurantRow[],
  options?: FetchPlacesMenuOptions,
): Promise<Restaurant[]> {
  const base = mapPlacesApiToRestaurants(rows);
  const urls = options?.prototypeGrubhubUrls?.filter((u) => u.trim().length > 0);
  try {
    const res = await fetch("/api/menu-proposals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurants: rows,
        ...(urls?.length ? { prototypeGrubhubUrls: urls } : {}),
      }),
    });
    const raw = await res.text();
    let parsed: { menus?: unknown } = {};
    try {
      parsed = raw ? (JSON.parse(raw) as { menus?: unknown }) : {};
    } catch {
      return base;
    }
    const m = parsed.menus;
    if (!Array.isArray(m)) return base;
    return mergeProposedMenusIntoRestaurants(rows, m as ProposedMenuItem[][]);
  } catch {
    return base;
  }
}
