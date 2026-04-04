from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import json
import os
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
    _vertex_model = VertexModel("gemini-2.5-flash")
except Exception:
    _vertex_model = None

_genai_model = None
try:
    import google.generativeai as genai

    _gk = os.getenv("GEMINI_API_KEY", "").strip()
    if _gk:
        genai.configure(api_key=_gk)
        _genai_model = genai.GenerativeModel("gemini-2.5-flash")
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
                        "image_url": it.get("image_url") or None,
                        "price_cents": it.get("price_cents") or None,
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


# ---- Google Places Details + photo helpers ----


def _get_place_details(place_id: str, api_key: str) -> dict:
    """Fetch website URL and photo references from Places Details API."""
    print(f"[places-details] fetching details for {place_id}", flush=True)
    try:
        res = requests.get(
            "https://maps.googleapis.com/maps/api/place/details/json",
            params={"place_id": place_id, "fields": "name,website,photos", "key": api_key},
            timeout=10,
        )
        if res.ok:
            result = res.json().get("result") or {}
            website = result.get("website")
            photos = result.get("photos") or []
            print(f"[places-details] {place_id}: website={website!r} photos={len(photos)}", flush=True)
            return {"website": website, "photos": photos}
    except Exception as e:
        print(f"[places-details] exception: {e}", flush=True)
    return {"website": None, "photos": []}


def _resolve_photo_url(photo_reference: str, api_key: str) -> Optional[str]:
    """Follow the Places Photo redirect to get the real image URL (lh3.googleusercontent.com)."""
    try:
        res = requests.get(
            "https://maps.googleapis.com/maps/api/place/photo",
            params={"maxwidth": "600", "photo_reference": photo_reference, "key": api_key},
            timeout=10,
            allow_redirects=True,
        )
        if res.ok and "googleusercontent.com" in res.url:
            return res.url
        # Check redirect history
        for r in res.history:
            loc = r.headers.get("location", "")
            if "googleusercontent.com" in loc or "ggpht.com" in loc:
                return loc
    except Exception as e:
        print(f"[places-photo] exception: {e}", flush=True)
    return None


def _scrape_website_menu(url: str, restaurant_name: str = "", cuisine: str = "") -> list[dict[str, Any]]:
    """
    Scrape a restaurant website for menu items using Gemini as the primary extractor.
    Strategy:
      1. JSON-LD schema.org (fast, structured — return immediately if found)
      2. Collect text from homepage + menu sub-pages + PDFs → Gemini extraction
    Returns list of {name, description, image_url} dicts (>= 3 items or []).
    """
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin, urlparse, urlunparse

    _FETCH_HEADERS = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def _fetch_html(fetch_url: str) -> tuple[Optional[Any], str]:
        try:
            r = requests.get(fetch_url, headers=_FETCH_HEADERS, timeout=12, allow_redirects=True)
            if r.ok and "text/html" in r.headers.get("content-type", ""):
                return BeautifulSoup(r.text, "html.parser"), r.url
        except Exception as e:
            print(f"[website-scrape] fetch {fetch_url}: {e}", flush=True)
        return None, fetch_url

    def _jsonld_items(soup: Any) -> list[dict]:
        found: list[dict] = []
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                raw = script.string or ""
                if not raw.strip():
                    continue
                data = json.loads(raw)
                nodes = data if isinstance(data, list) else [data]
                flat: list[Any] = []
                for n in nodes:
                    if isinstance(n, dict) and "@graph" in n:
                        flat.extend(n["@graph"])
                    else:
                        flat.append(n)
                for node in flat:
                    if not isinstance(node, dict):
                        continue
                    typ = node.get("@type") or ""
                    if typ in ("Menu", "MenuSection", "FoodEstablishment", "Restaurant"):
                        sections = node.get("hasMenuSection") or [node]
                        if isinstance(sections, dict):
                            sections = [sections]
                        for section in sections:
                            if not isinstance(section, dict):
                                continue
                            menu_items = section.get("hasMenuItem") or []
                            if isinstance(menu_items, dict):
                                menu_items = [menu_items]
                            for item in menu_items:
                                if not isinstance(item, dict):
                                    continue
                                name = str(item.get("name") or "").strip()
                                if not name:
                                    continue
                                desc = str(item.get("description") or "").strip()
                                img_raw = item.get("image")
                                img = img_raw if isinstance(img_raw, str) else (
                                    img_raw.get("url") if isinstance(img_raw, dict) else None
                                )
                                found.append({"name": name, "description": desc, "image_url": img})
                    elif typ == "MenuItem":
                        name = str(node.get("name") or "").strip()
                        if name:
                            found.append({"name": name, "description": str(node.get("description") or "").strip(), "image_url": None})
            except Exception:
                continue
        return found

    def _collect_links(soup: Any, base_url: str) -> tuple[list[str], list[str]]:
        """Return (html_menu_links, pdf_menu_links) found on the page."""
        base_host = urlparse(base_url).netloc
        seen: set[str] = set()
        html_links: list[str] = []
        pdf_links: list[str] = []
        for a in soup.find_all("a", href=True):
            href = str(a["href"]).strip()
            if not href or href.startswith("#"):
                continue
            full = href if href.startswith("http") else urljoin(base_url, href)
            if urlparse(full).netloc not in ("", base_host):
                continue
            if full in seen:
                continue
            seen.add(full)
            link_text = (a.get_text(strip=True) or "").lower()
            path_lower = full.lower()
            is_menu_related = (
                "menu" in link_text or "food" in link_text or "dining" in link_text
                or "/menu" in path_lower or "/food" in path_lower or "/dining" in path_lower
                or "order" in link_text
            )
            if not is_menu_related:
                continue
            if path_lower.endswith(".pdf"):
                pdf_links.append(full)
            elif full != base_url:
                html_links.append(full)
        return html_links[:5], pdf_links[:3]

    print(f"[website-scrape] starting {url}", flush=True)

    # --- Step 1: homepage ---
    soup, final_url = _fetch_html(url)
    if soup is None:
        print(f"[website-scrape] homepage fetch failed for {url}", flush=True)
        return []

    # Fast path: JSON-LD
    ld_items = _jsonld_items(soup)
    if len(ld_items) >= 3:
        print(f"[website-scrape] {len(ld_items)} items via JSON-LD (homepage)", flush=True)
        return ld_items[:8]

    # Collect homepage text
    text_blocks: list[str] = [_extract_clean_text(soup)]

    # Find menu links and PDFs from homepage
    html_links, pdf_links = _collect_links(soup, final_url)

    # Also probe common URL suffixes
    parsed_base = urlparse(final_url)
    origin = urlunparse((parsed_base.scheme, parsed_base.netloc, "", "", "", ""))
    for suffix in ["/menu", "/menus", "/our-menu", "/food-menu", "/dining", "/food", "/order"]:
        candidate = origin + suffix
        if candidate != final_url and candidate not in html_links:
            html_links.append(candidate)

    # --- Step 2: follow HTML menu pages ---
    for menu_url in html_links[:6]:
        print(f"[website-scrape] fetching menu page {menu_url}", flush=True)
        msoup, _ = _fetch_html(menu_url)
        if msoup is None:
            continue
        ld = _jsonld_items(msoup)
        if len(ld) >= 3:
            print(f"[website-scrape] {len(ld)} items via JSON-LD ({menu_url})", flush=True)
            return ld[:8]
        text_blocks.append(_extract_clean_text(msoup))
        # Also pick up any PDFs linked from this page
        _, more_pdfs = _collect_links(msoup, menu_url)
        for p in more_pdfs:
            if p not in pdf_links:
                pdf_links.append(p)

    # --- Step 3: extract PDF text ---
    for pdf_url in pdf_links[:3]:
        print(f"[website-scrape] extracting PDF {pdf_url}", flush=True)
        pdf_text = _extract_pdf_text(pdf_url, _FETCH_HEADERS)
        if pdf_text.strip():
            text_blocks.append(pdf_text)

    # --- Step 4: Gemini extraction from all collected text ---
    print(f"[website-scrape] sending {len(text_blocks)} text blocks to Gemini for {restaurant_name or url}", flush=True)
    items = _gemini_extract_menu_from_text(text_blocks, restaurant_name or url, cuisine)
    print(f"[website-scrape] Gemini returned {len(items)} items for {restaurant_name or url}", flush=True)
    return items


def _extract_clean_text(soup: Any) -> str:
    """Strip a BeautifulSoup tree down to readable lines of text."""
    for tag in soup.find_all(["script", "style", "noscript", "iframe", "meta", "link", "head"]):
        tag.decompose()
    text = soup.get_text(separator="\n", strip=True)
    lines = [l.strip() for l in text.splitlines() if len(l.strip()) > 1]
    return "\n".join(lines[:500])


def _extract_pdf_text(url: str, headers: dict) -> str:
    """Download a PDF and extract its text, capped at 10 pages."""
    try:
        import pypdf
        from io import BytesIO

        r = requests.get(url, headers=headers, timeout=20)
        if not r.ok:
            return ""
        reader = pypdf.PdfReader(BytesIO(r.content))
        parts: list[str] = []
        for page in reader.pages[:10]:
            t = page.extract_text() or ""
            if t.strip():
                parts.append(t)
        text = "\n".join(parts)
        print(f"[pdf-extract] {url} → {len(text)} chars", flush=True)
        return text[:8000]
    except Exception as e:
        print(f"[pdf-extract] {url}: {e}", flush=True)
        return ""


def _call_gemini(prompt: str, max_retries: int = 3) -> Optional[dict]:
    """Call genai then vertex, return first successfully parsed JSON dict.
    Retries on 429 rate-limit errors using the suggested delay from the error."""
    import time
    import re as _re

    for model in [_genai_model, _vertex_model]:
        if model is None:
            continue
        for attempt in range(max_retries):
            try:
                r = model.generate_content(
                    prompt,
                    generation_config={"response_mime_type": "application/json"},
                )
                return _parse_json_from_model(getattr(r, "text", "") or "")
            except Exception as e:
                msg = str(e)
                if "429" in msg:
                    # Extract suggested retry delay from error message
                    m = _re.search(r"seconds[\":\s]+(\d+)", msg)
                    delay = min(int(m.group(1)) + 2 if m else 20, 60)
                    print(f"[gemini] rate limited (attempt {attempt+1}), retrying in {delay}s", flush=True)
                    time.sleep(delay)
                    continue
                print(f"[gemini] error: {e}", flush=True)
                break  # non-429 error — try next model
    return None


def _gemini_extract_menu_from_text(
    text_blocks: list[str], restaurant_name: str, cuisine: str
) -> list[dict[str, Any]]:
    """
    Pass scraped page text to Gemini and get back specific, orderable menu items with prices.
    Returns [] if fewer than 3 specific items found.
    """
    if not text_blocks or (_genai_model is None and _vertex_model is None):
        return []

    combined = "\n\n--- PAGE BREAK ---\n\n".join(b for b in text_blocks if b.strip())
    combined = combined[:12000]

    prompt = f"""You are a menu data extractor for a food ordering app. Extract individual food and drink items from the text below, scraped from "{restaurant_name}" ({cuisine} restaurant).

TEXT:
{combined}

STRICT RULES — you MUST follow these exactly:
1. ONLY include items with a SPECIFIC, UNIQUE name — something a customer would say to order (e.g. "Spicy Tuna Roll", "BBQ Brisket Plate", "House Margarita", "Chicken Tikka Masala").
2. REJECT anything that is a generic category or section header:
   - BAD: "House Wines", "Draft Beers", "Seasonal Vegetables", "Selection of Cheeses", "Chef's Selection", "Market Fish", "Soup of the Day", "Desserts", "Starters", "Mains"
   - GOOD: "Cabernet Sauvignon", "Guinness Stout", "Roasted Broccolini", "Aged Gouda Board", "Pan-Seared Halibut"
3. If you see a price in the text near the item (e.g. "$18", "18.00"), include it as price_cents (integer cents, e.g. 1800). If no price is visible, use null.
4. Skip: nav links, hours, addresses, phone, "Reserve Now", "Order Online", "About Us", marketing taglines.
5. Return 3–8 items. If you cannot find 3 genuinely specific items, return an empty array.

Return ONLY valid JSON:
{{
  "items": [
    {{"name": "specific dish name", "description": "one-line description or empty string", "price_cents": 1500}}
  ]
}}"""

    parsed = _call_gemini(prompt)

    if not isinstance(parsed, dict):
        print("[gemini-extract] failed or no LLM", flush=True)
        return []

    items = parsed.get("items")
    if not isinstance(items, list) or len(items) < 3:
        return []

    result: list[dict[str, Any]] = []
    for item in items[:8]:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name or len(name) < 3:
            continue
        price_raw = item.get("price_cents")
        price_cents: Optional[int] = int(price_raw) if isinstance(price_raw, (int, float)) and price_raw > 0 else None
        result.append({
            "name": name[:120],
            "description": str(item.get("description") or "").strip()[:280],
            "image_url": None,
            "price_cents": price_cents,
        })
    return result


def _gemini_batch_delivery_menus(
    restaurants: list[dict[str, Any]],
) -> list[list[dict[str, Any]]]:
    """
    ONE Gemini call for N restaurants. Returns index-aligned list of item arrays.
    Each restaurant either gets 3–6 specific delivery menu items or an empty list.
    """
    if not restaurants or (_genai_model is None and _vertex_model is None):
        return [[] for _ in restaurants]

    rows = [
        {"index": i, "name": r.get("name"), "cuisine": r.get("cuisine"), "vicinity": r.get("vicinity")}
        for i, r in enumerate(restaurants)
    ]

    prompt = f"""You are a food delivery assistant with training knowledge of restaurant menus.

For each restaurant below, determine if it is available on Grubhub, DoorDash, or Uber Eats, and if so provide 3–5 of its most popular, specific, orderable menu items with approximate prices.

Restaurants:
{json.dumps(rows, ensure_ascii=False)}

STRICT RULES:
- Items must be SPECIFIC named dishes a customer would order (e.g. "Tonkotsu Ramen", "Spicy Chicken Sandwich", "Margherita Pizza").
- REJECT generic terms: "House Wines", "Draft Beers", "Chef's Selection", "Daily Special", "Seasonal Vegetables", "Soup of the Day", "Market Fish".
- price_cents = integer cents (e.g. $15.00 → 1500). Use null if unknown.
- If a restaurant is NOT on a delivery app, return an empty items array for it.

Return ONLY valid JSON:
{{
  "results": [
    {{
      "index": 0,
      "on_delivery_app": true,
      "items": [
        {{"name": "specific dish", "description": "one-line description", "price_cents": 1500}}
      ]
    }}
  ]
}}
The "results" array must have exactly {len(restaurants)} entries in the same order as the input."""

    parsed = _call_gemini(prompt)
    output: list[list[dict[str, Any]]] = [[] for _ in restaurants]

    if not isinstance(parsed, dict):
        return output

    results = parsed.get("results")
    if not isinstance(results, list):
        return output

    for entry in results:
        if not isinstance(entry, dict):
            continue
        idx = entry.get("index")
        if not isinstance(idx, int) or idx < 0 or idx >= len(restaurants):
            continue
        if not entry.get("on_delivery_app"):
            continue
        items = entry.get("items") or []
        if not isinstance(items, list) or len(items) < 3:
            continue
        cleaned: list[dict[str, Any]] = []
        for item in items[:6]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            if not name or len(name) < 3:
                continue
            price_raw = item.get("price_cents")
            price_cents: Optional[int] = int(price_raw) if isinstance(price_raw, (int, float)) and price_raw > 0 else None
            cleaned.append({
                "name": name[:120],
                "description": str(item.get("description") or "").strip()[:280],
                "image_url": None,
                "price_cents": price_cents,
            })
        if len(cleaned) >= 3:
            output[idx] = cleaned
            print(f"[gemini-delivery-batch] '{restaurants[idx].get('name')}' — {len(cleaned)} items", flush=True)

    return output


@app.post("/discover")
async def discover(request: Request):
    """
    Combined endpoint: fetch Places candidates, scrape + Gemini-validate menus,
    skip restaurants with < 3 real items, return first N with valid menus.
    Response shape: {data: [...restaurant rows...], menus: [...item arrays...], source: str}
    """
    try:
        payload = await request.json()
    except Exception:
        return {"data": [], "menus": [], "source": "error"}

    if not PLACES_API_KEY:
        return {"data": [], "menus": [], "source": "error", "error": "No API key configured"}

    query = str(payload.get("query") or "restaurants")
    lat = payload.get("lat")
    lng = payload.get("lng")
    radius_meters = int(payload.get("radius_meters") or 8000)

    # Fetch up to 15 candidates so we can cycle past ones with no menu
    if lat is not None and lng is not None:
        places, status, err = get_restaurants_nearby(
            float(lat), float(lng), radius_meters, query, PLACES_API_KEY
        )
    else:
        places, status, err = get_restaurants_text_search(query, PLACES_API_KEY)

    if err:
        return {"data": [], "menus": [], "source": "error", "error": err, "places_status": status}

    WANT = _demo_max_restaurants()
    MAX_CANDIDATES = min(len(places), 8)  # cap to keep Gemini call count low
    candidates = places[:MAX_CANDIDATES]

    # Batch-enrich all candidates in one LLM call
    enrichments = enrich_restaurants_batch(candidates)

    # Intermediate state per candidate
    # Each entry: {place, enrich, details, scraped_items}
    candidate_state: list[dict[str, Any]] = []

    # --- Pass 1: fetch details + scrape websites (1 Gemini call per candidate with content) ---
    for i, (place, enrich) in enumerate(zip(candidates, enrichments)):
        place_id = (place.get("place_id") or "").strip()
        name = (place.get("name") or f"Restaurant {i + 1}").strip()
        if not place_id:
            continue

        details = await run_in_threadpool(_get_place_details, place_id, PLACES_API_KEY)
        website: Optional[str] = details.get("website")
        photo_refs: list[str] = [
            p.get("photo_reference", "")
            for p in (details.get("photos") or [])
            if p.get("photo_reference")
        ][:3]

        cuisine_hint = enrich.get("cuisine", "")
        scraped: list[dict[str, Any]] = []
        if website:
            scraped = await run_in_threadpool(_scrape_website_menu, website, name, cuisine_hint)
            print(f"[discover] [{i}] '{name}' — {len(scraped)} items from website", flush=True)
        else:
            print(f"[discover] [{i}] '{name}' — no website", flush=True)

        candidate_state.append({
            "i": i, "place": place, "enrich": enrich,
            "name": name, "photo_refs": photo_refs, "scraped": scraped,
        })

    # --- Pass 2: one batch Gemini delivery call for all candidates that need it ---
    need_fallback = [s for s in candidate_state if len(s["scraped"]) < 3]
    fallback_menus: list[list[dict[str, Any]]] = []
    if need_fallback:
        batch_input = [
            {
                "name": s["name"],
                "cuisine": s["enrich"].get("cuisine", ""),
                "vicinity": s["place"].get("vicinity") or s["place"].get("formatted_address") or "",
            }
            for s in need_fallback
        ]
        print(f"[discover] batch delivery lookup for {len(batch_input)} restaurants", flush=True)
        fallback_menus = await run_in_threadpool(_gemini_batch_delivery_menus, batch_input)

    fallback_iter = iter(fallback_menus)

    # --- Pass 3: accept restaurants with enough items ---
    accepted_rows: list[dict[str, Any]] = []
    accepted_menus: list[list[dict[str, Any]]] = []

    for s in candidate_state:
        if len(accepted_rows) >= WANT:
            break

        valid_items = s["scraped"]
        if len(valid_items) < 3:
            valid_items = next(fallback_iter, [])

        if len(valid_items) < 3:
            print(f"[discover] '{s['name']}' — not enough items, skipping", flush=True)
            continue

        # Resolve photos
        photo_urls: list[str] = []
        for ref in s["photo_refs"]:
            photo_url = await run_in_threadpool(_resolve_photo_url, ref, PLACES_API_KEY)
            if photo_url:
                photo_urls.append(photo_url)

        menu: list[dict[str, Any]] = []
        for j, item in enumerate(valid_items[:5]):
            menu.append({
                "name": item["name"],
                "description": item.get("description") or "Popular pick.",
                "tags": [],
                "image_url": item.get("image_url") or (photo_urls[j % len(photo_urls)] if photo_urls else None),
                "price_cents": item.get("price_cents"),
            })

        place = s["place"]
        enrich = s["enrich"]
        geo = (place.get("geometry") or {}).get("location") or {}
        row: dict[str, Any] = {
            "place_id": (place.get("place_id") or "").strip(),
            "name": s["name"],
            "rating": place.get("rating"),
            "user_ratings_total": place.get("user_ratings_total"),
            "price_level": place.get("price_level"),
            "types": place.get("types"),
            "vicinity": place.get("vicinity"),
            "formatted_address": place.get("formatted_address"),
            "lat": geo.get("lat"),
            "lng": geo.get("lng"),
            "cuisine": enrich.get("cuisine"),
            "main_food": enrich.get("main_food"),
            "price_range": enrich.get("price_range"),
        }

        accepted_rows.append(row)
        accepted_menus.append(menu)
        print(f"[discover] '{s['name']}' — ACCEPTED ({len(accepted_rows)}/{WANT})", flush=True)

    print(f"[discover] done — accepted {len(accepted_rows)} restaurants", flush=True)
    return {
        "data": accepted_rows,
        "menus": accepted_menus,
        "source": "website" if accepted_rows else "empty",
        "places_status": status,
    }


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

    if not PLACES_API_KEY:
        print("[menu-proposals] no PLACES_API_KEY, skipping website scrape", flush=True)
    else:
        for i in range(n):
            r = restaurants[i] if i < len(restaurants) and isinstance(restaurants[i], dict) else {}
            place_id = r.get("place_id") or ""
            name = (slim[i].get("name") or r.get("name") or "")

            if not place_id:
                print(f"[menu-proposals] [{i}] '{name}' — no place_id, skipping", flush=True)
                continue

            # 1. Fetch website + photo references from Places Details
            details = await run_in_threadpool(_get_place_details, place_id, PLACES_API_KEY)
            website: Optional[str] = details.get("website")
            photo_refs: list[str] = [
                p.get("photo_reference", "")
                for p in (details.get("photos") or [])
                if p.get("photo_reference")
            ][:5]

            print(f"[menu-proposals] [{i}] '{name}' website={website!r} photos={len(photo_refs)}", flush=True)

            # 2. Resolve photo references → real image URLs (parallel)
            photo_urls: list[Optional[str]] = []
            for ref in photo_refs:
                url = await run_in_threadpool(_resolve_photo_url, ref, PLACES_API_KEY)
                photo_urls.append(url)
            photo_urls_clean = [u for u in photo_urls if u]
            print(f"[menu-proposals] [{i}] resolved {len(photo_urls_clean)} photo URLs", flush=True)

            # 3. Scrape website for real menu items
            website_items: list[dict[str, Any]] = []
            if website:
                r_name = slim[i].get("name") or ""
                r_cuisine = slim[i].get("cuisine") or ""
                website_items = await run_in_threadpool(_scrape_website_menu, website, r_name, r_cuisine)
                print(f"[menu-proposals] [{i}] website scrape returned {len(website_items)} items", flush=True)

            # 4. Build proposed items — website items if found, else photo-backed placeholders
            proposed: list[dict[str, Any]] = []
            if len(website_items) >= 3:
                for j, item in enumerate(website_items[:5]):
                    proposed.append({
                        "name": item["name"],
                        "description": item.get("description") or "Popular pick.",
                        "tags": [],
                        "image_url": item.get("image_url") or (photo_urls_clean[j % len(photo_urls_clean)] if photo_urls_clean else None),
                    })
            elif photo_urls_clean:
                # No structured menu — use photos with LLM-generated names (filled in later)
                # Signal by leaving proposed empty so LLM runs, but attach photos after
                pass

            if len(proposed) >= 3:
                scraped_by_index[i] = proposed
            elif photo_urls_clean:
                # Store photos on the slim entry so the LLM normalizer can attach them
                slim[i]["_photo_urls"] = photo_urls_clean

    # LLM menu generation (always runs; scraped results override per-slot below)
    parsed = _llm_menu_json(slim)
    menus_raw = parsed.get("menus") if isinstance(parsed, dict) else None
    menus = _normalize_menu_matrix(menus_raw, slim)

    # Attach photos to LLM items for restaurants where we got photos but no website menu
    for i in range(n):
        photos = slim[i].get("_photo_urls") or []
        if photos and not scraped_by_index[i]:
            for j, item in enumerate(menus[i]):
                item["image_url"] = photos[j % len(photos)]

    # Override with real website-scraped items where available
    for i in range(n):
        if scraped_by_index[i]:
            menus[i] = scraped_by_index[i]

    any_scraped = any(x is not None for x in scraped_by_index)
    source = "website" if any_scraped else ("gemini" if parsed else "default")

    return {"menus": menus, "source": source}