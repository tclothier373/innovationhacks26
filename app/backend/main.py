from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import requests
import json
import os
from pathlib import Path
from typing import Any, Optional

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


def _enrich_prompt(place: dict) -> str:
    return f"""
    Given this restaurant:

    Name: {place.get("name")}
    Types: {place.get("types")}
    Price level: {place.get("price_level", "unknown")}

    Infer:
    - cuisine
    - main food item
    - price range (cheap/moderate/expensive)

    Return ONLY JSON:
    {{
      "cuisine": "",
      "main_food": "",
      "price_range": ""
    }}
    """


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
    prompt = _enrich_prompt(place)
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
    return fallback_enrich(place)


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
    return {"status": "ok"}


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

    results: list[dict[str, Any]] = []

    for p in places[:8]:
        ai_data = enrich_restaurant(p)
        results.append(
            {
                "place_id": p.get("place_id"),
                "name": p.get("name"),
                "rating": p.get("rating"),
                "user_ratings_total": p.get("user_ratings_total"),
                "price_level": p.get("price_level"),
                "types": p.get("types"),
                "cuisine": ai_data.get("cuisine"),
                "main_food": ai_data.get("main_food"),
                "price_range": ai_data.get("price_range"),
            }
        )

    out: dict[str, Any] = {"data": results, "places_status": places_status}
    if not results and places_status == "ZERO_RESULTS":
        out["error"] = "No restaurants matched this search (ZERO_RESULTS)."
    return out


def _slim_for_menu_prompt(restaurants: list) -> list[dict[str, Any]]:
    slim: list[dict[str, Any]] = []
    for i, r in enumerate(restaurants[:8]):
        if not isinstance(r, dict):
            continue
        slim.append(
            {
                "index": i,
                "place_id": r.get("place_id") or "",
                "name": r.get("name") or "Restaurant",
                "cuisine": r.get("cuisine"),
                "main_food": r.get("main_food"),
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

    parsed = _llm_menu_json(slim)
    menus_raw = parsed.get("menus") if isinstance(parsed, dict) else None
    menus = _normalize_menu_matrix(menus_raw, slim)

    return {
        "menus": menus,
        "source": "gemini" if parsed else "default",
    }
