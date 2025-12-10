#!/usr/bin/env python3
"""
Test script to close all Avantis positions.
Tests the close all positions functionality.
"""
import requests
import sys
import json
import time

AVANTIS_API = "http://localhost:3002"
PRIVATE_KEY = "0x5334e38e7caaf59b317d249b26c88110dbbf2d4117ec44014b72b77b8f741758"

def test_close_all_positions():
    """Close all Avantis positions."""
    print("=" * 80)
    print("🧪 Test: Close All Positions")
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
            print("   Please open positions first using test_avantis_trade.py")
            return True
        
        print(f"✅ Found {len(positions)} position(s) to close:")
        for i, p in enumerate(positions, 1):
            pnl_emoji = "📈" if p.get('pnl', 0) >= 0 else "📉"
            print(f"   {i}. {p['symbol']} (pair_index={p['pair_index']}) - "
                  f"${p['collateral']:.2f} @ {p['leverage']}x {pnl_emoji} PnL: ${p.get('pnl', 0):.2f}")
    
    except Exception as e:
        print(f"❌ Error fetching positions: {e}")
        return False
    
    # Step 2: Close all positions
    print(f"\n🔄 Step 2: Closing all {len(positions)} position(s)...")
    
    success_count = 0
    failed_count = 0
    results = []
    
    for i, position in enumerate(positions, 1):
        pair_index = position["pair_index"]
        symbol = position["symbol"]
        
        print(f"\n   [{i}/{len(positions)}] Closing {symbol} (pair_index={pair_index})...")
        
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
                tx_hash = result.get('tx_hash', 'N/A')
                print(f"   ✅ Closed {symbol}")
                print(f"      TX: {tx_hash[:20]}...{tx_hash[-4:]}" if tx_hash != 'N/A' else "      TX: N/A")
                success_count += 1
                results.append({
                    'symbol': symbol,
                    'pair_index': pair_index,
                    'status': 'success',
                    'tx_hash': tx_hash
                })
            else:
                error_text = response.text[:100]
                print(f"   ❌ Failed to close {symbol}: {error_text}")
                failed_count += 1
                results.append({
                    'symbol': symbol,
                    'pair_index': pair_index,
                    'status': 'failed',
                    'error': error_text
                })
            
            # Small delay between closes to avoid overwhelming the API
            if i < len(positions):
                time.sleep(1)
                
        except Exception as e:
            print(f"   ❌ Error closing {symbol}: {e}")
            failed_count += 1
            results.append({
                'symbol': symbol,
                'pair_index': pair_index,
                'status': 'error',
                'error': str(e)
            })
    
    # Step 3: Verify all positions are closed
    print(f"\n🔍 Step 3: Verifying all positions are closed...")
    time.sleep(2)  # Give the blockchain time to process
    
    try:
        response = requests.get(
            f"{AVANTIS_API}/api/positions",
            params={"private_key": PRIVATE_KEY},
            timeout=10
        )
        
        if response.ok:
            remaining_positions = response.json().get("positions", [])
            remaining_count = len(remaining_positions)
            print(f"   Remaining positions: {remaining_count}")
            
            if remaining_count == 0:
                print(f"   ✅ All positions successfully closed!")
            elif remaining_count < len(positions):
                print(f"   ⚠️  {remaining_count} position(s) still open (may be processing)")
                for p in remaining_positions:
                    print(f"      - {p['symbol']} (pair_index={p['pair_index']})")
            else:
                print(f"   ❌ No positions were closed")
    
    except Exception as e:
        print(f"   ⚠️  Could not verify remaining positions: {e}")
    
    # Summary
    print("\n" + "=" * 80)
    print("📊 SUMMARY")
    print("=" * 80)
    print(f"   Total Positions: {len(positions)}")
    print(f"   ✅ Successfully Closed: {success_count}")
    print(f"   ❌ Failed: {failed_count}")
    
    if success_count > 0:
        print(f"\n   Transaction Hashes:")
        for r in results:
            if r['status'] == 'success':
                print(f"   • {r['symbol']} (pair_index={r['pair_index']})")
                print(f"     TX: https://basescan.org/tx/{r['tx_hash']}")
    
    if failed_count > 0:
        print(f"\n   Failed Closures:")
        for r in results:
            if r['status'] in ['failed', 'error']:
                print(f"   • {r['symbol']} (pair_index={r['pair_index']})")
                print(f"     Error: {r.get('error', 'Unknown')}")
    
    return failed_count == 0

def main():
    """Run the test."""
    print("\n🚀 Starting Close All Positions Test\n")
    
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
    
    success = test_close_all_positions()
    
    print("\n" + "=" * 80)
    if success:
        print("✅ Test PASSED: Close all positions functionality works!")
    else:
        print("❌ Test FAILED: Some positions could not be closed")
    print("=" * 80 + "\n")
    
    return success

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
