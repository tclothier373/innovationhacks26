import { NextRequest, NextResponse } from "next/server";
import type { GrubrProfile } from "@/lib/grubr-storage";
import { buildPlacesSearchQuery } from "@/lib/places-bridge";

const DEFAULT_BACKEND = "http://127.0.0.1:8000";

export async function POST(req: NextRequest) {
  let body: { profile?: GrubrProfile | null; contextPrompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", data: [] }, { status: 400 });
  }

  const profile = body.profile ?? null;
  const contextPrompt = typeof body.contextPrompt === "string" ? body.contextPrompt : "";
  const query = buildPlacesSearchQuery(profile, contextPrompt);

  const base = (process.env.GEMINI_API_KEY ?? DEFAULT_BACKEND).replace(/\/$/, "");
  const url = new URL("/restaurants", `${base}/`);
  url.searchParams.set("query", query);
  if (profile?.location) {
    url.searchParams.set("lat", String(profile.location.lat));
    url.searchParams.set("lng", String(profile.location.lng));
    const meters = Math.min(
      Math.round((profile.radiusMiles ?? 5) * 1609.34),
      50000,
    );
    url.searchParams.set("radius_meters", String(meters));
  }

  try {
    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Backend HTTP ${res.status}`, data: [] },
        { status: 502 },
      );
    }
    const json: unknown = await res.json();
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fetch failed";
    return NextResponse.json({ error: message, data: [] }, { status: 502 });
  }
}
