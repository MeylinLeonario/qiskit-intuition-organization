"""ASGI entry point for the independently deployed Python backend on Vercel."""
from backend.main import app

__all__ = ["app"]
