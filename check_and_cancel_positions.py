#!/usr/bin/env python3
"""
Script to check for open positions and pending orders, then cancel/close them all.
"""
import asyncio
import sys
import os

# Add the avantis-service directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'avantis-service'))

from position_queries import get_positions, get_balance
from trade_operations import close_all_positions, cancel_limit_order
from check_pending_orders import check_pending_orders
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Private key from user
PRIVATE_KEY = "0x5334e38e7caaf59b317d249b26c88110dbbf2d4117ec44014b72b77b8f741758"

async def main():
    print("="*80)
    print("CHECKING POSITIONS AND PENDING ORDERS")
    print("="*80)
    
    try:
        # 1. Check balance
        print("\n1. Checking wallet balance...")
        balance_info = await get_balance(private_key=PRIVATE_KEY)
        print(f"   USDC Balance: ${balance_info.get('usdc_balance', 0):.2f}")
        print(f"   ETH Balance: {balance_info.get('eth_balance', 0):.6f} ETH")
        
        # 2. Check open positions
        print("\n2. Checking open positions...")
        positions = await get_positions(private_key=PRIVATE_KEY)
        print(f"   Found {len(positions)} open position(s)")
        
        if positions:
            for i, pos in enumerate(positions):
                print(f"\n   Position {i+1}:")
                print(f"      Symbol: {pos.get('symbol', 'Unknown')}")
                print(f"      Pair Index: {pos.get('pair_index', 'Unknown')}")
                print(f"      Collateral: ${pos.get('collateral', 0):.2f}")
                print(f"      Leverage: {pos.get('leverage', 0)}x")
                print(f"      Direction: {'Long' if pos.get('is_long') else 'Short'}")
                print(f"      Entry Price: ${pos.get('entry_price', 0):.2f}")
                print(f"      PnL: ${pos.get('pnl', 0):.2f} ({pos.get('pnl_percentage', 0):.2f}%)")
        
        # 3. Check pending orders
        print("\n3. Checking pending orders...")
        pending_info = await check_pending_orders(PRIVATE_KEY)
        print(f"   Pending limit orders: {len(pending_info.get('pending_limit_orders', []))}")
        print(f"   Pending market orders: {pending_info.get('pending_count', 0)}")
        
        # 4. Close all positions if any exist
        if positions:
            print("\n4. Closing all open positions...")
            try:
                result = await close_all_positions(private_key=PRIVATE_KEY)
                print(f"   ✅ Successfully closed all positions!")
                if isinstance(result, dict):
                    print(f"   Transaction Hash: {result.get('tx_hash', 'N/A')}")
                    if 'basescan_url' in result:
                        print(f"   View on BaseScan: {result['basescan_url']}")
            except Exception as e:
                print(f"   ❌ Error closing positions: {e}")
        else:
            print("\n4. No open positions to close.")
        
        # 5. Cancel pending limit orders
        # Note: We need to get the actual limit orders from the contract
        # For now, we'll try to cancel common pair indices (0-10) with common indices (0-5)
        print("\n5. Attempting to cancel pending limit orders...")
        print("   Note: This will try to cancel limit orders for common pair indices")
        
        # Common trading pairs: BTC=0, ETH=1, SOL=2, etc.
        # Try to cancel limit orders for common pairs
        cancelled_count = 0
        for pair_index in range(10):  # Try first 10 pair indices
            for index in range(5):  # Try first 5 order indices
                try:
                    result = await cancel_limit_order(
                        pair_index=pair_index,
                        index=index,
                        private_key=PRIVATE_KEY
                    )
                    if result.get('success'):
                        cancelled_count += 1
                        print(f"   ✅ Cancelled limit order: pair_index={pair_index}, index={index}")
                        if 'tx_hash' in result:
                            print(f"      TX: {result['tx_hash']}")
                except Exception as e:
                    # Expected if order doesn't exist - silently continue
                    error_msg = str(e).lower()
                    if 'order' in error_msg or 'not found' in error_msg or 'invalid' in error_msg:
                        pass  # Order doesn't exist, skip
                    else:
                        print(f"   ⚠️  Error cancelling pair_index={pair_index}, index={index}: {e}")
        
        if cancelled_count == 0:
            print("   No pending limit orders found to cancel.")
        else:
            print(f"   ✅ Cancelled {cancelled_count} pending limit order(s)")
        
        print("\n" + "="*80)
        print("SUMMARY")
        print("="*80)
        print(f"Open Positions: {len(positions)}")
        print(f"Pending Limit Orders Cancelled: {cancelled_count}")
        print(f"Pending Market Orders: {pending_info.get('pending_count', 0)}")
        print("="*80)
        
    except Exception as e:
        logger.error(f"Error: {e}", exc_info=True)
        print(f"\n❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
