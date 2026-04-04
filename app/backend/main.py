from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import requests
import json
import vertexai
from vertexai.generative_models import GenerativeModel
import os
from typing import Any, Optional

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Google Places (Maps) key — not the same as Gemini; fallback keeps local dev working if only one key is set.
PLACES_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY") or os.getenv("GEMINI_API_KEY", "")

vertexai.init(project="innovationhacks26", location="us-central1")
model = GenerativeModel("gemini-1.5-flash")


def get_restaurants_text_search(query: str, api_key: str) -> list:
    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"
    params = {"query": query, "key": api_key}
    res = requests.get(url, params=params, timeout=20)
    return res.json().get("results", [])


def get_restaurants_nearby(
    lat: float, lng: float, radius_meters: int, keyword: str, api_key: str
) -> list:
    url = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
    params = {
        "location": f"{lat},{lng}",
        "radius": min(max(radius_meters, 500), 50000),
        "type": "restaurant",
        "keyword": (keyword or "food")[:200],
        "key": api_key,
    }
    res = requests.get(url, params=params, timeout=20)
    return res.json().get("results", [])


def enrich_restaurant(place: dict) -> dict:
    prompt = f"""
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

    response = model.generate_content(
        prompt,
        generation_config={
            "response_mime_type": "application/json"
        },
    )

    return json.loads(response.text)


@app.get("/restaurants")
def get_restaurant_data(
    query: str = "restaurants",
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    radius_meters: Optional[int] = None,
):
    if not PLACES_API_KEY:
        return {"data": [], "error": "Missing GOOGLE_MAPS_API_KEY (or GEMINI_API_KEY fallback)"}

    if lat is not None and lng is not None:
        r = radius_meters if radius_meters is not None else 8000
        places = get_restaurants_nearby(float(lat), float(lng), int(r), query, PLACES_API_KEY)
    else:
        places = get_restaurants_text_search(query, PLACES_API_KEY)

    results: list[dict[str, Any]] = []

    for p in places[:8]:
        try:
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
        except Exception:
            continue

    return {"data": results}
