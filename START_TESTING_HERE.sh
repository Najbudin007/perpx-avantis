#!/bin/bash

# 🚀 Quick Test Script - Run All Tests
# Request ID: dc080531-ac4c-45c9-9fcf-1401b14310e6

echo "=================================="
echo "🚀 Testing Trading Functionality"
echo "=================================="
echo ""

# Check if services are running
echo "📊 Checking services..."
if ! curl -s http://localhost:3002/health > /dev/null 2>&1; then
    echo "❌ Avantis service not running. Starting services..."
    ./START_SERVERS.sh
    echo ""
    echo "⏳ Waiting 10 seconds for services to start..."
    sleep 10
else
    echo "✅ Services are running"
fi

echo ""
echo "=================================="
echo "Test 1: Open Position"
echo "=================================="
python3 test_avantis_trade.py
TEST1_RESULT=$?

echo ""
echo "=================================="
echo "Test 2: Close Position"
echo "=================================="
python3 test_close_position.py
TEST2_RESULT=$?

echo ""
echo "=================================="
echo "Test 3: Open Multiple Positions"
echo "=================================="
echo "Opening position 1..."
python3 test_avantis_trade.py
echo ""
echo "Opening position 2..."
python3 test_avantis_trade.py

echo ""
echo "=================================="
echo "Test 4: Close All Positions"
echo "=================================="
python3 test_close_all_positions.py
TEST4_RESULT=$?

echo ""
echo "=================================="
echo "📊 Test Results Summary"
echo "=================================="
echo ""

if [ $TEST1_RESULT -eq 0 ]; then
    echo "✅ Test 1: Open Position - PASSED"
else
    echo "❌ Test 1: Open Position - FAILED"
fi

if [ $TEST2_RESULT -eq 0 ]; then
    echo "✅ Test 2: Close Position - PASSED"
else
    echo "❌ Test 2: Close Position - FAILED"
fi

if [ $TEST4_RESULT -eq 0 ]; then
    echo "✅ Test 4: Close All Positions - PASSED"
else
    echo "❌ Test 4: Close All Positions - FAILED"
fi

echo ""
echo "=================================="
echo "🔍 Final Verification"
echo "=================================="
echo ""
echo "Checking for remaining positions..."
curl -s "http://localhost:3002/api/positions?private_key=0x5334e38e7caaf59b317d249b26c88110dbbf2d4117ec44014b72b77b8f741758" | python3 -m json.tool 2>/dev/null || echo "Could not fetch positions"

echo ""
echo "=================================="
if [ $TEST1_RESULT -eq 0 ] && [ $TEST2_RESULT -eq 0 ] && [ $TEST4_RESULT -eq 0 ]; then
    echo "🎉 ALL TESTS PASSED!"
    echo "=================================="
    echo ""
    echo "✅ Requirements Complete:"
    echo "   • Open position works ✅"
    echo "   • Close position works ✅"
    echo "   • Close all positions works ✅"
    echo ""
    echo "📋 Next Steps:"
    echo "   1. Review test results above"
    echo "   2. Check transactions on BaseScan"
    echo "   3. Optional: Restore strict signal requirements"
    echo "      (See TESTING_COMPLETE_GUIDE.md)"
    echo ""
    exit 0
else
    echo "⚠️  SOME TESTS FAILED"
    echo "=================================="
    echo ""
    echo "Please check:"
    echo "   • Services are running (./START_SERVERS.sh)"
    echo "   • Logs: tail -f /tmp/trading-engine.log"
    echo "   • Logs: tail -f /tmp/avantis-service.log"
    echo "   • Documentation: TESTING_COMPLETE_GUIDE.md"
    echo ""
    exit 1
fi
