import type { GrubrProfile } from "./grubr-storage";
import type { FoodItem, Restaurant } from "./mock-food";

/** Row shape from FastAPI `/restaurants` */
export type PlacesApiRestaurantRow = {
  place_id?: string;
  name: string;
  rating?: number;
  user_ratings_total?: number;
  cuisine?: string;
  main_food?: string;
  price_range?: string;
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
    const id = row.place_id?.trim() || slugId(row.name, index);
    const cuisine = (row.cuisine || "Restaurant").trim();
    const mainFood = (row.main_food || "House favorite").trim();
    const tags = tagBlob(cuisine, mainFood);

    const items: FoodItem[] = [
      {
        id: `${id}::main`,
        restaurantId: id,
        name: mainFood,
        description: `Popular pick at ${row.name} — ${cuisine} flavors.`,
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
      name: row.name,
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
