import os
import sys

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse

# Ensure we are able to import from the root project directory
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Load environment variables
load_dotenv()

from backend.routers import agents, auth, course, execute, simulate

app = FastAPI(
    title="Qiskit Intuition Lab API",
    description="Decoupled backend service for quantum simulation, code execution, and offline educational helpers.",
    version="1.0.0"
)

@app.exception_handler(RequestValidationError)
async def safe_validation_error(request, error):
    if request.url.path.startswith("/auth/"):
        # Do not echo submitted passwords or reset tokens in validation responses.
        detail = error.errors()[0].get("msg", "Check the submitted account details.")
        return JSONResponse({"detail": detail}, status_code=422, headers={"Cache-Control": "no-store"})
    return await request_validation_exception_handler(request, error)


# Configure CORS - Restrict to trusted local origins
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8501",
    "http://127.0.0.1:8501",
    "https://qiskit-intuition-organization.vercel.app/"
]

extra_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS + extra_origins,
    allow_origin_regex=r"https://.*\.hf\.space",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

# Authentication failures must not expose database URLs or credentials.
for error_type in auth.AUTH_ERROR_TYPES:
    app.add_exception_handler(error_type, auth.configuration_error_handler)

# Mount routers
app.include_router(auth.router)
app.include_router(course.router, tags=["course"])
app.include_router(simulate.router, tags=["simulation"])
app.include_router(execute.router, tags=["execution"])
app.include_router(agents.router, prefix="/agent", tags=["agents"])

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "offline_ai": True
    }
