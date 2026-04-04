/** Preset copy for the full-screen Grubr “agent” transition (used only after onboarding and after choosing a restaurant). */

export type AgentPhaseKey = "after_onboarding" | "after_restaurant_choice";

export type AgentPhase = {
  headline: string;
  subline: string;
  steps: string[];
};

export const AGENT_PHASES: Record<AgentPhaseKey, AgentPhase> = {
  after_onboarding: {
    headline: "Grubr Agent",
    subline: "Locking in how we’ll hunt for your next meal",
    steps: [
      "Gather context from your profile",
      "Map diet, price, and radius near you",
      "Tune discovery to your favorite flavors",
      "Open your personalized swipe feed",
    ],
  },
  after_restaurant_choice: {
    headline: "Grubr Agent",
    subline: "You picked a spot — we’re wiring up your order flow",
    steps: [
      "Confirm your restaurant decision",
      "Determine your top foods from this kitchen",
      "Sync menu data for swipe or full browse",
      "Open cart-ready ordering for this place",
    ],
  },
};

const DEFAULT_PHASE: AgentPhaseKey = "after_onboarding";

export function isAgentPhaseKey(v: string): v is AgentPhaseKey {
  return v in AGENT_PHASES;
}

/** Only allow in-app paths (prevents open redirects). */
export function safeInternalPath(raw: string | null): string {
  if (!raw || typeof raw !== "string") return "/swiping";
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return "/swiping";
  }
  const t = path.trim();
  if (!t.startsWith("/")) return "/swiping";
  if (t.startsWith("//")) return "/swiping";
  const lower = t.toLowerCase();
  if (lower.includes("javascript:") || lower.includes("data:")) return "/swiping";
  if (t.includes("@")) return "/swiping";
  return t;
}

export function agentTransitionHref(next: string, phase: AgentPhaseKey): string {
  return `/agent-transition?next=${encodeURIComponent(next)}&phase=${phase}`;
}

export function resolveAgentPhase(phaseParam: string | null): AgentPhaseKey {
  if (phaseParam && isAgentPhaseKey(phaseParam)) return phaseParam;
  return DEFAULT_PHASE;
}
