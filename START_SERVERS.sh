#!/bin/bash

# PrepX AI - Server Start Script
# This script starts all three services

echo "🚀 Starting PrepX AI Services"
echo "============================"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Function to check if a port is in use
check_port() {
    if lsof -Pi :$1 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        echo -e "${YELLOW}⚠️  Port $1 is already in use${NC}"
        return 1
    else
        return 0
    fi
}

# Start Avantis Service
echo -e "${BLUE}1️⃣  Starting Avantis Service (Port 8000)...${NC}"
if check_port 8000; then
    cd "$SCRIPT_DIR/avantis-service"
    if [ -d "venv" ]; then
        source venv/bin/activate
        python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload > /tmp/avantis-service.log 2>&1 &
    else
        python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload > /tmp/avantis-service.log 2>&1 &
    fi
    AVANTIS_PID=$!
    echo -e "${GREEN}   ✅ Avantis Service started (PID: $AVANTIS_PID) on port 8000${NC}"
    sleep 3
else
    echo -e "${YELLOW}   ⚠️  Skipping Avantis Service (port 8000 in use)${NC}"
fi

# Start Trading Engine
echo -e "${BLUE}2️⃣  Starting Trading Engine (Port 3001)...${NC}"
if check_port 3001; then
    cd "$SCRIPT_DIR/trading-engine"
    npm start > /tmp/trading-engine.log 2>&1 &
    TRADING_PID=$!
    echo -e "${GREEN}   ✅ Trading Engine started (PID: $TRADING_PID)${NC}"
    sleep 3
else
    echo -e "${YELLOW}   ⚠️  Skipping Trading Engine (port in use)${NC}"
fi

# Start Frontend
echo -e "${BLUE}3️⃣  Starting Frontend (Port 3000)...${NC}"
if check_port 3000; then
    cd "$SCRIPT_DIR"
    pnpm dev > /tmp/frontend.log 2>&1 &
    FRONTEND_PID=$!
    echo -e "${GREEN}   ✅ Frontend started (PID: $FRONTEND_PID)${NC}"
    sleep 5
else
    echo -e "${YELLOW}   ⚠️  Skipping Frontend (port in use)${NC}"
fi

echo ""
echo -e "${GREEN}✅ All services started!${NC}"
echo ""
echo "📊 Service Status:"
echo "  - Avantis Service: http://localhost:8000/health"
echo "  - Trading Engine:  http://localhost:3001"
echo "  - Frontend:        http://localhost:3000"
echo ""
echo "📋 Logs:"
echo "  - Avantis Service: tail -f /tmp/avantis-service.log"
echo "  - Trading Engine:  tail -f /tmp/trading-engine.log"
echo "  - Frontend:        tail -f /tmp/frontend.log"
echo ""
echo "🛑 To stop all services: ./STOP_SERVERS.sh"
echo ""

