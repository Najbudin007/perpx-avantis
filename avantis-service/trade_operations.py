"""Trade execution operations."""
from typing import Optional, Dict, Any
from avantis_client import get_avantis_client
from symbols import get_pair_index, ensure_pair_map_initialized, SymbolNotFoundError
from config import settings
from utils import retry_on_network_error
from contract_operations import (
    open_position_via_contract,
    close_position_via_contract,
    close_all_positions_via_contract,
    update_tp_sl_via_contract,
    update_margin_via_contract,
    cancel_open_limit_order_via_contract,
)
from position_queries import get_usdc_allowance, approve_usdc
import logging

logger = logging.getLogger(__name__)


@retry_on_network_error()
async def open_position(
    symbol: str,
    collateral: float,
    leverage: int,
    is_long: bool,
    tp: Optional[float] = None,
    sl: Optional[float] = None,
    private_key: str = ""
) -> Dict[str, Any]:
    """
    Open a trading position for a user.
    
    Args:
        symbol: Trading symbol (e.g., "BTC", "ETH")
        collateral: Collateral amount in USDC
        leverage: Leverage multiplier (e.g., 10 for 10x)
        is_long: True for long position, False for short
        tp: Take profit price (optional)
        sl: Stop loss price (optional)
        private_key: User's private key (required - each user provides their own)
        
    Returns:
        Dictionary with operation result
    """
    logger.info("="*80)
    logger.info("🚀 [TRACE] open_position() CALLED")
    logger.info(f"   Symbol: {symbol}, Collateral: ${collateral}, Leverage: {leverage}x, Long: {is_long}")
    logger.info("="*80)
    
    if not private_key:
        raise ValueError("Private key is required. Each user must provide their own private key.")
    
    try:
        # CRITICAL: Verify private key derives to expected address BEFORE creating client
        from eth_account import Account
        from web3 import Web3
        
        # Derive address from private key
        account = Account.from_key(private_key)
        derived_address = account.address
        
        logger.info(f"🔍 [TRADE_OPS] Private key provided: {private_key[:10]}...{private_key[-4:]}")
        logger.info(f"🔍 [TRADE_OPS] Derived address from private key: {derived_address}")
        logger.info(f"🔍 [TRADE_OPS] This address will be used for trading operations")
        
        # Get Avantis client
        client = get_avantis_client(private_key=private_key)
        
        # Verify client address matches derived address
        client_address = client.get_address()
        if client_address.lower() != derived_address.lower():
            logger.error(f"❌ [TRADE_OPS] ADDRESS MISMATCH!")
            logger.error(f"   Derived from PK: {derived_address}")
            logger.error(f"   Client address: {client_address}")
            raise ValueError(f"Address mismatch: Private key derives to {derived_address} but client shows {client_address}")
        
        logger.info(f"✅ [TRADE_OPS] Address verified: {client_address}")
        
        # Ensure pair map is initialized from SDK (if available)
        # Use the async initializer because we're already in an async context;
        # the sync wrapper skips SDK refresh when an event loop is running.
        from symbols.symbol_registry import ensure_pair_map_initialized
        await ensure_pair_map_initialized()
        
        # Get pair index from our cached registry
        pair_index = get_pair_index(symbol)
        if pair_index is None:
            raise SymbolNotFoundError(f"Symbol {symbol} not found in registry")
        logger.info(f"Using pair index: {pair_index} for {symbol}")
        
        # Check and approve USDC if needed
        await _ensure_usdc_approval(private_key, collateral)
        
        # Open position using direct contract calls
        result = await open_position_via_contract(
            pair_index=pair_index,
            collateral_amount=collateral,
            leverage=leverage,
            is_long=is_long,
            take_profit=tp,
            stop_loss=sl,
            slippage_percentage=1.0,  # Default 1% slippage
            private_key=private_key
        )
        
        logger.info(f"Opened position: {symbol} | {('LONG' if is_long else 'SHORT')} | "
                   f"Collateral: ${collateral} | Leverage: {leverage}x")
        
        tx_hash = result.get("tx_hash") if isinstance(result, dict) else str(result)
        return {
            "success": True,
            "pair_index": pair_index,
            "symbol": symbol,
            "is_long": is_long,
            "collateral": collateral,
            "leverage": leverage,
            "tx_hash": tx_hash,
            "transaction_hash": tx_hash,  # Frontend compatibility
            "status": result.get("status", "pending") if isinstance(result, dict) else "pending"
        }
        
    except SymbolNotFoundError as e:
        logger.error(f"Symbol not found: {e}")
        raise
    except Exception as e:
        logger.error(f"Error opening position: {e}")
        raise


@retry_on_network_error()
async def close_position(
    pair_index: int,
    private_key: str
) -> Dict[str, Any]:
    """
    Close a specific position by pair index for a user.
    
    Args:
        pair_index: Avantis pair index
        private_key: User's private key (required - each user provides their own)
        
    Returns:
        Dictionary with operation result
    """
    try:
        # Close position using direct contract calls
        # Note: trade_index defaults to 0 (first position for the pair)
        result = await close_position_via_contract(
            pair_index=pair_index,
            trade_index=0,  # Default to first trade index
            private_key=private_key
        )
        
        logger.info(f"Closed position: pair_index={pair_index}")
        
        tx_hash = result.get("tx_hash") if isinstance(result, dict) else str(result)
        return {
            "success": True,
            "pair_index": pair_index,
            "tx_hash": tx_hash,
            "transaction_hash": tx_hash,  # Frontend compatibility
            "status": result.get("status", "pending") if isinstance(result, dict) else "pending"
        }
        
    except Exception as e:
        logger.error(f"Error closing position: {e}")
        raise


@retry_on_network_error()
async def close_all_positions(
    private_key: str
) -> Dict[str, Any]:
    """
    Close all open positions for a user.
    
    Args:
        private_key: User's private key (required - each user provides their own)
        
    Returns:
        Dictionary with operation result
    """
    try:
        # Close all positions using direct contract calls
        result = await close_all_positions_via_contract(private_key=private_key)
        
        # Get address for logging
        from eth_account import Account
        account = Account.from_key(private_key)
        address = account.address
        
        logger.info(f"Closed all positions for address: {address}")
        
        return {
            "success": True,
            "closed_count": result.get("closed_count", 0) if isinstance(result, dict) else 0,
            "tx_hashes": result.get("tx_hashes", []) if isinstance(result, dict) else [],
            "total_pnl": result.get("total_pnl", 0) if isinstance(result, dict) else 0
        }
        
    except Exception as e:
        logger.error(f"Error closing all positions: {e}")
        raise


async def _ensure_usdc_approval(private_key: str, amount: float) -> None:
    """
    🔐 SAFE USDC Approval Check
    
    Ensure USDC is approved for trading using direct Web3 calls.
    Uses the safe get_usdc_allowance and approve_usdc functions.
    
    Args:
        private_key: User's private key
        amount: Amount to approve
    """
    try:
        # Use safe function to check current allowance
        try:
            allowance = await get_usdc_allowance(private_key=private_key)
        except Exception as e:
            logger.warning(f"Could not check USDC allowance: {e}. Assuming approval needed.")
            allowance = 0
        
        # Approve slightly more than needed to account for fees and rounding
        # Approve 110% of amount to ensure we have enough allowance
        approval_amount = amount * 1.1
        
        if allowance < amount:
            # Use safe function to approve USDC
            logger.info(f"🔐 SAFE: Approving USDC: {approval_amount:.2f} (current allowance: {allowance}, required: {amount})")
            
            try:
                result = await approve_usdc(
                    amount=approval_amount,  # Approve 110% to ensure enough allowance
                    private_key=private_key
                )
                
                # Wait for confirmation if not already confirmed
                if not result.get('confirmed'):
                    logger.info(f"⏳ Waiting for USDC approval confirmation...")
                    import asyncio
                    await asyncio.sleep(3)  # Wait 3 seconds for confirmation
                
                logger.info(f"✅ SAFE USDC approval successful and confirmed: {result.get('tx_hash', 'N/A')}")
            except Exception as approval_error:
                logger.error(f"❌ SAFE approval failed: {approval_error}")
                raise ValueError(f"USDC approval failed: {approval_error}")
        else:
            logger.debug(f"USDC allowance sufficient: {allowance} >= {amount}")
            
    except Exception as e:
        logger.error(f"USDC approval check failed: {e}")
        # Don't continue - approval is critical for trading
        raise


@retry_on_network_error()
async def update_tp_sl(
    pair_index: int,
    trade_index: int,
    new_tp: Optional[float],
    new_sl: Optional[float],
    private_key: str,
) -> Dict[str, Any]:
    """
    Update take profit and/or stop loss for a position.
    
    Args:
        pair_index: Avantis pair index
        trade_index: Trade index (defaults to 0 for first position)
        new_tp: New take profit price (optional)
        new_sl: New stop loss price (optional)
        private_key: User's private key (required - each user provides their own)
        
    Returns:
        Dictionary with operation result
    """
    if not private_key:
        raise ValueError("Private key is required. Each user must provide their own private key.")
    
    if new_tp is None and new_sl is None:
        raise ValueError("At least one of new_tp or new_sl must be provided.")
    
    try:
        result = await update_tp_sl_via_contract(
            pair_index=pair_index,
            trade_index=trade_index,
            new_tp=new_tp,
            new_sl=new_sl,
            private_key=private_key,
        )
        
        logger.info(f"Updated TP/SL: pair_index={pair_index}, trade_index={trade_index}")
        
        return {
            "success": True,
            "pair_index": pair_index,
            "trade_index": trade_index,
            "new_tp": new_tp,
            "new_sl": new_sl,
            "tx_hash": result.get("tx_hash") if isinstance(result, dict) else str(result),
            "status": result.get("status", "pending") if isinstance(result, dict) else "pending"
        }
        
    except Exception as e:
        logger.error(f"Error updating TP/SL: {e}")
        raise


@retry_on_network_error()
async def update_margin(
    pair_index: int,
    trade_index: int,
    update_type: int,
    amount_usdc: float,
    private_key: str,
) -> Dict[str, Any]:
    """
    Update margin (deposit or withdraw) for a position.
    
    Args:
        pair_index: Avantis pair index
        trade_index: Trade index (defaults to 0 for first position)
        update_type: 0 = DEPOSIT, 1 = WITHDRAW
        amount_usdc: Amount in USDC
        private_key: User's private key (required - each user provides their own)
        
    Returns:
        Dictionary with operation result
    """
    if not private_key:
        raise ValueError("Private key is required. Each user must provide their own private key.")
    
    if update_type not in [0, 1]:
        raise ValueError("update_type must be 0 (DEPOSIT) or 1 (WITHDRAW)")
    
    if amount_usdc <= 0:
        raise ValueError("Amount must be greater than 0")
    
    try:
        result = await update_margin_via_contract(
            pair_index=pair_index,
            trade_index=trade_index,
            update_type=update_type,
            amount_usdc=amount_usdc,
            private_key=private_key,
        )
        
        logger.info(
            f"Updated margin: pair_index={pair_index}, trade_index={trade_index}, "
            f"type={'DEPOSIT' if update_type == 0 else 'WITHDRAW'}, amount=${amount_usdc}"
        )
        
        return {
            "success": True,
            "pair_index": pair_index,
            "trade_index": trade_index,
            "update_type": "DEPOSIT" if update_type == 0 else "WITHDRAW",
            "amount_usdc": amount_usdc,
            "tx_hash": result.get("tx_hash") if isinstance(result, dict) else str(result),
            "status": result.get("status", "pending") if isinstance(result, dict) else "pending"
        }
        
    except Exception as e:
        logger.error(f"Error updating margin: {e}")
        raise


@retry_on_network_error()
async def cancel_limit_order(
    pair_index: int,
    index: int,
    private_key: str,
) -> Dict[str, Any]:
    """
    Cancel an open limit order.
    
    Args:
        pair_index: Avantis pair index
        index: Limit order index
        private_key: User's private key (required - each user provides their own)
        
    Returns:
        Dictionary with operation result
    """
    if not private_key:
        raise ValueError("Private key is required. Each user must provide their own private key.")
    
    try:
        result = await cancel_open_limit_order_via_contract(
            pair_index=pair_index,
            index=index,
            private_key=private_key,
        )
        
        logger.info(f"Canceled limit order: pair_index={pair_index}, index={index}")
        
        return {
            "success": True,
            "pair_index": pair_index,
            "index": index,
            "tx_hash": result.get("tx_hash") if isinstance(result, dict) else str(result),
            "status": result.get("status", "pending") if isinstance(result, dict) else "pending"
        }
        
    except Exception as e:
        logger.error(f"Error canceling limit order: {e}")
        raise

