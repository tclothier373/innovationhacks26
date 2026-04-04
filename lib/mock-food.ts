import type { GrubrProfile } from "./grubr-storage";

export type FoodItem = {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  tags: string[];
};

export type Restaurant = {
  id: string;
  name: string;
  stars: number;
  reviewCount: number;
  cuisine: string;
  items: FoodItem[];
};

/** Demo data — replace with API in production */
export const RESTAURANTS: Restaurant[] = [
  {
    id: "r1",
    name: "Mediterranean Breeze",
    stars: 4.6,
    reviewCount: 312,
    cuisine: "Mediterranean",
    items: [
      {
        id: "i1",
        restaurantId: "r1",
        name: "Chicken Shawarma Bowl",
        description: "Marinated chicken, tahini, pickled vegetables, warm pita.",
        tags: ["mediterranean", "bowl", "chicken"],
      },
      {
        id: "i2",
        restaurantId: "r1",
        name: "Falafel Wrap",
        description: "Crispy falafel, hummus, cucumber, herbs.",
        tags: ["mediterranean", "vegetarian", "wrap"],
      },
      {
        id: "i3",
        restaurantId: "r1",
        name: "Greek Salad",
        description: "Feta, olives, tomato, olive oil, oregano.",
        tags: ["mediterranean", "salad", "vegetarian"],
      },
    ],
  },
  {
    id: "r2",
    name: "Taco Libre",
    stars: 4.3,
    reviewCount: 891,
    cuisine: "Mexican",
    items: [
      {
        id: "i4",
        restaurantId: "r2",
        name: "Al Pastor Tacos",
        description: "Pineapple, cilantro, onion, corn tortillas.",
        tags: ["mexican", "tacos", "pork"],
      },
      {
        id: "i5",
        restaurantId: "r2",
        name: "Quesadilla",
        description: "Oaxaca cheese, poblano, crema.",
        tags: ["mexican", "cheese"],
      },
      {
        id: "i6",
        restaurantId: "r2",
        name: "Elote Bowl",
        description: "Grilled corn, cotija, lime, chipotle mayo.",
        tags: ["mexican", "bowl", "vegetarian"],
      },
    ],
  },
  {
    id: "r3",
    name: "Umami Ramen House",
    stars: 4.8,
    reviewCount: 1204,
    cuisine: "Japanese",
    items: [
      {
        id: "i7",
        restaurantId: "r3",
        name: "Tonkotsu Ramen",
        description: "Rich pork broth, chashu, soft egg, nori.",
        tags: ["japanese", "ramen", "pork"],
      },
      {
        id: "i8",
        restaurantId: "r3",
        name: "Spicy Miso Ramen",
        description: "Miso blend, corn, bean sprouts, chili oil.",
        tags: ["japanese", "spicy", "ramen"],
      },
    ],
  },
  {
    id: "r4",
    name: "Nonna's Italian Kitchen",
    stars: 4.5,
    reviewCount: 445,
    cuisine: "Italian",
    items: [
      {
        id: "i9",
        restaurantId: "r4",
        name: "Margherita Pizza",
        description: "San Marzano tomatoes, fresh mozzarella, basil.",
        tags: ["italian", "pizza", "vegetarian"],
      },
      {
        id: "i10",
        restaurantId: "r4",
        name: "Cacio e Pepe",
        description: "Pecorino romano, black pepper, pasta.",
        tags: ["italian", "pasta"],
      },
    ],
  },
];

const ALL_ITEMS = RESTAURANTS.flatMap((r) => r.items);

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

/** Simple keyword filter for demo "AI context" */
export function filterItemsByPrompt(
  prompt: string,
  profile: GrubrProfile | null,
): FoodItem[] {
  const profileTags: string[] = [];
  if (profile?.favoriteFood) {
    profileTags.push(
      ...normalize(profile.favoriteFood).split(/\s+/).filter((w) => w.length > 2),
    );
  }
  if (profile?.dietaryRestrictions?.length) {
    for (const d of profile.dietaryRestrictions) {
      profileTags.push(normalize(d));
    }
  }

  const p = normalize(prompt);
  const exclude: string[] = [];
  const include: string[] = [];

  const noMatch = p.match(/don'?t\s+want\s+([a-z\s]+)/i);
  if (noMatch) {
    exclude.push(...normalize(noMatch[1]).split(/\s+/).filter(Boolean));
  }
  const notMatch = p.match(/no\s+([a-z]+)\s+food/i);
  if (notMatch) exclude.push(normalize(notMatch[1]));

  if (p.includes("mediterranean")) {
    include.push("mediterranean");
  }
  if (p.includes("italian")) include.push("italian");
  if (p.includes("japanese") || p.includes("ramen")) {
    include.push("japanese", "ramen");
  }
  if (p.includes("mexican") || p.includes("taco")) {
    include.push("mexican", "tacos");
  }
  if (p.includes("vegetarian") || p.includes("vegan")) {
    include.push("vegetarian");
  }
  if (p.includes("spicy")) include.push("spicy");

  let items = [...ALL_ITEMS];

  if (exclude.length) {
    items = items.filter((item) => {
      const blob = `${item.tags.join(" ")} ${item.name} ${item.description}`;
      return !exclude.some((ex) => ex.length > 2 && blob.includes(ex));
    });
  }

  if (include.length) {
    items = items.filter((item) =>
      include.some((inc) =>
        item.tags.some((t) => t.includes(inc)) ||
        item.name.toLowerCase().includes(inc),
      ),
    );
  }

  if (profileTags.length) {
    const merged = items.filter((item) =>
      profileTags.some((tag) =>
        item.tags.some((t) => t.includes(tag)) ||
        item.name.toLowerCase().includes(tag),
      ),
    );
    if (merged.length) items = merged;
  }

  const dietary = profile?.dietaryRestrictions ?? [];
  if (dietary.includes("Vegetarian") || dietary.includes("Vegan")) {
    items = items.filter(
      (item) =>
        !item.tags.some((t) => ["pork", "chicken", "beef"].includes(t)) &&
        !/\b(chicken|beef|pork|fish)\b/i.test(item.name),
    );
  }
  if (dietary.includes("Vegan")) {
    items = items.filter(
      (item) =>
        !item.tags.includes("cheese") && !/cheese|cream|egg/i.test(item.name),
    );
  }

  return items.length ? items : ALL_ITEMS;
}

export function getRestaurantById(id: string): Restaurant | undefined {
  return RESTAURANTS.find((r) => r.id === id);
}

export const LIKES_THRESHOLD_SUGGEST = 3;
