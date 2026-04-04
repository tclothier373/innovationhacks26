from fastapi import FastAPI
import requests
import json
import vertexai
from vertexai.generative_models import GenerativeModel
import os

app = FastAPI()

# --- CONFIG ---
PLACES_API_KEY = os.getenv("GEMINI_API_KEY")

vertexai.init(project="innovationhacks26", location="us-central1")
model = GenerativeModel("gemini-1.5-flash")


# --- STEP 1: GET RESTAURANTS ---
def get_restaurants(query: str):
    url = "https://maps.googleapis.com/maps/api/place/textsearch/json"

    params = {
        "query": query,
        "key": PLACES_API_KEY
    }

    res = requests.get(url, params=params)
    return res.json().get("results", [])


# --- STEP 2: ENRICH WITH GEMINI ---
def enrich_restaurant(place):
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
        }
    )

    return json.loads(response.text)


# --- API ROUTE ---
@app.get("/restaurants")
def get_restaurant_data(query: str = "restaurants in Tempe"):
    places = get_restaurants(query)

    results = []

    for p in places[:5]:  # limit for testing
        try:
            ai_data = enrich_restaurant(p)

            results.append({
                "name": p.get("name"),
                "rating": p.get("rating"),
                "cuisine": ai_data.get("cuisine"),
                "main_food": ai_data.get("main_food"),
                "price_range": ai_data.get("price_range")
            })
        except:
            continue

    return {
        "data": results
    }