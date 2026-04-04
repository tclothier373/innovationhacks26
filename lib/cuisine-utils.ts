export type CuisineVisual = {
  emoji: string;
  gradient: string;
  orbA: string;
  orbB: string;
  orbC: string;
};

const VISUALS: Record<string, CuisineVisual> = {
  mediterranean: {
    emoji: "🥙",
    gradient: "from-amber-50 via-orange-50 to-yellow-50",
    orbA: "bg-amber-300/50",
    orbB: "bg-orange-200/40",
    orbC: "bg-yellow-200/35",
  },
  mexican: {
    emoji: "🌮",
    gradient: "from-yellow-50 via-amber-50 to-orange-50",
    orbA: "bg-yellow-300/50",
    orbB: "bg-amber-300/40",
    orbC: "bg-orange-200/35",
  },
  japanese: {
    emoji: "🍜",
    gradient: "from-orange-50 via-rose-50 to-pink-50",
    orbA: "bg-rose-300/40",
    orbB: "bg-orange-200/45",
    orbC: "bg-pink-200/30",
  },
  italian: {
    emoji: "🍕",
    gradient: "from-amber-50 via-orange-100 to-red-50",
    orbA: "bg-red-200/40",
    orbB: "bg-amber-300/45",
    orbC: "bg-orange-200/35",
  },
};

const DEFAULT: CuisineVisual = {
  emoji: "🍽️",
  gradient: "from-orange-50 via-amber-50 to-yellow-50",
  orbA: "bg-orange-300/45",
  orbB: "bg-amber-200/40",
  orbC: "bg-yellow-200/30",
};

export function getCuisineVisual(cuisine: string): CuisineVisual {
  return VISUALS[cuisine.toLowerCase()] ?? DEFAULT;
}
