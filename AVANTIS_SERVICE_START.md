# Avantis Service - Port Configuration Fix

## Issue
Error: "Cannot connect to Avantis service at http://localhost:3002. Please ensure the Avantis service is running on port 8000."

## Root Cause
The `START_SERVERS.sh` script was starting the Avantis service on port **3002** instead of port **8000**.

## Fixes Applied

### 1. Fixed START_SERVERS.sh ✅
- Changed port from 3002 to 8000
- Updated all references in the script

### 2. Created Quick Start Script ✅
- **File**: `start_avantis_service.sh`
- Starts Avantis service on port 8000
- Handles port conflicts automatically

## How to Start Avantis Service

### Option 1: Use the Quick Start Script
```bash
cd /Users/mokshya/Desktop/perpx-avantis
./start_avantis_service.sh
```

### Option 2: Manual Start
```bash
cd /Users/mokshya/Desktop/perpx-avantis/avantis-service
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Option 3: Use START_SERVERS.sh (Fixed)
```bash
cd /Users/mokshya/Desktop/perpx-avantis
./START_SERVERS.sh
```

## Verify Service is Running

```bash
# Check if port 8000 is in use
lsof -i :8000

# Test health endpoint
curl http://localhost:8000/health

# Test trade history endpoint (with your private key)
curl "http://localhost:8000/api/trade-history?private_key=0x06b7f8270fded5d2fe7b65f9019055a033db55331cf52e327c80f1b9ddfec479&limit=50"
```

## Expected Result

After starting the service:
- ✅ Service runs on port 8000
- ✅ Health endpoint responds: `curl http://localhost:8000/health`
- ✅ Trade history endpoint works
- ✅ Frontend can connect successfully

## Troubleshooting

If service doesn't start:
1. Check if port 8000 is already in use: `lsof -i :8000`
2. Kill existing process: `lsof -ti:8000 | xargs kill -9`
3. Check logs: `tail -f /tmp/avantis-service.log`
4. Verify Python dependencies: `cd avantis-service && pip list | grep uvicorn`

## Configuration

- **Default Port**: 8000 (configured in `avantis-service/config.py`)
- **Host**: 0.0.0.0 (listens on all interfaces)
- **Health Endpoint**: `http://localhost:8000/health`
- **Trade History Endpoint**: `http://localhost:8000/api/trade-history`
