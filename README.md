# Grubr

**Grubr** is a Tinder-style food discovery app that lets you swipe through real menu items from restaurants near you. Like dishes to build a taste profile, get matched to a restaurant, and place your order — all in one flow.

Built for InnovationHacks 2026.

---

## How It Works

1. **Onboarding** — Set your location, cuisine preferences, price range, and dietary restrictions.
2. **Swipe** — Browse real menu items scraped from nearby restaurant websites. Swipe right to like, left to pass.
3. **Match** — After liking enough dishes from one spot, Grubr surfaces that restaurant as a match.
4. **Order** — Review your liked items, confirm your order, and check out.

---

## Tech Stack

### Frontend
| Technology | Role |
|---|---|
| [Next.js 15](https://nextjs.org) (App Router) | React framework, routing, API route proxies |
| [Framer Motion](https://www.framer.com/motion/) | Swipe card animations, page transitions |
| [Tailwind CSS](https://tailwindcss.com) | Utility-first styling |
| [TypeScript](https://www.typescriptlang.org) | Type safety across the full frontend |

### Backend
| Technology | Role |
|---|---|
| [FastAPI](https://fastapi.tiangolo.com) (Python 3.12) | REST API — restaurant discovery, menu scraping, AI enrichment |
| [Google Places API](https://developers.google.com/maps/documentation/places/web-service) | Nearby restaurant search, place details, photos |
| [Gemini 2.5 Flash](https://ai.google.dev) | Menu item extraction from scraped HTML/PDF, delivery app knowledge lookup, cuisine enrichment |
| [BeautifulSoup4](https://www.crummy.com/software/BeautifulSoup/) | HTML parsing for restaurant website scraping |
| [pypdf](https://pypdf.readthedocs.io) | PDF menu text extraction |
| [Fly.io](https://fly.io) | Backend deployment and hosting |

### Storage & State
| Technology | Role |
|---|---|
| Browser `localStorage` | Swipe state, cart, user profile, and discovery result caching (24h TTL) |

---

## Architecture

```
Browser (Next.js)
    │
    ├── /api/discover        ← Next.js API route (proxy)
    │       │
    │       └── grubr-api.fly.dev/discover   ← FastAPI on Fly.io
    │               │
    │               ├── Google Places API    (find nearby restaurants)
    │               ├── Places Details API   (website URL + photos)
    │               ├── Website scraper      (BeautifulSoup + pypdf)
    │               └── Gemini 2.5 Flash     (extract & validate menu items)
    │
    └── localStorage         (cache results, persist swipe state & cart)
```

**Discovery flow:**
1. Places API returns up to 12 nearby restaurant candidates.
2. For each candidate, the backend fetches their website, scrapes HTML and any linked PDF menus, and sends the raw text to Gemini to extract specific, orderable menu items with prices.
3. Restaurants that yield fewer than 3 real menu items are skipped. Remaining slots fall back to a batch Gemini knowledge lookup (checks Grubhub / DoorDash / Uber Eats availability).
4. The first 3 restaurants with valid menus are returned alongside resolved Google photo URLs.
5. Results are cached in `localStorage` keyed by location + profile — subsequent loads are instant.

---

## Local Development

### Prerequisites
- Node.js 18+
- Python 3.12+
- A Google Cloud project with **Places API** and **Gemini API** enabled

### Environment Variables

Create `.env` at the repo root:

```env
GOOGLE_MAPS_API_KEY=your_maps_platform_key   # Must have Places API enabled
GEMINI_API_KEY=your_gemini_api_key
```

Create `.env.local` in the repo root (Next.js):

```env
RESTAURANTS_API_URL=http://localhost:8080
```

### Run the backend

```bash
cd app/backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

### Run the frontend

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment

The backend is deployed on [Fly.io](https://fly.io):

```bash
cd app/backend
fly deploy
```

The frontend can be deployed to [Vercel](https://vercel.com) with zero configuration — connect the repository and set the `RESTAURANTS_API_URL` environment variable to your Fly.io backend URL.
