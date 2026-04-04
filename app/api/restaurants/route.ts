import { NextRequest, NextResponse } from "next/server";
import type { GrubrProfile } from "@/lib/grubr-storage";
import { backendUpstreamHeaders, getBackendOrigin } from "@/lib/backend-url";
import { buildPlacesSearchQuery } from "@/lib/places-bridge";

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

  const origin = getBackendOrigin();
  const url = new URL("/restaurants", origin.endsWith("/") ? origin : `${origin}/`);
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
      headers: backendUpstreamHeaders(),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json(
        {
          error: `Non-JSON from backend (HTTP ${res.status})`,
          data: [],
          hint: text.slice(0, 120).replace(/\s+/g, " "),
        },
        { status: 502 },
      );
    }
    if (!res.ok) {
      const o = json as { error?: string; data?: unknown };
      return NextResponse.json(
        {
          error: o.error ?? `Backend HTTP ${res.status}`,
          data: Array.isArray(o.data) ? o.data : [],
        },
        { status: 502 },
      );
    }
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fetch failed";
    return NextResponse.json(
      { error: message, data: [], hint: `Tried ${getBackendOrigin()}` },
      { status: 502 },
    );
  }
}
