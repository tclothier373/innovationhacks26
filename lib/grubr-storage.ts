const PREFIX = "grubr_";

export type GrubrProfile = {
  dietaryRestrictions: string[];
  favoriteFood: string;
  radiusMiles: number;
  priceLevel: 1 | 2 | 3 | 4;
  location: {
    lat: number;
    lng: number;
    label: string;
  } | null;
};

export type GrubrSwipeState = {
  /** restaurantId -> number of likes */
  restaurantLikes: Record<string, number>;
  /** item ids user has already seen (passed or rated) */
  seenItemIds: string[];
  contextPrompt: string;
};

const defaultSwipe: GrubrSwipeState = {
  restaurantLikes: {},
  seenItemIds: [],
  contextPrompt: "",
};

export function hasCompletedOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(`${PREFIX}onboarding`) === "1";
}

export function getProfile(): GrubrProfile | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(`${PREFIX}profile`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GrubrProfile;
  } catch {
    return null;
  }
}

export function saveProfile(profile: GrubrProfile): void {
  window.localStorage.setItem(`${PREFIX}profile`, JSON.stringify(profile));
  window.localStorage.setItem(`${PREFIX}onboarding`, "1");
}

export function getSwipeState(): GrubrSwipeState {
  if (typeof window === "undefined") return { ...defaultSwipe };
  const raw = window.localStorage.getItem(`${PREFIX}swipe`);
  if (!raw) return { ...defaultSwipe };
  try {
    const parsed = JSON.parse(raw) as GrubrSwipeState;
    return {
      ...defaultSwipe,
      ...parsed,
      restaurantLikes: parsed.restaurantLikes ?? {},
      seenItemIds: parsed.seenItemIds ?? [],
    };
  } catch {
    return { ...defaultSwipe };
  }
}

export function saveSwipeState(state: GrubrSwipeState): void {
  window.localStorage.setItem(`${PREFIX}swipe`, JSON.stringify(state));
}

export function resetAllGrubrData(): void {
  if (typeof window === "undefined") return;
  const keys = Object.keys(window.localStorage);
  for (const k of keys) {
    if (k.startsWith(PREFIX)) window.localStorage.removeItem(k);
  }
}
