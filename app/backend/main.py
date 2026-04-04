"""
main.py — FastAPI entrypoint for the Restaurant Scraper API.
"""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from services.vertex import VertexService
from routers import restaurants, jobs, health

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise shared services on startup, clean up on shutdown."""
    settings = get_settings()
    app.state.vertex = VertexService(settings)
    app.state.settings = settings
    yield
    # nothing to teardown for now


app = FastAPI(
    title="Restaurant Scraper API",
    description="Scrape restaurant data for any area using Google Places + Vertex AI Gemini.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(restaurants.router, prefix="/restaurants", tags=["Restaurants"])
app.include_router(jobs.router, prefix="/jobs", tags=["Jobs"])