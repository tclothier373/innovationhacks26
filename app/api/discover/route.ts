import { NextRequest, NextResponse } from "next/server";
import type { GrubrProfile } from "@/lib/grubr-storage";
import { backendUpstreamHeaders, getBackendOrigin } from "@/lib/backend-url";
import { buildPlacesSearchQuery } from "@/lib/places-bridge";

export async function POST(req: NextRequest) {
  let body: { profile?: GrubrProfile | null; contextPrompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", data: [], menus: [] }, { status: 400 });
  }

  const profile = body.profile ?? null;
  const contextPrompt = typeof body.contextPrompt === "string" ? body.contextPrompt : "";
  const query = buildPlacesSearchQuery(profile, contextPrompt);

  const origin = getBackendOrigin();
  const url = new URL("/discover", origin.endsWith("/") ? origin : `${origin}/`);

  const backendBody: Record<string, unknown> = { query };
  if (profile?.location) {
    backendBody.lat = profile.location.lat;
    backendBody.lng = profile.location.lng;
    backendBody.radius_meters = Math.min(
      Math.round((profile.radiusMiles ?? 5) * 1609.34),
      50000,
    );
  }

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      cache: "no-store",
      headers: backendUpstreamHeaders(),
      body: JSON.stringify(backendBody),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json(
        { error: `Non-JSON from backend (HTTP ${res.status})`, data: [], menus: [] },
        { status: 502 },
      );
    }
    if (!res.ok) {
      const o = json as { error?: string };
      return NextResponse.json(
        { error: o.error ?? `Backend HTTP ${res.status}`, data: [], menus: [] },
        { status: 502 },
      );
    }
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fetch failed";
    return NextResponse.json(
      { error: message, data: [], menus: [], hint: `Tried ${getBackendOrigin()}` },
      { status: 502 },
    );
  }
}
