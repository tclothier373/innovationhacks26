import { NextRequest, NextResponse } from "next/server";
import { backendUpstreamHeaders, getBackendOrigin } from "@/lib/backend-url";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", menus: [] }, { status: 400 });
  }

  const origin = getBackendOrigin();
  const url = new URL("/menu-proposals", origin.endsWith("/") ? origin : `${origin}/`);

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      cache: "no-store",
      headers: backendUpstreamHeaders(),
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return NextResponse.json(
        {
          error: "Backend returned non-JSON for menu-proposals",
          menus: [],
          raw: text.slice(0, 200),
        },
        { status: 502 },
      );
    }
    if (!res.ok) {
      return NextResponse.json(
        {
          error: `Backend HTTP ${res.status}`,
          ...(typeof json === "object" && json !== null ? json : {}),
          menus: [],
        },
        { status: 502 },
      );
    }
    return NextResponse.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fetch failed";
    return NextResponse.json(
      { error: message, menus: [], hint: `Tried ${url.toString()}` },
      { status: 502 },
    );
  }
}
