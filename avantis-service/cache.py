"""In-memory caching with TTL and request deduplication for API endpoints."""
import asyncio
import time
from typing import Any, Optional, Dict, Tuple
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)

class CacheEntry:
    """Cache entry with TTL."""
    def __init__(self, value: Any, ttl: float):
        self.value = value
        self.expires_at = time.time() + ttl
        self.created_at = time.time()
    
    def is_expired(self) -> bool:
        return time.time() > self.expires_at


class RequestCache:
    """Thread-safe in-memory cache with TTL and request deduplication."""
    
    def __init__(self):
        self._cache: Dict[str, CacheEntry] = {}
        self._locks: Dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._pending_requests: Dict[str, asyncio.Task] = {}
        self._lock = asyncio.Lock()
    
    def _make_key(self, endpoint: str, **kwargs) -> str:
        """Create a cache key from endpoint and parameters."""
        # Sort kwargs for consistent keys
        sorted_kwargs = sorted(kwargs.items())
        # Normalize private_key for consistent keys (use first 8 and last 4 chars)
        normalized_kwargs = []
        for k, v in sorted_kwargs:
            if v is not None:
                if k == "private_key" and isinstance(v, str) and len(v) > 12:
                    # Normalize private key for consistent caching
                    normalized_kwargs.append(f"{k}={v[:8]}_{v[-4:]}")
                else:
                    normalized_kwargs.append(f"{k}={v}")
        key_parts = [endpoint] + normalized_kwargs
        return "|".join(key_parts)
    
    async def get(self, endpoint: str, **kwargs) -> Optional[Any]:
        """Get cached value if not expired."""
        key = self._make_key(endpoint, **kwargs)
        
        async with self._lock:
            entry = self._cache.get(key)
            if entry and not entry.is_expired():
                logger.info(f"💾 [CACHE] HIT: {endpoint} (key: {key[:50]}...)")
                return entry.value
            elif entry and entry.is_expired():
                # Remove expired entry
                del self._cache[key]
                logger.info(f"💾 [CACHE] EXPIRED: {endpoint} (key: {key[:50]}...)")
            else:
                logger.info(f"💾 [CACHE] MISS: {endpoint} (key: {key[:50]}..., total entries in cache: {len(self._cache)})")
            return None
    
    async def set(self, endpoint: str, value: Any, ttl: float = 30.0, **kwargs):
        """Set cached value with TTL."""
        key = self._make_key(endpoint, **kwargs)
        
        try:
            async with self._lock:
                self._cache[key] = CacheEntry(value, ttl)
                total_entries = len(self._cache)
                logger.info(f"💾 [CACHE] SET: {endpoint} (TTL: {ttl}s, key: {key[:50]}..., total entries: {total_entries})")
        except Exception as e:
            logger.error(f"💾 [CACHE] Exception in set() for {endpoint}: {e}", exc_info=True)
            raise
    
    async def invalidate(self, endpoint: str, **kwargs):
        """
        Invalidate cache entry(ies).
        Since cache keys can be created with either private_key, address, or both,
        we invalidate both variations to ensure complete cache clearing.
        """
        async with self._lock:
            invalidated_keys = []
            
            # Create keys for both variations: with private_key only, and with address only
            # This ensures we invalidate regardless of which key format was used for caching
            if kwargs.get("private_key") is not None:
                key1 = self._make_key(endpoint, private_key=kwargs["private_key"], address=None)
                if key1 in self._cache:
                    del self._cache[key1]
                    invalidated_keys.append(key1[:50])
            
            if kwargs.get("address") is not None:
                key2 = self._make_key(endpoint, private_key=None, address=kwargs["address"])
                if key2 in self._cache:
                    del self._cache[key2]
                    invalidated_keys.append(key2[:50])
            
            # Also try the exact key as provided (in case both were used together)
            key_exact = self._make_key(endpoint, **kwargs)
            if key_exact in self._cache:
                if key_exact[:50] not in invalidated_keys:
                    del self._cache[key_exact]
                    invalidated_keys.append(key_exact[:50])
            
            if invalidated_keys:
                logger.info(f"💾 [CACHE] INVALIDATED {len(invalidated_keys)} key(s) for {endpoint} (keys: {', '.join(invalidated_keys)}..., total entries: {len(self._cache)})")
            else:
                logger.debug(f"💾 [CACHE] INVALIDATE MISS: {endpoint} (no matching keys found in cache)")
    
    async def clear(self):
        """Clear all cache entries."""
        async with self._lock:
            self._cache.clear()
            logger.info("💾 [CACHE] CLEARED: All entries")
    
    async def get_or_compute(
        self, 
        endpoint: str, 
        compute_func, 
        ttl: float = 30.0,
        **kwargs
    ) -> Any:
        """
        Get from cache or compute if missing.
        Implements request deduplication: if same request is already in progress,
        wait for that request instead of starting a new one.
        """
        key = self._make_key(endpoint, **kwargs)
        
        # Check cache first
        cached = await self.get(endpoint, **kwargs)
        if cached is not None:
            return cached
        
        # Check if same request is already in progress (deduplication)
        async with self._lock:
            if key in self._pending_requests:
                pending_task = self._pending_requests[key]
                logger.debug(f"🔄 [CACHE] DEDUPE: Waiting for existing request: {endpoint}")
                # Wait for the existing request to complete
                try:
                    result = await pending_task
                    # Check cache again after waiting
                    cached = await self.get(endpoint, **kwargs)
                    if cached is not None:
                        return cached
                except Exception as e:
                    logger.warning(f"🔄 [CACHE] Pending request failed: {e}")
                finally:
                    # Clean up if task is done
                    if key in self._pending_requests and self._pending_requests[key].done():
                        del self._pending_requests[key]
        
        # Acquire lock for this specific key
        lock = self._locks[key]
        async with lock:
            # Double-check cache after acquiring lock
            cached = await self.get(endpoint, **kwargs)
            if cached is not None:
                return cached
            
            # Compute value
            logger.info(f"🔄 [CACHE] COMPUTING: {endpoint}")
            try:
                # Create task for deduplication
                task = asyncio.create_task(compute_func())
                async with self._lock:
                    self._pending_requests[key] = task
                
                result = await task
                
                # Cache the result (even empty lists/arrays should be cached to avoid repeated expensive queries)
                # Only skip caching if result is explicitly None
                if result is not None:
                    try:
                        # Log result type and length for debugging
                        result_type = type(result).__name__
                        result_len = len(result) if hasattr(result, '__len__') else 'N/A'
                        logger.debug(f"💾 [CACHE] Attempting to cache {endpoint}: type={result_type}, len={result_len}")
                        
                        await self.set(endpoint, result, ttl=ttl, **kwargs)
                        logger.info(f"💾 [CACHE] Successfully cached result for {endpoint} (type={result_type}, len={result_len})")
                    except Exception as set_error:
                        logger.error(f"💾 [CACHE] Error setting cache for {endpoint}: {set_error}", exc_info=True)
                else:
                    logger.warning(f"💾 [CACHE] Result is None, not caching for {endpoint} (this may indicate an error)")
                
                return result
            except Exception as e:
                logger.error(f"🔄 [CACHE] Compute error for {endpoint}: {e}")
                raise
            finally:
                # Clean up pending request
                async with self._lock:
                    if key in self._pending_requests:
                        del self._pending_requests[key]
    
    async def get_stats_async(self) -> Dict[str, Any]:
        """Get cache statistics (async version) - thread-safe."""
        # Use lock to ensure consistent snapshot
        try:
            async with self._lock:
                # Create a snapshot of cache state with lock held
                cache_snapshot = dict(self._cache)
                pending_snapshot = dict(self._pending_requests)
            
            # Calculate stats outside the lock (cache_snapshot is now immutable)
            total_entries = len(cache_snapshot)
            expired_count = sum(1 for entry in cache_snapshot.values() if entry.is_expired())
            active_entries = total_entries - expired_count
            pending_requests = len(pending_snapshot)
            
            logger.debug(f"💾 [CACHE] Stats: total={total_entries}, active={active_entries}, expired={expired_count}, pending={pending_requests}")
            
            return {
                "total_entries": total_entries,
                "expired_entries": expired_count,
                "active_entries": active_entries,
                "pending_requests": pending_requests
            }
        except Exception as e:
            logger.error(f"Error in get_stats_async: {e}", exc_info=True)
            return {
                "total_entries": 0,
                "pending_requests": 0,
                "active_entries": 0,
                "expired_entries": 0,
                "error": str(e)
            }
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics (synchronous wrapper)."""
        # Return basic stats without async (safe for sync access)
        try:
            return {
                "total_entries": len(self._cache),
                "pending_requests": len(self._pending_requests),
                "active_entries": sum(1 for entry in self._cache.values() if not entry.is_expired())
            }
        except Exception as e:
            logger.error(f"Error in get_stats: {e}", exc_info=True)
            return {
                "total_entries": 0,
                "pending_requests": 0,
                "active_entries": 0,
                "error": str(e)
            }


# Global cache instance
cache = RequestCache()
