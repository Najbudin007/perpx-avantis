"""Rate limiting middleware for FastAPI."""
import time
from collections import defaultdict
from typing import Dict, Tuple
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
import logging

logger = logging.getLogger(__name__)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Simple in-memory rate limiter.
    Limits requests per endpoint per user (identified by private_key or address).
    """
    
    def __init__(self, app, requests_per_minute: int = 60, burst: int = 10):
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.burst = burst
        # Store request timestamps: {endpoint: {user_id: [timestamps]}}
        self._requests: Dict[str, Dict[str, list]] = defaultdict(lambda: defaultdict(list))
        self._last_cleanup = time.time()
        self._cleanup_interval = 60.0  # Clean up old entries every minute
    
    def _get_user_id(self, request: Request) -> str:
        """Extract user identifier from request."""
        # Try to get from query params (private_key or address)
        private_key = request.query_params.get("private_key")
        address = request.query_params.get("address")
        
        if private_key:
            # Use first 8 and last 4 chars for identification (masked)
            if len(private_key) > 12:
                return f"pk_{private_key[:8]}_{private_key[-4:]}"
            return f"pk_{private_key}"
        elif address:
            return f"addr_{address.lower()}"
        else:
            # Fallback to IP address
            client_host = request.client.host if request.client else "unknown"
            return f"ip_{client_host}"
    
    def _cleanup_old_entries(self):
        """Remove old request timestamps (older than 1 minute)."""
        now = time.time()
        if now - self._last_cleanup < self._cleanup_interval:
            return
        
        cutoff = now - 60.0  # 1 minute ago
        for endpoint_dict in self._requests.values():
            for user_requests in endpoint_dict.values():
                # Remove timestamps older than 1 minute
                user_requests[:] = [ts for ts in user_requests if ts > cutoff]
        
        self._last_cleanup = now
    
    async def dispatch(self, request: Request, call_next):
        # Only rate limit API endpoints
        if not request.url.path.startswith("/api/"):
            return await call_next(request)
        
        # Skip rate limiting for health check
        if request.url.path == "/health":
            return await call_next(request)
        
        endpoint = request.url.path
        user_id = self._get_user_id(request)
        
        # Cleanup old entries periodically
        self._cleanup_old_entries()
        
        # Get current request timestamps for this user/endpoint
        now = time.time()
        user_requests = self._requests[endpoint][user_id]
        
        # Remove timestamps older than 1 minute
        user_requests[:] = [ts for ts in user_requests if ts > now - 60.0]
        
        # Check burst limit (immediate limit) - increased to handle multiple hooks
        if len(user_requests) >= self.burst:
            logger.warning(f"🚫 [RATE_LIMIT] Burst limit exceeded: {endpoint} for {user_id[:20]}... ({len(user_requests)} requests)")
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": "Too many requests. Please wait a moment and try again.",
                    "error": "rate_limit_exceeded",
                    "retry_after": 1
                }
            )
        
        # Check per-minute limit
        if len(user_requests) >= self.requests_per_minute:
            logger.warning(f"🚫 [RATE_LIMIT] Rate limit exceeded: {endpoint} for {user_id[:20]}... ({len(user_requests)} requests)")
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": f"Rate limit exceeded. Maximum {self.requests_per_minute} requests per minute.",
                    "error": "rate_limit_exceeded",
                    "retry_after": 60
                }
            )
        
        # Record this request
        user_requests.append(now)
        
        # Process request
        response = await call_next(request)
        return response
