from fastapi import FastAPI, UploadFile, File, HTTPException
import os


app = FastAPI()
API_KEY = os.getenv("OPENROUTER_API_KEY")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

