#!/bin/bash
# Script to check positions and cancel all pending orders

PRIVATE_KEY="0x5334e38e7caaf59b317d249b26c88110dbbf2d4117ec44014b72b77b8f741758"
AVANTIS_API="http://localhost:3002"

echo "=========================================="
echo "Checking Positions and Pending Orders"
echo "=========================================="

# 1. Check balance
echo ""
echo "1. Checking balance..."
BALANCE=$(curl -s -X GET "${AVANTIS_API}/api/balance?private_key=${PRIVATE_KEY}")
echo "$BALANCE" | python3 -m json.tool 2>/dev/null || echo "$BALANCE"

# 2. Check positions
echo ""
echo "2. Checking open positions..."
POSITIONS=$(curl -s -X GET "${AVANTIS_API}/api/positions?private_key=${PRIVATE_KEY}")
echo "$POSITIONS" | python3 -m json.tool 2>/dev/null || echo "$POSITIONS"

# 3. Close all positions if any exist
echo ""
echo "3. Closing all positions..."
CLOSE_RESULT=$(curl -s -X POST "${AVANTIS_API}/api/close-all-positions" \
  -H "Content-Type: application/json" \
  -d "{\"private_key\": \"${PRIVATE_KEY}\"}")
echo "$CLOSE_RESULT" | python3 -m json.tool 2>/dev/null || echo "$CLOSE_RESULT"

# 4. Try to cancel pending limit orders
# Note: We need pair_index and index, so we'll try common values
echo ""
echo "4. Attempting to cancel pending limit orders..."
echo "   (Trying common pair indices 0-9 and order indices 0-4)"

CANCELLED=0
for pair_index in {0..9}; do
  for index in {0..4}; do
    RESULT=$(curl -s -X POST "${AVANTIS_API}/api/cancel-limit-order" \
      -H "Content-Type: application/json" \
      -d "{\"pair_index\": ${pair_index}, \"index\": ${index}, \"private_key\": \"${PRIVATE_KEY}\"}")
    
    # Check if successful (not an error)
    if echo "$RESULT" | grep -q "success.*true" || echo "$RESULT" | grep -q "tx_hash"; then
      echo "   ✅ Cancelled: pair_index=${pair_index}, index=${index}"
      echo "$RESULT" | python3 -m json.tool 2>/dev/null | head -5
      CANCELLED=$((CANCELLED + 1))
    fi
  done
done

if [ $CANCELLED -eq 0 ]; then
  echo "   No pending limit orders found to cancel."
else
  echo "   ✅ Cancelled ${CANCELLED} pending limit order(s)"
fi

echo ""
echo "=========================================="
echo "Done!"
echo "=========================================="
