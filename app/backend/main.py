from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Optional

import requests
from starlette.concurrency import run_in_threadpool

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _load_root_env() -> None:
    """Load repo-root .env into os.environ — uvicorn does not do this automatically."""
    here = Path(__file__).resolve()
    for parent in [here.parent, *here.parents]:
        env_path = parent / ".env"
        if env_path.is_file():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = val
            break


_load_root_env()


def _demo_max_restaurants() -> int:
    """Cap Places → client rows and menu-proposals batch size (free-tier / demo safety)."""
    try:
        n = int(os.getenv("DEMO_MAX_RESTAURANTS", "3").strip() or "3")
    except ValueError:
        n = 3
    return max(1, min(n, 12))


# Places REST API requires a Maps Platform key with "Places API" (or legacy) enabled.
# This is NOT the same as a Gemini / AI Studio-only key (AIza... for generative language).
PLACES_API_KEY = (
    os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    or os.getenv("MAPS_API_KEY", "").strip()
    or os.getenv("GEMINI_API_KEY", "").strip()
)

# Optional: Vertex (GCP ADC) or Google AI Studio (GEMINI_API_KEY) for dish/cuisine labels
_vertex_model = None
try:
    import vertexai
    from vertexai.generative_models import GenerativeModel as VertexModel

    vertexai.init(project="innovationhacks26", location="us-central1")
    _vertex_model = VertexModel("gemini-1.5-flash")
except Exception:
    _vertex_model = None

_genai_model = None
try:
    import google.generativeai as genai

    _gk = os.getenv("GEMINI_API_KEY", "").strip()
    if _gk:
        genai.configure(api_key=_gk)
        _genai_model = genai.GenerativeModel("gemini-1.5-flash")
except Exception:
    _genai_model = None


def fallback_enrich(place: dict) -> dict:
    """When Vertex/Gemini enrichment fails, infer a little from Places types."""
    types = place.get("types") or []
    skip = {"point_of_interest", "establishment", "food", "restaurant"}
    cuisine = "Restaurant"
    for t in types:
        if t in skip:
            continue
        cuisine = t.replace("_", " ").title()
        break
    return {
        "cuisine": cuisine,
        "main_food": "Popular house dish",
        "price_range": "moderate",
    }


def _parse_json_from_model(text: str) -> dict:
    raw = (text or "").strip()
    if not raw:
        raise ValueError("empty model response")
    if raw.startswith("```"):
        nl = raw.find("\n")
        raw = raw[nl + 1 :] if nl >= 0 else raw[3:]
        if "```" in raw:
            raw = raw.split("```", 1)[0].strip()
    return json.loads(raw)


def enrich_restaurant(place: dict) -> dict:
    """Single-place enrich; prefer `enrich_restaurants_batch` for multiple venues (one LLM call)."""
    got = enrich_restaurants_batch([place])
    return got[0] if got else fallback_enrich(place)


def enrich_restaurants_batch(places: list[dict]) -> list[dict]:
    """One Gemini/Vertex JSON call for all places — avoids N× rate limits on /restaurants."""
    n = len(places)
    if n == 0:
        return []
    if _genai_model is None and _vertex_model is None:
        return [fallback_enrich(p) for p in places]

    rows: list[dict[str, Any]] = []
    for i, p in enumerate(places):
        rows.append(
            {
                "index": i,
                "name": p.get("name"),
                "types": p.get("types"),
                "price_level": p.get("price_level", "unknown"),
            }
        )

    prompt = f"""For each restaurant in the JSON array below (fixed order), infer:
- cuisine (short label)
- main_food (one plausible popular dish name)
- price_range: one of cheap, moderate, expensive

Restaurants:
{json.dumps(rows, ensure_ascii=False)}

Return ONLY valid JSON:
{{
  "items": [
    {{ "cuisine": "", "main_food": "", "price_range": "" }}
  ]
}}
The "items" array must have exactly {n} objects in the same order as the input.
"""

    parsed: Optional[dict] = None
    if _genai_model is not None:
        try:
            r = _genai_model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            parsed = _parse_json_from_model(getattr(r, "text", "") or "")
        except Exception:
            parsed = None
    if parsed is None and _vertex_model is not None:
        try:
            response = _vertex_model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            parsed = _parse_json_from_model(getattr(response, "text", "") or "")
        except Exception:
            parsed = None

    items = parsed.get("items") if isinstance(parsed, dict) else None
    out: list[dict] = []
    for i in range(n):
        fb = fallback_enrich(places[i])
        cell: dict[str, Any] = {}
        if isinstance(items, list) and i < len(items) and isinstance(items[i], dict):
            cell = items[i]
        out.append(
            {
                "cuisine": (cell.get("cuisine") or fb["cuisine"] or "Restaurant"),
                "main_food": (cell.get("main_food") or fb["main_food"] or "Popular house dish"),
                "price_range": (cell.get("price_range") or fb["price_range"] or "moderate"),
            }
        )
    return out


def get_restaurants_text_search(query: str, api_key: str) -> tuple[list, str, Optional[str]]:
    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params = {"query": query, "key": api_key}
    res = requests.get(url, params=params, timeout=20)
    data = res.json()
    status = data.get("status", "")
    if status not in ("OK", "ZERO_RESULTS"):
        err = data.get("error_message") or status
        return [], status, err
    return data.get("results", []) or [], status, None


def get_restaurants_nearby(
    lat: float, lng: float, radius_meters: int, keyword: str, api_key: str
) -> tuple[list, str, Optional[str]]:
    url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    params = {
        "location": f"{lat},{lng}",
        "radius": min(max(radius_meters, 500), 50000),
        "type": "restaurant",
        "keyword": (keyword or "food")[:200],
        "key": api_key,
    }
    res = requests.get(url, params=params, timeout=20)
    data = res.json()
    status = data.get("status", "")
    if status not in ("OK", "ZERO_RESULTS"):
        err = data.get("error_message") or status
        return [], status, err
    return data.get("results", []) or [], status, None


@app.get("/health")
def health():
    return {
        "status": "ok",
        "demo_max_restaurants": _demo_max_restaurants(),
        "grubhub_scraper_enabled": os.getenv("ENABLE_GRUBHUB_SCRAPER", "").lower()
        in ("1", "true", "yes"),
    }


@app.get("/restaurants")
def get_restaurant_data(
    query: str = "restaurants",
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_meters: Optional[int] = None,
):
    if not PLACES_API_KEY:
        return {
            "data": [],
            "error": "No API key in environment. Set GOOGLE_MAPS_API_KEY (Places-enabled) in .env at repo root, or export it before uvicorn.",
            "places_status": None,
        }

    places_error: Optional[str] = None
    places_status: Optional[str] = None

    if lat is not None and lng is not None:
        r = radius_meters if radius_meters is not None else 8000
        places, places_status, places_error = get_restaurants_nearby(
            float(lat), float(lng), int(r), query, PLACES_API_KEY
        )
    else:
        places, places_status, places_error = get_restaurants_text_search(
            query, PLACES_API_KEY
        )

    if places_error:
        return {
            "data": [],
            "error": places_error,
            "places_status": places_status,
            "hint": "Places API rejected this key. Use a key from Google Cloud Console with 'Places API' enabled (Maps Platform). A Gemini-only / AI Studio key will not work for Places.",
        }

    max_n = _demo_max_restaurants()
    selected = places[:max_n]
    enrichments = enrich_restaurants_batch(selected)

    results: list[dict[str, Any]] = []
    for p, ai_data in zip(selected, enrichments):
        geo = (p.get("geometry") or {}).get("location") or {}
        results.append(
            {
                "place_id": p.get("place_id"),
                "name": p.get("name"),
                "rating": p.get("rating"),
                "user_ratings_total": p.get("user_ratings_total"),
                "price_level": p.get("price_level"),
                "types": p.get("types"),
                "vicinity": p.get("vicinity"),
                "formatted_address": p.get("formatted_address"),
                "lat": geo.get("lat"),
                "lng": geo.get("lng"),
                "cuisine": ai_data.get("cuisine"),
                "main_food": ai_data.get("main_food"),
                "price_range": ai_data.get("price_range"),
            }
        )

    out: dict[str, Any] = {
        "data": results,
        "places_status": places_status,
        "demo_restaurant_limit": max_n,
    }
    if not results and places_status == "ZERO_RESULTS":
        out["error"] = "No restaurants matched this search (ZERO_RESULTS)."
    return out


def _slim_for_menu_prompt(restaurants: list) -> list[dict[str, Any]]:
    slim: list[dict[str, Any]] = []
    cap = _demo_max_restaurants()
    for i, r in enumerate(restaurants[:cap]):
        if not isinstance(r, dict):
            continue
        slim.append(
            {
                "index": i,
                "place_id": r.get("place_id") or "",
                "name": r.get("name") or "Restaurant",
                "cuisine": r.get("cuisine"),
                "main_food": r.get("main_food"),
                "vicinity": r.get("vicinity"),
                "formatted_address": r.get("formatted_address"),
            }
        )
    return slim


def _default_menus_for_slim(slim: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    out: list[list[dict[str, Any]]] = []
    for s in slim:
        name = s.get("name") or "this spot"
        hint = (s.get("main_food") or s.get("cuisine") or "House favorite") or "Chef's pick"
        c = (s.get("cuisine") or "food").lower().split()
        tag0 = c[0] if c else "food"
        out.append(
            [
                {
                    "name": str(hint)[:100],
                    "description": f"A top seller guests order again and again at {name}.",
                    "tags": [tag0, "popular"],
                },
                {
                    "name": f"{s.get('cuisine') or 'Signature'} combo plate",
                    "description": "Mix of best bites — great for trying the menu.",
                    "tags": [tag0, "combo"],
                },
                {
                    "name": "Sides & refreshment",
                    "description": "Round out your meal with classics.",
                    "tags": ["sides"],
                },
            ]
        )
    return out


def _normalize_menu_matrix(
    menus: Any, slim: list[dict[str, Any]]
) -> list[list[dict[str, Any]]]:
    defaults = _default_menus_for_slim(slim)
    if not isinstance(menus, list):
        return defaults
    out: list[list[dict[str, Any]]] = []
    for i in range(len(slim)):
        sub = menus[i] if i < len(menus) and isinstance(menus[i], list) else []
        cleaned: list[dict[str, Any]] = []
        for it in sub:
            if isinstance(it, dict) and str(it.get("name", "")).strip():
                tags = it.get("tags")
                if not isinstance(tags, list):
                    tags = []
                cleaned.append(
                    {
                        "name": str(it.get("name", "")).strip()[:120],
                        "description": str(it.get("description", "")).strip()[:280]
                        or "Customer favorite.",
                        "tags": [
                            str(t).lower().replace(" ", "")[:24]
                            for t in tags
                            if t
                        ][:8],
                    }
                )
        if len(cleaned) < 3:
            cleaned = defaults[i]
        out.append(cleaned[:5])
    return out


def _llm_menu_json(slim: list[dict[str, Any]]) -> Optional[dict]:
    if not slim:
        return None
    n = len(slim)
    prompt = f"""You help a food-ordering discovery app (similar to Grubhub).

For EACH restaurant in the JSON array below (same order), propose **3 to 5** dishes that would typically rank as **most popular / best-selling** on delivery apps or the restaurant's real menu. List **most popular first**.

Restaurants:
{json.dumps(slim, ensure_ascii=False)}

Rules:
- Realistic dish names; one appetizing description line each (no prices).
- Use restaurant **name** and **cuisine**; if the name suggests a known chain, use typical menu knowledge.
- **tags**: 2-4 short lowercase food keywords per item.

Return ONLY valid JSON with this exact shape:
{{
  "menus": [
    [ {{"name": "string", "description": "string", "tags": ["tag"]}} ],
    ... exactly {n} inner arrays in the same order as input
  ]
}}
Each inner array must have 3 to 5 items.
"""
    if _genai_model is not None:
        try:
            r = _genai_model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            return _parse_json_from_model(getattr(r, "text", "") or "")
        except Exception:
            pass
    if _vertex_model is not None:
        try:
            response = _vertex_model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            return _parse_json_from_model(getattr(response, "text", "") or "")
        except Exception:
            pass
    return None


_GRUBHUB_URL_RE = re.compile(
    r"https?://(?:www\.)?grubhub\.com/restaurant/[^\s\"'<>)\]]+",
    re.IGNORECASE,
)


def _normalize_grubhub_url(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    m = _GRUBHUB_URL_RE.search(s)
    if not m:
        return None
    url = m.group(0).rstrip(".,);'\"")
    if "?" in url:
        url = url.split("?", 1)[0]
    return url if url.lower().startswith("http") else None


def _llm_grubhub_urls_batch(slim: list[dict[str, Any]]) -> list[Optional[str]]:
    """Ask Gemini/Vertex for Grubhub listing URLs; validate shape. Prototype / demo use."""
    if not slim:
        return []
    n = len(slim)
    if _genai_model is None and _vertex_model is None:
        return [None] * n

    prompt = f"""You map restaurants from a discovery app to official Grubhub restaurant menu page URLs.

Input (JSON array, fixed order — each entry may include name, cuisine, vicinity or formatted_address from Google Places):
{json.dumps(slim, ensure_ascii=False)}

Task:
- For EACH entry in the same order, output the best matching **Grubhub** menu URL if you can determine it with high confidence (e.g. unambiguous national/regional chain with a well-known Grubhub slug).
- Use **vicinity** or **formatted_address** to disambiguate when the same brand appears in different cities.
- If the venue is independent, ambiguous, or you are not sure of the exact `/restaurant/...` path on grubhub.com, use null.
- **Never** guess random numeric IDs or invent paths — prefer null.

Return ONLY valid JSON:
{{
  "urls": [ "https://www.grubhub.com/restaurant/..." or null ]
}}
The array **urls** must have exactly {n} elements in the same order as the input array.
"""

    parsed: Optional[dict] = None
    if _genai_model is not None:
        try:
            r = _genai_model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            parsed = _parse_json_from_model(getattr(r, "text", "") or "")
        except Exception:
            parsed = None
    if parsed is None and _vertex_model is not None:
        try:
            response = _vertex_model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            parsed = _parse_json_from_model(getattr(response, "text", "") or "")
        except Exception:
            parsed = None

    if not isinstance(parsed, dict):
        return [None] * n
    raw_list = parsed.get("urls")
    if not isinstance(raw_list, list):
        return [None] * n

    out: list[Optional[str]] = []
    for i in range(n):
        cell = raw_list[i] if i < len(raw_list) else None
        out.append(_normalize_grubhub_url(cell))
    return out


def _resolve_grubhub_urls(
    restaurants: list[Any], n: int, payload: dict[str, Any]
) -> list[Optional[str]]:
    top = payload.get("prototypeGrubhubUrls") or payload.get("prototype_grubhub_urls")
    top_list: list[str] = []
    if isinstance(top, list):
        top_list = [str(x).strip() for x in top if str(x).strip()]
    env_raw = os.getenv("GRUBHUB_PROTOTYPE_URLS", "").strip()
    env_list = [x.strip() for x in env_raw.split(",") if x.strip()]

    out: list[Optional[str]] = []
    for i in range(n):
        u: Optional[str] = None
        r = restaurants[i] if i < len(restaurants) else None
        if isinstance(r, dict):
            v = r.get("grubhub_url") or r.get("grubhubUrl")
            if isinstance(v, str) and v.strip():
                u = v.strip()
        if not u and i < len(top_list):
            u = top_list[i]
        if not u and i < len(env_list):
            u = env_list[i]
        out.append(u)
    return out


def _resolve_scrape_urls_with_gemini(
    restaurants: list[Any],
    n: int,
    payload: dict[str, Any],
    slim: list[dict[str, Any]],
) -> list[Optional[str]]:
    """Manual/env URLs first; then Gemini fills missing slots (when lookup enabled)."""
    urls = _resolve_grubhub_urls(restaurants, n, payload)
    disabled = os.getenv("DISABLE_GEMINI_GRUBHUB_URL_LOOKUP", "").lower() in (
        "1",
        "true",
        "yes",
    )
    if disabled:
        return urls
    guessed = _llm_grubhub_urls_batch(slim)
    for i in range(n):
        if urls[i] is None and i < len(guessed) and guessed[i]:
            urls[i] = guessed[i]
    return urls


def _options_summary_for_description(options: Any) -> str:
    if not options:
        return ""
    try:
        if isinstance(options, dict):
            bits: list[str] = []
            for k, v in list(options.items())[:5]:
                if isinstance(v, dict):
                    bits.append(
                        f"{k}: {', '.join(str(ik) for ik in list(v.keys())[:4])}"
                    )
                elif isinstance(v, list):
                    bits.append(f"{k}: {', '.join(str(x) for x in v[:4])}")
                else:
                    bits.append(f"{k}: {v}")
            return " · ".join(bits)[:200]
        return str(options)[:200]
    except Exception:
        return ""


def _full_menu_to_proposed_items(
    full_menu: dict[str, list[Any]], max_items: int = 5
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not full_menu or not isinstance(full_menu, dict):
        return out
    for category, entries in full_menu.items():
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if len(out) >= max_items:
                return out
            if not isinstance(entry, dict):
                continue
            name = str(entry.get("name") or "").strip()
            if not name:
                continue
            price = str(entry.get("price") or "").strip()
            opt = _options_summary_for_description(entry.get("options"))
            desc_bits = [b for b in [price, str(category), opt] if b]
            desc = " · ".join(desc_bits)[:280] or f"From the {category} section."
            tagparts = [
                t
                for t in str(category).lower().replace("&", " ").split()
                if len(t) > 2
            ][:3]
            tags = list(dict.fromkeys([*tagparts, "popular"]))[:8]
            out.append({"name": name[:120], "description": desc, "tags": tags})
    return out


_GRUBHUB_API_HEADERS = {
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.grubhub.com/",
    "Origin": "https://www.grubhub.com",
}


def _grubhub_search_restaurant_id(
    name: str,
    address: Optional[str],
    lat: Optional[float],
    lng: Optional[float],
) -> Optional[int]:
    """Search Grubhub's API for a restaurant by name + location; return numeric restaurant ID."""
    params: dict[str, Any] = {
        "orderMethod": "standard",
        "locationMode": "DELIVERY",
        "facetSet": "umamiV2",
        "pageSize": "5",
        "hideClosedRestaurantsMode": "semi",
        "queryText": name,
    }
    if lat is not None and lng is not None:
        params["latitude"] = str(lat)
        params["longitude"] = str(lng)
    elif address:
        params["location"] = address

    print(f"[grubhub-search] querying for '{name}' | address={address!r} lat={lat} lng={lng}", flush=True)
    print(f"[grubhub-search] params: {params}", flush=True)

    try:
        res = requests.get(
            "https://api-gtm.grubhub.com/restaurants/search",
            params=params,
            headers=_GRUBHUB_API_HEADERS,
            timeout=15,
        )
        print(f"[grubhub-search] HTTP {res.status_code} for '{name}'", flush=True)
        if not res.ok:
            print(f"[grubhub-search] non-OK response body (first 500): {res.text[:500]}", flush=True)
            return None
        data = res.json()
    except Exception as e:
        print(f"[grubhub-search] request exception for '{name}': {e}", flush=True)
        return None

    results = (
        (data.get("search_result") or {}).get("results") or []
    )
    print(f"[grubhub-search] got {len(results)} results for '{name}'", flush=True)

    # Pick the result whose name most closely matches
    name_lower = name.lower()
    best_id: Optional[int] = None
    best_score = -1
    for r in results:
        rest = r.get("restaurant") if isinstance(r, dict) else None
        if not isinstance(rest, dict):
            continue
        rid = rest.get("id")
        rname = str(rest.get("name") or "").lower()
        score = sum(1 for word in name_lower.split() if word in rname)
        print(f"[grubhub-search]   candidate id={rid} name={rname!r} score={score}", flush=True)
        if score > best_score:
            best_score = score
            best_id = rid

    print(f"[grubhub-search] best match for '{name}': id={best_id} score={best_score}", flush=True)
    return best_id if best_id is not None else None


def _grubhub_fetch_menu_by_id(
    restaurant_id: int,
) -> dict[str, list[dict[str, Any]]]:
    """Fetch full menu from Grubhub's restaurant detail API by restaurant ID."""
    print(f"[grubhub-menu] fetching menu for restaurant id={restaurant_id}", flush=True)
    try:
        res = requests.get(
            f"https://api-gtm.grubhub.com/restaurants/{restaurant_id}",
            params={"orderMethod": "standard", "locationMode": "DELIVERY"},
            headers=_GRUBHUB_API_HEADERS,
            timeout=15,
        )
        print(f"[grubhub-menu] HTTP {res.status_code} for id={restaurant_id}", flush=True)
        if not res.ok:
            print(f"[grubhub-menu] non-OK body (first 500): {res.text[:500]}", flush=True)
            return {}
        data = res.json()
    except Exception as e:
        print(f"[grubhub-menu] request exception for id={restaurant_id}: {e}", flush=True)
        return {}

    restaurant = data.get("restaurant")
    if not isinstance(restaurant, dict):
        print(f"[grubhub-menu] 'restaurant' key missing or not a dict. top-level keys: {list(data.keys())}", flush=True)
        return {}

    categories = restaurant.get("menu_category_list") or []
    print(f"[grubhub-menu] id={restaurant_id} has {len(categories)} menu categories", flush=True)
    full_menu: dict[str, list[dict[str, Any]]] = {}
    for cat in categories:
        if not isinstance(cat, dict):
            continue
        cat_name = str(cat.get("name") or "Menu").strip() or "Menu"
        items = cat.get("menu_item_list") or []
        parsed_items: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            item_name = str(item.get("name") or "").strip()
            if not item_name:
                continue
            raw_price = item.get("price")
            price_str = ""
            if isinstance(raw_price, (int, float)) and raw_price > 0:
                price_str = f"${raw_price / 100:.2f}"
            desc = str(item.get("description") or "").strip()
            parsed_items.append(
                {"name": item_name, "price": price_str, "description": desc, "options": {}}
            )
        print(f"[grubhub-menu]   category '{cat_name}': {len(parsed_items)} items", flush=True)
        if parsed_items:
            full_menu[cat_name] = parsed_items

    total_items = sum(len(v) for v in full_menu.values())
    print(f"[grubhub-menu] id={restaurant_id} total parsed items: {total_items} across {len(full_menu)} categories", flush=True)
    return full_menu


def _fetch_grubhub_menu_for_restaurant(
    name: str,
    address: Optional[str],
    lat: Optional[float],
    lng: Optional[float],
) -> dict[str, list[dict[str, Any]]]:
    """Search Grubhub for a restaurant by name+location, then return its full menu."""
    rid = _grubhub_search_restaurant_id(name, address, lat, lng)
    if rid is None:
        print(f"[grubhub] no restaurant ID found for '{name}' — skipping menu fetch", flush=True)
        return {}
    return _grubhub_fetch_menu_by_id(rid)


def _scrape_grubhub_menu_by_url(url: str) -> dict[str, list[dict[str, Any]]]:
    """Fallback: headless Chrome scrape when we have a known Grubhub menu URL."""
    from bs4 import BeautifulSoup
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options

    opts = Options()
    opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--window-size=1920,1080")

    browser = webdriver.Chrome(options=opts)
    full_menu: dict[str, list[dict[str, Any]]] = {}
    try:
        browser.get(url)
        time.sleep(10)
        html = BeautifulSoup(browser.page_source, "html.parser")
        menu = html.find(class_="menuSectionsContainer")
        if menu is None:
            return {}
        cats = menu.find_all("ghs-restaurant-menu-section")
        if len(cats) > 1:
            cats = cats[1:]
        if not cats:
            return {}

        for cat in cats:
            h3 = cat.find("h3", class_="menuSection-title")
            title = (h3.get_text(strip=True) if h3 else "") or "Menu"
            names = [
                a.get_text(strip=True)
                for a in cat.find_all("a", class_="menuItem-name")
            ]
            prices_list = [
                p.get_text(strip=True)
                for p in cat.find_all("span", class_="menuItem-displayPrice")
            ]
            all_items: list[dict[str, Any]] = []
            for j, itm_name in enumerate(names):
                price = prices_list[j] if j < len(prices_list) else ""
                all_items.append({"name": itm_name, "price": price, "options": {}})
            if all_items:
                full_menu[title] = all_items
        return full_menu
    finally:
        browser.quit()


@app.post("/menu-proposals")
async def menu_proposals(request: Request):
    try:
        payload = await request.json()
    except Exception:
        return {"menus": [], "source": "error"}
    if not isinstance(payload, dict):
        return {"menus": [], "source": "error"}
    restaurants = payload.get("restaurants")
    if not isinstance(restaurants, list):
        restaurants = []
    slim = _slim_for_menu_prompt(restaurants)
    if not slim:
        return {"menus": [], "source": "empty"}

    n = len(slim)
    scraped_by_index: list[Optional[list[dict[str, Any]]]] = [None] * n

    # Log the raw restaurant objects so we can verify which fields are present
    print(f"[menu-proposals] received {len(restaurants)} restaurants. First object keys: {list(restaurants[0].keys()) if restaurants else 'none'}", flush=True)
    if restaurants:
        first = restaurants[0]
        print(f"[menu-proposals] first restaurant sample: name={first.get('name')!r} vicinity={first.get('vicinity')!r} formatted_address={first.get('formatted_address')!r} lat={first.get('lat')} lng={first.get('lng')}", flush=True)

    scraper_env_raw = os.getenv("ENABLE_GRUBHUB_SCRAPER", "")
    scraper_on = scraper_env_raw.lower() in ("1", "true", "yes")
    print(f"[menu-proposals] ENABLE_GRUBHUB_SCRAPER={scraper_env_raw!r} -> scraper_on={scraper_on}", flush=True)
    print(f"[menu-proposals] processing {n} restaurants: {[s.get('name') for s in slim]}", flush=True)

    if scraper_on:
        # Resolve any manually-specified or env-var Grubhub URLs (used as fallback only)
        fallback_urls = _resolve_grubhub_urls(restaurants, n, payload)

        for i in range(n):
            s = slim[i] if i < len(slim) else {}
            r = restaurants[i] if i < len(restaurants) and isinstance(restaurants[i], dict) else {}
            name = s.get("name") or r.get("name") or ""
            address = s.get("vicinity") or s.get("formatted_address") or r.get("vicinity") or r.get("formatted_address") or ""
            lat = r.get("lat") or r.get("latitude")
            lng = r.get("lng") or r.get("longitude")
            try:
                lat = float(lat) if lat is not None else None
                lng = float(lng) if lng is not None else None
            except (TypeError, ValueError):
                lat = lng = None

            print(f"[menu-proposals] [{i}] '{name}' | address={address!r} | lat={lat} lng={lng} | fallback_url={fallback_urls[i]!r}", flush=True)

            fm: dict[str, list[dict[str, Any]]] = {}
            # Primary: API-based search + fetch (no Selenium needed)
            if name:
                try:
                    fm = await run_in_threadpool(
                        _fetch_grubhub_menu_for_restaurant, name, address or None, lat, lng
                    )
                except Exception as e:
                    print(f"[menu-proposals] [{i}] API fetch exception: {e}", flush=True)
                    fm = {}

            print(f"[menu-proposals] [{i}] API fetch returned {sum(len(v) for v in fm.values())} items across {len(fm)} categories", flush=True)

            # Fallback: Selenium scrape if we have a known URL and API returned nothing
            if not fm and fallback_urls[i]:
                print(f"[menu-proposals] [{i}] falling back to Selenium for url={fallback_urls[i]!r}", flush=True)
                try:
                    fm = await run_in_threadpool(_scrape_grubhub_menu_by_url, fallback_urls[i])
                except Exception as e:
                    print(f"[menu-proposals] [{i}] Selenium fallback exception: {e}", flush=True)
                    fm = {}

            if fm:
                items = _full_menu_to_proposed_items(fm, max_items=5)
                print(f"[menu-proposals] [{i}] converted to {len(items)} proposed items", flush=True)
                if len(items) >= 3:
                    scraped_by_index[i] = items
                else:
                    print(f"[menu-proposals] [{i}] only {len(items)} items (need >=3), discarding", flush=True)
            else:
                print(f"[menu-proposals] [{i}] no menu data from scraper, will use LLM fallback", flush=True)

    parsed = _llm_menu_json(slim)
    menus_raw = parsed.get("menus") if isinstance(parsed, dict) else None
    menus = _normalize_menu_matrix(menus_raw, slim)

    for i in range(n):
        if scraped_by_index[i]:
            menus[i] = scraped_by_index[i]

    any_scrape = any(x is not None for x in scraped_by_index)
    if any_scrape and parsed:
        src = "mixed"
    elif any_scrape:
        src = "grubhub"
    elif parsed:
        src = "gemini"
    else:
        src = "default"

    return {
        "menus": menus,
        "source": src,
    }