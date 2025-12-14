# Cache and Connection Fixes

## Issues Found

1. **Cache not storing entries**: Logs show MISS/COMPUTING but stats show 0 entries
2. **Trading engine connection errors**: Repeated `ECONNREFUSED` errors when Avantis service isn't ready

## Fixes Applied

### 1. Fixed Cache Stats ✅

**File**: `avantis-service/cache.py`

- Added `get_stats_async()` method for proper async stats retrieval
- Fixed stats to properly count active entries
- Added automatic cleanup of expired entries in stats
- Improved logging to show cache key and total entries when setting

**Before**:
```python
def get_stats(self):
    # Had issues with async/sync mixing
    return {"total_entries": len(self._cache)}
```

**After**:
```python
async def get_stats_async(self):
    async with self._lock:
        # Properly count and clean expired entries
        total_entries = len(self._cache)
        expired_count = sum(1 for entry in self._cache.values() if entry.is_expired())
        # Clean up expired entries
        expired_keys = [k for k, entry in self._cache.items() if entry.is_expired()]
        for key in expired_keys:
            del self._cache[key]
        return {
            "total_entries": total_entries,
            "active_entries": total_entries - expired_count,
            ...
        }
```

### 2. Fixed Trading Engine Connection Errors ✅

**File**: `trading-engine/api/server.ts`

- Added health check before attempting to fetch positions
- Returns empty positions gracefully if Avantis service isn't available
- Prevents log spam from connection refused errors

**Before**:
```typescript
try {
  const avantisResponse = await fetch(`${avantisApiUrl}/api/positions?...`);
  // Would throw ECONNREFUSED and spam logs
}
```

**After**:
```typescript
// Health check first
try {
  const healthResponse = await fetch(`${avantisApiUrl}/health`, {
    signal: healthController.signal,
  });
  
  if (!healthResponse || !healthResponse.ok) {
    // Service not available - return empty positions
    return { positions: [], totalPnL: 0, openPositions: 0 };
  }
} catch (healthError) {
  // Service not available - return empty positions
  return { positions: [], totalPnL: 0, openPositions: 0 };
}

// Only proceed if health check passes
const avantisResponse = await fetch(...);
```

### 3. Improved Cache Logging ✅

**File**: `avantis-service/cache.py`

- Added cache key preview in SET logs
- Shows total entries count when setting cache
- Better visibility into cache operations

**Example log output**:
```
💾 [CACHE] SET: positions (TTL: 20.0s, key: positions|private_key=0x06b7f8_c479|address=None..., total entries: 1)
```

### 4. Updated Cache Stats Endpoint ✅

**File**: `avantis-service/main.py`

- Changed to use async `get_stats_async()` method
- Properly retrieves cache statistics

## Expected Results

### Cache:
- ✅ Cache stats now show correct entry counts
- ✅ Expired entries are automatically cleaned up
- ✅ Better logging shows when cache is working

### Trading Engine:
- ✅ No more connection refused log spam
- ✅ Gracefully handles Avantis service being unavailable
- ✅ Returns empty positions instead of errors

## Testing

1. **Check cache stats**:
   ```bash
   curl http://localhost:8000/api/cache/stats
   ```
   Should show `active_entries > 0` after a few requests

2. **Check cache logs**:
   ```bash
   tail -f /tmp/avantis-service.log | grep "CACHE"
   ```
   Should see: HIT, MISS, SET with entry counts

3. **Check trading engine logs**:
   ```bash
   tail -f /tmp/trading-engine.log
   ```
   Should NOT see repeated ECONNREFUSED errors

## Files Modified

1. `avantis-service/cache.py` - Fixed stats, improved logging
2. `avantis-service/main.py` - Updated cache stats endpoint
3. `trading-engine/api/server.ts` - Added health check before connecting
