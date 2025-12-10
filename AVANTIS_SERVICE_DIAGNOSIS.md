# Avantis Service Health Issue - Diagnosis & Fix

## Problem
The Avantis service container is **unhealthy** (FailingStreak: 51), causing:
- 404 errors on `/api/min-position` endpoint
- 404 errors on `/api/positions` endpoint  
- Trades being blocked by pre-validation

## Root Cause
The health check is failing: `curl -f http://localhost:8000/health || exit 1`

## Health Check Configuration
- **Endpoint**: `/health` on port 8000
- **Docker healthcheck**: `curl -f http://localhost:8000/health || exit 1`
- **Interval**: 30 seconds
- **Status**: UNHEALTHY (51 consecutive failures)

## Possible Causes

### 1. Service Not Starting
- Check if uvicorn is running: `docker exec perpx-avantis-service ps aux | grep uvicorn`
- Check startup logs: `docker logs perpx-avantis-service --tail 100`

### 2. Port Binding Issue
- Service might not be listening on 0.0.0.0:8000
- Check: `docker exec perpx-avantis-service netstat -tlnp | grep 8000`

### 3. Missing Dependencies
- Python packages might not be installed correctly
- Check: `docker exec perpx-avantis-service pip list`

### 4. Configuration Issues
- Environment variables might be missing
- RPC URL might be invalid
- Check: `docker exec perpx-avantis-service env | grep -E "RPC|NETWORK|PORT"`

### 5. Application Crash
- Service might be crashing on startup
- Check logs for Python errors: `docker logs perpx-avantis-service`

## Diagnostic Commands

```bash
# Check if container is running
docker ps -a | grep perpx-avantis-service

# Check container logs
docker logs perpx-avantis-service --tail 200

# Check if service is responding
docker exec perpx-avantis-service curl http://localhost:8000/health

# Check if uvicorn process is running
docker exec perpx-avantis-service ps aux | grep uvicorn

# Check port binding
docker exec perpx-avantis-service netstat -tlnp | grep 8000

# Check Python environment
docker exec perpx-avantis-service python --version
docker exec perpx-avantis-service pip list

# Restart the service
docker restart perpx-avantis-service

# Check health after restart
docker inspect perpx-avantis-service | grep -A 5 Health
```

## Quick Fixes

### Fix 1: Restart the Service
```bash
docker restart perpx-avantis-service
# Wait 30 seconds, then check health
docker inspect perpx-avantis-service | grep -A 5 Health
```

### Fix 2: Rebuild the Container
```bash
cd avantis-service
docker-compose down
docker-compose up -d --build
```

### Fix 3: Check Environment Variables
```bash
# Verify required env vars are set
docker exec perpx-avantis-service env | grep -E "RPC_URL|NETWORK|PORT"
```

### Fix 4: Check RPC Connection
The service might be failing because it can't connect to the Base RPC endpoint. Check:
- `BASE_RPC_URL` or `RPC_URL` environment variable
- Network connectivity from container to RPC endpoint

## Expected Health Response
```json
{
  "status": "healthy",
  "service": "avantis-trading-service",
  "network": "base-mainnet",
  "network_name": "Base Mainnet",
  "block_explorer": "https://basescan.org"
}
```

## After Fixing Health

Once the service is healthy:
1. The `/api/min-position` endpoint will work
2. The `/api/positions` endpoint will work
3. Pre-validation will pass (or properly validate)
4. Trades will open successfully

## Temporary Workaround

The code fix I applied allows trades to proceed even when the validation endpoint returns 404, but the service should still be fixed for proper validation.
