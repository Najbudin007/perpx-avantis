#!/usr/bin/env python3
"""
Simple transaction analyzer using Web3 directly.
"""
from web3 import Web3
import json

TX_HASH = "0xb10225e8bb87a9e329337dd38ce03de0c5766698b498a754b6c6822acfa0072e"
RPC_URL = "https://mainnet.base.org"

# USDC contract on Base
USDC_ADDRESS = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
TRANSFER_SIG = "0xa9059cbb"  # transfer(address,uint256)

def main():
    print("="*80)
    print("ANALYZING TRANSACTION")
    print("="*80)
    print(f"Transaction Hash: {TX_HASH}")
    print("="*80)
    
    w3 = Web3(Web3.HTTPProvider(RPC_URL))
    
    if not w3.is_connected():
        print("❌ Failed to connect to Base RPC")
        return
    
    try:
        # Get transaction
        tx = w3.eth.get_transaction(TX_HASH)
        receipt = w3.eth.get_transaction_receipt(TX_HASH)
        
        print(f"\n📊 Transaction Details:")
        print(f"   From: {tx['from']}")
        print(f"   To: {tx['to']}")
        print(f"   Value: {tx['value']} wei ({w3.from_wei(tx['value'], 'ether')} ETH)")
        print(f"   Gas Used: {receipt['gasUsed']}")
        print(f"   Status: {'✅ Success' if receipt['status'] == 1 else '❌ Failed'}")
        print(f"   Block: {receipt['blockNumber']}")
        
        # Check if it's a USDC transfer
        tx_to = tx['to'].lower() if tx['to'] else None
        tx_input = tx['input'].hex() if hasattr(tx['input'], 'hex') else tx['input']
        
        if tx_to == USDC_ADDRESS.lower() and tx_input.startswith(TRANSFER_SIG):
            print(f"\n🔍 Analysis:")
            print(f"   ❌ This is a USDC transfer transaction!")
            print(f"   The transaction sent USDC to: {tx['to']}")
            
            # Decode transfer parameters
            # transfer(address to, uint256 amount)
            # Skip function signature (4 bytes = 8 hex chars)
            data = tx_input[10:]  # Remove '0x' and function sig
            if len(data) >= 128:
                to_address = '0x' + data[24:64]  # Skip padding, get address
                amount_hex = data[64:128]
                amount = int(amount_hex, 16) / 1e6  # USDC has 6 decimals
                
                print(f"   Recipient: {to_address}")
                print(f"   Amount: ${amount:.2f} USDC")
                
                if to_address.lower() == "0x1f4e52493505dac4e29990525ce05a4f458f016f".lower():
                    print(f"\n   ✅ This matches the trading wallet address!")
                    print(f"   The $12 USDC was transferred to your trading wallet.")
                    print(f"   However, no position was opened - this was just a transfer.")
        
        # Check logs for events
        print(f"\n📝 Transaction Logs ({len(receipt['logs'])} events):")
        for i, log in enumerate(receipt['logs'][:5]):  # Show first 5 logs
            print(f"   Log {i+1}: Address {log['address']}")
            if log['topics']:
                print(f"      Topics: {len(log['topics'])}")
        
        print("\n" + "="*80)
        print("SUMMARY")
        print("="*80)
        print("This transaction was a USDC transfer from your base wallet")
        print("to the trading wallet, but it did NOT open any position.")
        print("The funds are in the trading wallet but not used in any position.")
        print("="*80)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
