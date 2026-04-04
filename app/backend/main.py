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
                        "image_url": it.get("image_url") or None,
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


def _scrape_website_menu(url: str) -> list[dict[str, Any]]:
    """
    Scrape a restaurant website for menu items.
    Strategy order: JSON-LD schema → HTML heuristics (CSS classes, headings+prices).
    Returns list of {name, description, image_url} dicts.
    """
    import re as _re
    from bs4 import BeautifulSoup
    from urllib.parse import urljoin

    _PRICE_RE = _re.compile(r"\$\s*\d+")
    _SKIP_WORDS = {"menu", "home", "about", "contact", "reservation", "reservations",
                   "hours", "location", "directions", "gift", "careers", "press"}
    _SKIP_CONTAINERS = {"nav", "header", "footer", "sidebar", "widget", "breadcrumb", "social"}

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }

    def _fetch(fetch_url: str) -> tuple[Optional[Any], str]:
        try:
            r = requests.get(fetch_url, headers=headers, timeout=12, allow_redirects=True)
            if r.ok:
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
                            desc = str(node.get("description") or "").strip()
                            found.append({"name": name, "description": desc, "image_url": None})
            except Exception:
                continue
        return found

    def _html_items(soup: Any) -> list[dict]:
        """Heuristic HTML extraction: CSS class patterns then heading+price scan."""
        # Pattern 1: common menu-item CSS classes
        class_patterns = [
            "menu-item", "menu_item", "menuitem", "food-item", "food_item",
            "dish", "menu-list-item", "menu-entry", "food-menu-item",
            "menu-product", "menu-content-item", "wprmenu_item",
        ]
        for pat in class_patterns:
            els = soup.find_all(class_=_re.compile(pat, _re.I))
            if len(els) >= 3:
                results: list[dict] = []
                for el in els[:10]:
                    name_el = el.find(["h2", "h3", "h4", "h5", "strong", "b"]) or el
                    name = name_el.get_text(strip=True)[:100]
                    if not name or len(name) < 3:
                        continue
                    desc_el = el.find("p")
                    desc = desc_el.get_text(strip=True)[:200] if desc_el else ""
                    img_el = el.find("img")
                    img = img_el.get("src") if img_el else None
                    results.append({"name": name, "description": desc, "image_url": img})
                if len(results) >= 3:
                    print(f"[website-scrape] CSS class '{pat}' → {len(results)} items", flush=True)
                    return results[:8]

        # Pattern 2: headings inside price-bearing containers
        for container in soup.find_all(["section", "article", "div", "ul"], limit=200):
            cls_id = " ".join(container.get("class") or []) + " " + (container.get("id") or "")
            cls_id = cls_id.lower()
            if any(s in cls_id for s in _SKIP_CONTAINERS):
                continue
            if not _PRICE_RE.search(container.get_text()):
                continue
            headings = container.find_all(["h3", "h4", "h5", "strong"])
            if len(headings) < 3:
                continue
            batch: list[dict] = []
            for h in headings[:12]:
                name = h.get_text(strip=True)[:100]
                if not name or len(name) < 3 or len(name) > 80:
                    continue
                # Filter navigation-like text
                if name.lower() in _SKIP_WORDS or name.lower().startswith(("$", "©")):
                    continue
                desc = ""
                nxt = h.find_next_sibling(["p", "span", "div"])
                if nxt:
                    d = nxt.get_text(strip=True)[:200]
                    if 4 < len(d) < 300:
                        desc = d
                img_el = h.find("img") or (nxt.find("img") if nxt else None)
                img = img_el.get("src") if img_el else None
                batch.append({"name": name, "description": desc, "image_url": img})
            if len(batch) >= 3:
                print(f"[website-scrape] heading+price heuristic → {len(batch)} items", flush=True)
                return batch[:8]

        return []

    def _menu_links(soup: Any, base_url: str) -> list[str]:
        """Find candidate menu page URLs on the page, skipping PDFs and external sites."""
        from urllib.parse import urlparse
        base_host = urlparse(base_url).netloc
        seen: set[str] = set()
        links: list[str] = []
        for a in soup.find_all("a", href=True):
            href = str(a["href"]).strip()
            if not href or href.startswith("#"):
                continue
            full = href if href.startswith("http") else urljoin(base_url, href)
            # Skip PDFs
            if full.lower().endswith(".pdf"):
                continue
            # Skip external domains
            if urlparse(full).netloc not in ("", base_host):
                continue
            text = (a.get_text(strip=True) or "").lower()
            path = full.lower()
            if "menu" in text or "/menu" in path:
                if full not in seen and full != base_url:
                    seen.add(full)
                    links.append(full)
        return links[:4]

    print(f"[website-scrape] fetching {url}", flush=True)
    soup, final_url = _fetch(url)
    if soup is None:
        return []

    # 1. Try JSON-LD on homepage
    items = _jsonld_items(soup)
    if len(items) >= 3:
        print(f"[website-scrape] {len(items)} items via JSON-LD (homepage)", flush=True)
        return items[:8]

    # 2. Try HTML heuristics on homepage
    items = _html_items(soup)
    if len(items) >= 3:
        print(f"[website-scrape] {len(items)} items via HTML heuristics (homepage)", flush=True)
        return items[:8]

    # 3. Follow menu links and try both strategies on each
    for menu_url in _menu_links(soup, final_url):
        print(f"[website-scrape] trying menu page: {menu_url}", flush=True)
        msoup, _ = _fetch(menu_url)
        if msoup is None:
            continue
        items = _jsonld_items(msoup)
        if len(items) >= 3:
            print(f"[website-scrape] {len(items)} items via JSON-LD ({menu_url})", flush=True)
            return items[:8]
        items = _html_items(msoup)
        if len(items) >= 3:
            print(f"[website-scrape] {len(items)} items via HTML heuristics ({menu_url})", flush=True)
            return items[:8]

    # 4. Also try common menu URL suffixes if not found yet
    from urllib.parse import urlparse, urlunparse
    parsed = urlparse(final_url)
    base = urlunparse((parsed.scheme, parsed.netloc, "", "", "", ""))
    for suffix in ["/menu", "/menus", "/our-menu", "/food-menu", "/dining"]:
        candidate = base + suffix
        if candidate == final_url:
            continue
        print(f"[website-scrape] trying common path: {candidate}", flush=True)
        msoup, _ = _fetch(candidate)
        if msoup is None:
            continue
        items = _jsonld_items(msoup) or _html_items(msoup)
        if len(items) >= 3:
            print(f"[website-scrape] {len(items)} items at {candidate}", flush=True)
            return items[:8]

    print(f"[website-scrape] no menu items found for {url}", flush=True)
    return []


def _gemini_validate_menu_items(
    raw_items: list[dict[str, Any]], restaurant: dict[str, Any]
) -> list[dict[str, Any]]:
    """
    Ask Gemini to filter scraped items down to actual food/drink menu items only.
    Returns validated items, or empty list if fewer than 3 valid items found.
    """
    if not raw_items:
        return []

    restaurant_name = restaurant.get("name") or "this restaurant"
    cuisine = restaurant.get("cuisine") or "restaurant"

    items_payload = [
        {"index": i, "name": it.get("name", ""), "description": it.get("description", "")}
        for i, it in enumerate(raw_items)
    ]

    prompt = f"""You are reviewing text scraped from the website of "{restaurant_name}", a {cuisine} restaurant.

Below are items extracted from their website. Identify which are ACTUAL food or drink menu items a customer could order.

REJECT anything that is:
- Navigation or UI text ("Home", "About", "Contact", "Reserve Now", "Book a Table", "Order Online")
- Operating info ("Our Hours", "Open Daily", "Location", "Directions", "Parking", "Find Us")
- Non-food content ("Gift Cards", "Catering", "Events", "Press", "Careers", "Private Dining")
- Generic section headers without a specific dish name ("Appetizers", "Drinks", "Desserts")
- Marketing copy or slogans

ACCEPT only items with a SPECIFIC food or drink name that a customer could order (e.g. "Spicy Tuna Roll", "Chicken Tikka Masala", "House Margarita").

Items to evaluate:
{json.dumps(items_payload, ensure_ascii=False)}

Return ONLY valid JSON:
{{
  "valid": [
    {{"index": 0, "name": "corrected dish name", "description": "description or empty string"}}
  ]
}}
Include at most 5 items. If fewer than 3 are genuine menu items, return {{"valid": []}}.
"""

    parsed: Optional[dict] = None
    for model in [_genai_model, _vertex_model]:
        if model is None:
            continue
        try:
            r = model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json"},
            )
            parsed = _parse_json_from_model(getattr(r, "text", "") or "")
            break
        except Exception as e:
            print(f"[gemini-validate] error: {e}", flush=True)

    if not isinstance(parsed, dict):
        print("[gemini-validate] no LLM available, returning empty", flush=True)
        return []

    valid = parsed.get("valid")
    if not isinstance(valid, list) or len(valid) < 3:
        return []

    result: list[dict[str, Any]] = []
    for entry in valid[:5]:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        if not name:
            continue
        orig_idx = entry.get("index")
        original = raw_items[orig_idx] if isinstance(orig_idx, int) and 0 <= orig_idx < len(raw_items) else {}
        result.append({
            "name": name[:120],
            "description": (str(entry.get("description") or "").strip() or original.get("description", ""))[:280],
            "image_url": original.get("image_url"),
        })

    return result


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
    MAX_CANDIDATES = min(len(places), 15)
    candidates = places[:MAX_CANDIDATES]

    # Batch-enrich all candidates in one LLM call
    enrichments = enrich_restaurants_batch(candidates)

    accepted_rows: list[dict[str, Any]] = []
    accepted_menus: list[list[dict[str, Any]]] = []

    for i, (place, enrich) in enumerate(zip(candidates, enrichments)):
        if len(accepted_rows) >= WANT:
            break

        place_id = (place.get("place_id") or "").strip()
        name = (place.get("name") or f"Restaurant {i + 1}").strip()

        if not place_id:
            print(f"[discover] [{i}] '{name}' — no place_id, skipping", flush=True)
            continue

        # Fetch website URL + photo references
        details = await run_in_threadpool(_get_place_details, place_id, PLACES_API_KEY)
        website: Optional[str] = details.get("website")
        photo_refs: list[str] = [
            p.get("photo_reference", "")
            for p in (details.get("photos") or [])
            if p.get("photo_reference")
        ][:3]

        if not website:
            print(f"[discover] [{i}] '{name}' — no website, skipping", flush=True)
            continue

        # Scrape raw items from their website
        raw_items = await run_in_threadpool(_scrape_website_menu, website)
        print(f"[discover] [{i}] '{name}' — scraped {len(raw_items)} raw items", flush=True)

        if not raw_items:
            print(f"[discover] [{i}] '{name}' — 0 scraped items, skipping", flush=True)
            continue

        # Validate with Gemini — filter out nav/UI junk
        restaurant_ctx = {"name": name, "cuisine": enrich.get("cuisine", "")}
        valid_items = await run_in_threadpool(_gemini_validate_menu_items, raw_items, restaurant_ctx)
        print(f"[discover] [{i}] '{name}' — {len(valid_items)} valid items after Gemini filter", flush=True)

        if len(valid_items) < 3:
            print(f"[discover] [{i}] '{name}' — not enough valid items, skipping", flush=True)
            continue

        # Resolve photo URLs
        photo_urls: list[str] = []
        for ref in photo_refs:
            url = await run_in_threadpool(_resolve_photo_url, ref, PLACES_API_KEY)
            if url:
                photo_urls.append(url)

        # Build menu with image assignment
        menu: list[dict[str, Any]] = []
        for j, item in enumerate(valid_items[:5]):
            menu.append({
                "name": item["name"],
                "description": item.get("description") or "Popular pick.",
                "tags": [],
                "image_url": item.get("image_url") or (photo_urls[j % len(photo_urls)] if photo_urls else None),
            })

        # Build restaurant row (same shape as /restaurants)
        geo = (place.get("geometry") or {}).get("location") or {}
        row: dict[str, Any] = {
            "place_id": place_id,
            "name": name,
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
        print(f"[discover] [{i}] '{name}' — ACCEPTED ({len(accepted_rows)}/{WANT})", flush=True)

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
                website_items = await run_in_threadpool(_scrape_website_menu, website)
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