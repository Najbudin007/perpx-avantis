# Fix: Avantis Service URL Configuration

## Problem
Trading engine was defaulting to `http://localhost:3002` but Avantis service runs on port `8000`, causing 404 errors.

## Fix Applied
Updated default URLs in:
1. `trading-engine/avantis-trading.ts` - Changed default from `3002` to `8000`
2. `trading-engine/hyperliquid/BudgetAndLeverage.ts` - Changed default from `3002` to `8000`
3. `trading-engine/avantis-address-queries.ts` - Changed default from `3002` to `8000`

## Docker Configuration

If services are in Docker containers, set `AVANTIS_API_URL` environment variable:

### Option 1: Using Docker Service Name (Recommended)
```bash
# In trading-engine container or .env file
AVANTIS_API_URL=http://perpx-avantis-service:8000
# OR if using docker-compose service name
AVANTIS_API_URL=http://avantis-service:8000
```

### Option 2: Using Host Network
```bash
# If containers share host network
AVANTIS_API_URL=http://localhost:8000
```

### Option 3: Using Host IP
```bash
# If accessing from host
AVANTIS_API_URL=http://<host-ip>:8000
```

## Verification

After setting the environment variable, restart the trading engine and verify:

```bash
# Check if trading engine can reach Avantis service
docker exec <trading-engine-container> curl http://perpx-avantis-service:8000/health

# Or if using localhost
docker exec <trading-engine-container> curl http://localhost:8000/health
```

## Expected Result

After this fix:
- ✅ `/api/min-position` endpoint will work (no more 404)
- ✅ `/api/positions` endpoint will work (no more 404)
- ✅ Pre-validation will pass
- ✅ Trades will open successfully

## Next Steps

1. Set `AVANTIS_API_URL` environment variable in trading engine
2. Restart trading engine container
3. Test opening a position from Farcaster app
4. Verify positions are opening successfully
