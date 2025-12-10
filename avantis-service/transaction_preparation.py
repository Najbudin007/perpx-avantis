"""Transaction preparation for Base Account signing."""
from typing import Optional, Dict, Any
from decimal import Decimal
from web3 import Web3
from symbols import get_pair_index, ensure_pair_map_initialized, SymbolNotFoundError
from config import settings
from direct_contracts import AvantisTradingContract, TradeParams
import logging

logger = logging.getLogger(__name__)


async def prepare_open_position_transaction(
    symbol: str,
    collateral: float,
    leverage: int,
    is_long: bool,
    address: str,
    tp: Optional[float] = None,
    sl: Optional[float] = None
) -> Dict[str, Any]:
    """
    Prepare transaction data for opening a position (Base Account).
    
    Args:
        symbol: Trading symbol (e.g., "BTC", "ETH")
        collateral: Collateral amount in USDC
        leverage: Leverage multiplier
        is_long: True for long, False for short
        address: Base Account address
        tp: Take profit price (optional)
        sl: Stop loss price (optional)
        
    Returns:
        Dictionary with transaction data for frontend signing
    """
    try:
        # Ensure pair map is initialized from SDK (if available) - sync wrapper
        from symbols.symbol_registry import ensure_pair_map_initialized_sync
        ensure_pair_map_initialized_sync()
        
        # Get pair index for symbol
        pair_index = get_pair_index(symbol)
        if pair_index is None:
            raise SymbolNotFoundError(f"Symbol {symbol} not found in registry")
        
        # Get RPC URL
        rpc_url = settings.get_effective_rpc_url()
        
        # Create trading contract instance (read-only, no private key)
        trading_contract = AvantisTradingContract(
            rpc_url=rpc_url,
            contract_address=settings.avantis_trading_contract_address,
            private_key=None  # Read-only for Base Account
        )
        
        # Convert values to on-chain units
        collateral_usdc_int = int(collateral * 1e6)  # USDC has 6 decimals
        tp_price = int(tp * 1e10) if tp else 0  # Price has 10 decimals
        sl_price = int(sl * 1e10) if sl else 0  # Price has 10 decimals
        
        # Build trade params
        params = TradeParams(
            trader=Web3.to_checksum_address(address),
            pair_index=pair_index,
            collateral_usdc=collateral_usdc_int,
            leverage=leverage,
            is_long=is_long,
            tp_price=tp_price,
            sl_price=sl_price,
            open_price=0,  # market order
            index=0,
            initial_pos_token=0,
            timestamp=0,
        )
        
        # Build trade struct
        trade_struct = trading_contract.build_trade_struct(params)
        
        # Get function and encode
        order_type = 0  # MARKET order
        slippage_p = int(1.0 * 1e8)  # 1% slippage default
        execution_fee_wei = int(0.0001 * 1e18)  # Default execution fee
        
        fn = trading_contract.open_trade_function(trade_struct, order_type, slippage_p)
        
        # Build transaction (without signing)
        tx = trading_contract.build_transaction(
            fn=fn,
            from_address=address,
            value_wei=execution_fee_wei
        )
        
        # Encode the function call
        encoded_data = fn.encodeABI()
        
        # Prepare transaction data for frontend
        transaction_data = {
            'to': trading_contract.contract_address,
            'data': encoded_data,
            'value': hex(execution_fee_wei),
            'from': address,
            'chainId': trading_contract.web3.eth.chain_id,
        }
        
        # Add gas if available
        if 'gas' in tx:
            transaction_data['gas'] = hex(tx['gas'])
        
        return {
            'success': True,
            'transaction': transaction_data,
            'params': {
                'symbol': symbol,
                'pair_index': pair_index,
                'collateral': collateral,
                'leverage': leverage,
                'is_long': is_long,
                'take_profit': tp,
                'stop_loss': sl,
            },
            'address': address,
            'note': 'Sign this transaction via Base Account SDK on the frontend using eth_sendTransaction'
        }
        
    except SymbolNotFoundError as e:
        logger.error(f"Symbol not found: {e}")
        raise
    except Exception as e:
        logger.error(f"Error preparing open position transaction: {e}", exc_info=True)
        raise


async def prepare_close_position_transaction(
    pair_index: int,
    address: str
) -> Dict[str, Any]:
    """
    Prepare transaction data for closing a position (Base Account).
    
    Args:
        pair_index: Avantis pair index
        address: Base Account address
        
    Returns:
        Dictionary with transaction data for frontend signing
    """
    try:
        # Get RPC URL
        rpc_url = settings.get_effective_rpc_url()
        
        # Create trading contract instance (read-only, no private key)
        trading_contract = AvantisTradingContract(
            rpc_url=rpc_url,
            contract_address=settings.avantis_trading_contract_address,
            private_key=None  # Read-only for Base Account
        )
        
        # Get position size from TradingStorage
        from contract_operations import _get_trading_storage_contract
        storage = _get_trading_storage_contract(rpc_url)
        
        # Read position to get amount
        try:
            trade = storage.functions.openTrades(
                Web3.to_checksum_address(address),
                int(pair_index),
                0  # Default to first trade index
            ).call()
            
            if trade[0] == "0x0000000000000000000000000000000000000000":
                raise ValueError(f"No open position found for pair_index={pair_index}")
            
            position_size_usdc = int(trade[4])  # positionSizeUSDC
        except Exception as e:
            logger.warning(f"Could not read position size: {e}, using full position")
            # Fallback: use a large amount (will close full position)
            position_size_usdc = 2**256 - 1
        
        # Build transaction
        execution_fee_wei = int(0.0001 * 1e18)  # Default execution fee
        fn = trading_contract.close_trade_market_function(
            pair_index=pair_index,
            index=0,  # Default to first trade index
            amount=position_size_usdc
        )
        
        # Build transaction (without signing)
        tx = trading_contract.build_transaction(
            fn=fn,
            from_address=address,
            value_wei=execution_fee_wei
        )
        
        # Encode the function call
        encoded_data = fn.encodeABI()
        
        # Prepare transaction data for frontend
        transaction_data = {
            'to': trading_contract.contract_address,
            'data': encoded_data,
            'value': hex(execution_fee_wei),
            'from': address,
            'chainId': trading_contract.web3.eth.chain_id,
        }
        
        # Add gas if available
        if 'gas' in tx:
            transaction_data['gas'] = hex(tx['gas'])
        
        return {
            'success': True,
            'transaction': transaction_data,
            'params': {
                'pair_index': pair_index,
            },
            'address': address,
            'note': 'Sign this transaction via Base Account SDK on the frontend using eth_sendTransaction'
        }
        
    except Exception as e:
        logger.error(f"Error preparing close position transaction: {e}", exc_info=True)
        raise


async def prepare_approve_usdc_transaction(
    amount: float,
    address: str
) -> Dict[str, Any]:
    """
    Prepare transaction data for USDC approval (Base Account).
    
    Args:
        amount: Amount to approve (0 for unlimited)
        address: Base Account address
        
    Returns:
        Dictionary with transaction data for frontend signing
    """
    try:
        # Get RPC URL
        rpc_url = settings.get_effective_rpc_url()
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        if not w3.is_connected():
            raise RuntimeError(f"Web3 provider not reachable: {rpc_url}")
        
        # USDC token address from config
        # Use avantis_usdc_spender_address (TradingCallbacks) - this is the contract
        # that actually calls transferFrom, NOT the Trading contract!
        usdc_address = Web3.to_checksum_address(settings.usdc_token_address)
        spender_address = Web3.to_checksum_address(settings.avantis_usdc_spender_address)
        
        # Convert amount to wei (USDC has 6 decimals)
        if amount == 0:
            amount_wei = 2**256 - 1  # Max uint256 for unlimited
        else:
            amount_wei = int(amount * 1e6)
        
        # USDC approve ABI
        usdc_abi = [
            {
                "constant": False,
                "inputs": [
                    {"name": "_spender", "type": "address"},
                    {"name": "_value", "type": "uint256"}
                ],
                "name": "approve",
                "outputs": [{"name": "", "type": "bool"}],
                "type": "function"
            }
        ]
        
        usdc_contract = w3.eth.contract(address=usdc_address, abi=usdc_abi)
        
        # Build transaction
        fn = usdc_contract.functions.approve(spender_address, amount_wei)
        
        # Estimate gas
        try:
            gas = w3.eth.estimate_gas({
                "from": address,
                "to": usdc_address,
                "data": fn.encodeABI()
            })
        except Exception as e:
            logger.warning(f"Gas estimation failed: {e}, using default")
            gas = 100000  # Default gas limit for approve
        
        # Encode the function call
        encoded_data = fn.encodeABI()
        
        # Prepare transaction data for frontend
        transaction_data = {
            'to': usdc_address,
            'data': encoded_data,
            'value': '0x0',
            'from': address,
            'chainId': w3.eth.chain_id,
            'gas': hex(gas),
        }
        
        return {
            'success': True,
            'transaction': transaction_data,
            'params': {
                'amount': amount,
                'amount_wei': amount_wei,
                'spender': spender_address,
            },
            'address': address,
            'note': 'Sign this transaction via Base Account SDK on the frontend using eth_sendTransaction'
        }
        
    except Exception as e:
        logger.error(f"Error preparing approve USDC transaction: {e}", exc_info=True)
        raise

