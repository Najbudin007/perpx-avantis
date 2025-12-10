#!/bin/bash

# PrepX AI - Server Stop Script
# This script stops all three services

echo "🛑 Stopping PrepX AI Services"
echo "============================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to kill process by port
kill_by_port() {
    local port=$1
    local pids=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "$pids" | xargs kill -9 2>/dev/null
        return 0
    fi
    return 1
}

# Function to kill process by pattern
kill_by_pattern() {
    local pattern=$1
    local pids=$(pgrep -f "$pattern" 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "$pids" | xargs kill -9 2>/dev/null
        return 0
    fi
    return 1
}

# Stop Avantis Service (Port 3002)
echo -e "${YELLOW}Stopping Avantis Service (Port 3002)...${NC}"
# Kill by port first (most reliable)
if kill_by_port 3002; then
    echo -e "  ${GREEN}✓ Killed process on port 3002${NC}"
fi
sleep 0.5
# Kill by process patterns
kill_by_pattern "uvicorn.*main:app"
kill_by_pattern "uvicorn.*3002"
kill_by_pattern "python.*uvicorn"
kill_by_pattern "python3.*uvicorn"
# Kill any python process running main:app
pkill -9 -f "python.*main:app" 2>/dev/null
pkill -9 -f "python3.*main:app" 2>/dev/null
pkill -9 -f "uvicorn" 2>/dev/null
sleep 1

# Stop Trading Engine (Port 3001)
echo -e "${YELLOW}Stopping Trading Engine (Port 3001)...${NC}"
# Kill by port first
if kill_by_port 3001; then
    echo -e "  ${GREEN}✓ Killed process on port 3001${NC}"
fi
sleep 0.5
# Kill by process patterns
kill_by_pattern "trading-engine"
kill_by_pattern "ts-node.*server"
kill_by_pattern "ts-node.*trading-engine"
kill_by_pattern "node.*trading-engine"
pkill -9 -f "npm.*start" 2>/dev/null
pkill -9 -f "npm.*trading-engine" 2>/dev/null
sleep 1

# Stop Frontend (Port 3000)
echo -e "${YELLOW}Stopping Frontend (Port 3000)...${NC}"
# Kill by port first
if kill_by_port 3000; then
    echo -e "  ${GREEN}✓ Killed process on port 3000${NC}"
fi
sleep 0.5
# Kill by process patterns
kill_by_pattern "next.*dev"
kill_by_pattern "next-server"
kill_by_pattern "pnpm.*dev"
pkill -9 -f "pnpm dev" 2>/dev/null
pkill -9 -f "next dev" 2>/dev/null
sleep 1

# Final cleanup - kill any remaining processes
echo -e "${YELLOW}Performing final cleanup...${NC}"
pkill -9 -f "uvicorn" 2>/dev/null
pkill -9 -f "trading-engine" 2>/dev/null
pkill -9 -f "ts-node" 2>/dev/null
pkill -9 -f "next" 2>/dev/null

# Wait a bit for processes to terminate
sleep 2

# Verify all stopped
echo ""
echo -e "${YELLOW}Verifying all services stopped...${NC}"

# Check ports
ports_running=0
if lsof -ti:3002 > /dev/null 2>&1; then
    echo -e "${RED}  ❌ Port 3002 (Avantis) still in use${NC}"
    # Try one more time to kill by port
    lsof -ti:3002 | xargs kill -9 2>/dev/null
    sleep 1
    if lsof -ti:3002 > /dev/null 2>&1; then
        ports_running=1
    else
        echo -e "${GREEN}  ✓ Port 3002 (Avantis) now free${NC}"
    fi
else
    echo -e "${GREEN}  ✅ Port 3002 (Avantis) is free${NC}"
fi
if lsof -ti:3001 > /dev/null 2>&1; then
    echo -e "${RED}  ❌ Port 3001 (Trading Engine) still in use${NC}"
    # Try one more time to kill by port
    lsof -ti:3001 | xargs kill -9 2>/dev/null
    sleep 1
    if lsof -ti:3001 > /dev/null 2>&1; then
        ports_running=1
    else
        echo -e "${GREEN}  ✓ Port 3001 (Trading Engine) now free${NC}"
    fi
else
    echo -e "${GREEN}  ✅ Port 3001 (Trading Engine) is free${NC}"
fi
if lsof -ti:3000 > /dev/null 2>&1; then
    echo -e "${RED}  ❌ Port 3000 (Frontend) still in use${NC}"
    # Try one more time to kill by port
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    sleep 1
    if lsof -ti:3000 > /dev/null 2>&1; then
        ports_running=1
    else
        echo -e "${GREEN}  ✓ Port 3000 (Frontend) now free${NC}"
    fi
else
    echo -e "${GREEN}  ✅ Port 3000 (Frontend) is free${NC}"
fi

# Check processes
if pgrep -f "uvicorn|trading-engine|ts-node|next.*dev" > /dev/null 2>&1; then
    echo -e "${RED}  ❌ Some processes still running${NC}"
    echo ""
    echo -e "${YELLOW}Remaining processes:${NC}"
    ps aux | grep -E "uvicorn|trading-engine|ts-node|next.*dev" | grep -v grep
    ports_running=1
fi

if [ $ports_running -eq 0 ]; then
    echo -e "${GREEN}  ✅ All servers stopped successfully${NC}"
else
    echo ""
    echo -e "${RED}⚠️  Some processes may still be running${NC}"
    echo -e "${YELLOW}To force kill all remaining processes, run:${NC}"
    echo "  pkill -9 -f 'uvicorn|trading-engine|ts-node|next'"
    echo "  lsof -ti:3000,3001,3002 | xargs kill -9 2>/dev/null"
fi

echo ""

