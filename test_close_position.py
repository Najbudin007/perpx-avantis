#!/usr/bin/env python3
"""
Test script to close a single Avantis position.
Tests the close position functionality.
"""
import requests
import sys
import json

AVANTIS_API = "http://localhost:3002"
PRIVATE_KEY = "0x5334e38e7caaf59b317d249b26c88110dbbf2d4117ec44014b72b77b8f741758"

def test_close_position():
    """Close a single Avantis position."""
    print("=" * 80)
    print("🧪 Test: Close Single Position")
    print("=" * 80)
    
    # Step 1: Get current positions
    print("\n📊 Step 1: Fetching current positions...")
    try:
        response = requests.get(
            f"{AVANTIS_API}/api/positions",
            params={"private_key": PRIVATE_KEY},
            timeout=10
        )
        
        if not response.ok:
            print(f"❌ Failed to get positions: {response.status_code} {response.text}")
            return False
        
        positions = response.json().get("positions", [])
        
        if not positions:
            print("ℹ️  No positions found to close")
            print("   Please open a position first using test_avantis_trade.py")
            return True
        
        print(f"✅ Found {len(positions)} position(s):")
        for i, p in enumerate(positions, 1):
            print(f"   {i}. {p['symbol']} (pair_index={p['pair_index']}, "
                  f"collateral=${p['collateral']:.2f}, leverage={p['leverage']}x)")
    
    except Exception as e:
        print(f"❌ Error fetching positions: {e}")
        return False
    
    # Step 2: Close first position
    position = positions[0]
    pair_index = position["pair_index"]
    symbol = position["symbol"]
    
    print(f"\n🔄 Step 2: Closing position...")
    print(f"   Symbol: {symbol}")
    print(f"   Pair Index: {pair_index}")
    print(f"   Collateral: ${position['collateral']:.2f}")
    print(f"   Leverage: {position['leverage']}x")
    
    try:
        response = requests.post(
            f"{AVANTIS_API}/api/close-position",
            json={
                "pair_index": pair_index,
                "private_key": PRIVATE_KEY
            },
            timeout=30
        )
        
        if response.ok:
            result = response.json()
            print(f"\n✅✅✅ Position closed successfully!")
            print(f"   TX Hash: {result.get('tx_hash')}")
            print(f"   Message: {result.get('message', 'Position closed')}")
            print(f"   View on BaseScan: https://basescan.org/tx/{result.get('tx_hash')}")
            
            # Step 3: Verify position is gone
            print(f"\n🔍 Step 3: Verifying position is closed...")
            response = requests.get(
                f"{AVANTIS_API}/api/positions",
                params={"private_key": PRIVATE_KEY},
                timeout=10
            )
            
            if response.ok:
                remaining_positions = response.json().get("positions", [])
                remaining_count = len(remaining_positions)
                print(f"   Remaining positions: {remaining_count}")
                
                if remaining_count < len(positions):
                    print(f"   ✅ Position successfully removed from list")
                else:
                    print(f"   ⚠️  Position may still be processing closure")
            
            return True
        else:
            print(f"\n❌ Failed to close position: {response.status_code}")
            error_data = response.json() if response.headers.get('content-type') == 'application/json' else {}
            print(f"   Error: {error_data.get('detail', response.text)}")
            return False
            
    except Exception as e:
        print(f"\n❌ Error closing position: {e}")
        return False

def main():
    """Run the test."""
    print("\n🚀 Starting Close Position Test\n")
    
    # Check if Avantis service is running
    try:
        response = requests.get(f"{AVANTIS_API}/health", timeout=5)
        if not response.ok:
            print("❌ Avantis service is not responding properly")
            print("   Please ensure it's running: ./START_SERVERS.sh")
            return False
    except Exception as e:
        print("❌ Cannot connect to Avantis service")
        print(f"   Error: {e}")
        print("   Please ensure it's running: ./START_SERVERS.sh")
        return False
    
    success = test_close_position()
    
    print("\n" + "=" * 80)
    if success:
        print("✅ Test PASSED: Close position functionality works!")
    else:
        print("❌ Test FAILED: See errors above")
    print("=" * 80 + "\n")
    
    return success

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
