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

export type GrubrCartItem = {
  id: string;
  restaurantId: string;
  name: string;
  priceCents: number;
  quantity: number;
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

export function getCartItems(): GrubrCartItem[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(`${PREFIX}cart`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as GrubrCartItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCartItems(items: GrubrCartItem[]): void {
  window.localStorage.setItem(`${PREFIX}cart`, JSON.stringify(items));
}

export function addItemToCart(nextItem: Omit<GrubrCartItem, "quantity">): void {
  const existing = getCartItems();
  const idx = existing.findIndex((i) => i.id === nextItem.id);
  if (idx >= 0) {
    existing[idx] = {
      ...existing[idx],
      quantity: existing[idx].quantity + 1,
    };
  } else {
    existing.push({ ...nextItem, quantity: 1 });
  }
  saveCartItems(existing);
}

export function removeItemFromCart(itemId: string): void {
  const existing = getCartItems();
  const target = existing.find((i) => i.id === itemId);
  if (!target) return;
  if (target.quantity > 1) {
    saveCartItems(
      existing.map((i) =>
        i.id === itemId ? { ...i, quantity: i.quantity - 1 } : i,
      ),
    );
  } else {
    saveCartItems(existing.filter((i) => i.id !== itemId));
  }
}

export function clearCart(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${PREFIX}cart`);
}

export function setTargetRestaurantId(restaurantId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${PREFIX}target_restaurant`, restaurantId);
}

export function getTargetRestaurantId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(`${PREFIX}target_restaurant`);
}

export function clearTargetRestaurantId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(`${PREFIX}target_restaurant`);
}

export function saveCheckoutAddress(address: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${PREFIX}address`, address.trim());
}

export function getCheckoutAddress(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(`${PREFIX}address`) ?? "";
}

export function getDismissedSuggestionIds(): string[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(`${PREFIX}dismissed_suggestions`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function addDismissedSuggestionId(restaurantId: string): void {
  if (typeof window === "undefined") return;
  const existing = getDismissedSuggestionIds();
  if (!existing.includes(restaurantId)) {
    window.localStorage.setItem(
      `${PREFIX}dismissed_suggestions`,
      JSON.stringify([...existing, restaurantId]),
    );
  }
}

export function resetAllGrubrData(): void {
  if (typeof window === "undefined") return;
  const keys = Object.keys(window.localStorage);
  for (const k of keys) {
    if (k.startsWith(PREFIX)) window.localStorage.removeItem(k);
  }
}
