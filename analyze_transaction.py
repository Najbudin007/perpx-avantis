#!/usr/bin/env python3
"""
Analyze the transaction hash to understand what happened.
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'avantis-service'))

from check_pending_orders import diagnose_failed_position
import asyncio

TX_HASH = "0xb10225e8bb87a9e329337dd38ce03de0c5766698b498a754b6c6822acfa0072e"
PRIVATE_KEY = "0x5334e38e7caaf59b317d249b26c88110dbbf2d4117ec44014b72b77b8f741758"

async def main():
    print("="*80)
    print("ANALYZING TRANSACTION")
    print("="*80)
    print(f"Transaction Hash: {TX_HASH}")
    print("="*80)
    
    try:
        result = await diagnose_failed_position(TX_HASH, PRIVATE_KEY)
        
        print("\n📊 Transaction Analysis:")
        print(f"   Status: {result.get('status', 'Unknown')}")
        print(f"   Block Number: {result.get('block_number', 'Unknown')}")
        print(f"   Gas Used: {result.get('gas_used', 'Unknown')}")
        print(f"   To Address: {result.get('to_address', 'Unknown')}")
        
        if 'order_id' in result:
            print(f"   Order ID: {result.get('order_id', 'Unknown')}")
        
        print("\n🔍 Diagnosis:")
        for diag in result.get('diagnosis', []):
            print(f"   {diag}")
        
        print("\n" + "="*80)
        
    except Exception as e:
        print(f"\n❌ Error analyzing transaction: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
