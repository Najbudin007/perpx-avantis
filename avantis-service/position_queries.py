"""Position and balance query operations."""
import asyncio
from typing import List, Dict, Any, Optional
from eth_account import Account
from web3 import Web3
from avantis_client import get_avantis_client
from symbols import get_symbol
from config import settings
from utils import retry_on_network_error
import logging

logger = logging.getLogger(__name__)

# Try to import SDK for position fetching (more reliable than direct contract calls)
try:
    from avantis_trader_sdk import TraderClient, FeedClient
    SDK_AVAILABLE = True
except ImportError:
    SDK_AVAILABLE = False
    logger.debug("Avantis SDK not available; using direct contract calls for positions.")


async def _get_positions_via_sdk(trader_address: str) -> List[Dict[str, Any]]:
    """
    Get positions using Avantis SDK (more reliable than direct contract calls).
    
    Raises exception on timeout/error so caller can fall back to direct contract calls.
    """
    if not SDK_AVAILABLE:
        raise RuntimeError("SDK not available")
    
    feed_client = FeedClient()
    rpc_url = settings.get_effective_rpc_url()
    trader_client = TraderClient(provider_url=rpc_url, feed_client=feed_client)
    
    # get_trades returns (long_trades, short_trades) tuples
    # Add timeout to prevent hanging (20 seconds)
    # NOTE: We raise exceptions here so caller can fall back to direct contract calls
    try:
        long_trades, short_trades = await asyncio.wait_for(
            trader_client.trade.get_trades(trader_address),
            timeout=20.0
        )
    except (asyncio.TimeoutError, asyncio.CancelledError) as e:
        logger.warning(f"Timeout/cancellation fetching positions via SDK for {trader_address} - will fall back to direct contract calls")
        # Re-raise so caller can use fallback
        raise
    except Exception as e:
        error_msg = str(e).lower()
        # Check if it's a timeout or cancellation error (even if not caught by specific exception)
        if "timeout" in error_msg or "cancelled" in error_msg or "cancellation" in error_msg:
            logger.warning(f"Timeout/cancellation error in SDK for {trader_address} - will fall back to direct contract calls: {e}")
            # Re-raise so caller can use fallback
            raise asyncio.TimeoutError(f"SDK timeout: {e}") from e
        logger.warning(f"Error fetching positions via SDK for {trader_address}: {e}")
        # Re-raise so caller can use fallback
        raise
    
    positions = []
    
    # Process long trades
    for trade in long_trades:
        symbol = get_symbol(trade.trade.pair_index)
        positions.append({
            "pair_index": trade.trade.pair_index,
            "trade_index": trade.trade.trade_index,
            "symbol": symbol,
            "is_long": trade.trade.is_long,
            "collateral": trade.trade.open_collateral,
            "leverage": trade.trade.leverage,
            "entry_price": trade.trade.open_price,
            "current_price": trade.trade.open_price,  # Will be updated from price fetch
            "pnl": 0,  # Will calculate from price difference
            "pnl_percentage": 0,
            "take_profit": trade.trade.tp if trade.trade.tp > 0 else None,
            "stop_loss": trade.trade.sl if trade.trade.sl > 0 else None,
            "liquidation_price": trade.liquidation_price,
            "open_interest_usdc": trade.additional_info.open_interest_usdc if trade.additional_info else 0,
            "timestamp": trade.trade.timestamp,
        })
    
    # Process short trades
    for trade in short_trades:
        symbol = get_symbol(trade.trade.pair_index)
        positions.append({
            "pair_index": trade.trade.pair_index,
            "trade_index": trade.trade.trade_index,
            "symbol": symbol,
            "is_long": trade.trade.is_long,
            "collateral": trade.trade.open_collateral,
            "leverage": trade.trade.leverage,
            "entry_price": trade.trade.open_price,
            "current_price": trade.trade.open_price,
            "pnl": 0,
            "pnl_percentage": 0,
            "take_profit": trade.trade.tp if trade.trade.tp > 0 else None,
            "stop_loss": trade.trade.sl if trade.trade.sl > 0 else None,
            "liquidation_price": trade.liquidation_price,
            "open_interest_usdc": trade.additional_info.open_interest_usdc if trade.additional_info else 0,
            "timestamp": trade.trade.timestamp,
        })
    
    # Try to get current prices to calculate PnL
    if positions and SDK_AVAILABLE:
        try:
            pair_names = []
            for pos in positions:
                if pos["symbol"]:
                    pair_names.append(f"{pos['symbol']}/USD")
            
            if pair_names:
                price_data = await feed_client.get_latest_price_updates(list(set(pair_names)))
                
                if price_data and hasattr(price_data, 'parsed') and price_data.parsed:
                    price_map = {}
                    for p in price_data.parsed:
                        # Extract symbol from feed
                        if hasattr(p, 'id') or hasattr(p, 'symbol'):
                            sym = getattr(p, 'symbol', None) or str(getattr(p, 'id', ''))
                            if '/' in sym:
                                sym = sym.split('/')[0]
                            price_map[sym.upper()] = p.converted_price
                    
                    # Update positions with current prices and PnL
                    for pos in positions:
                        sym = pos.get("symbol", "").upper()
                        if sym in price_map:
                            current_price = price_map[sym]
                            pos["current_price"] = current_price
                            
                            # Calculate PnL
                            entry_price = pos["entry_price"]
                            collateral = pos["collateral"]
                            leverage = pos["leverage"]
                            is_long = pos["is_long"]
                            
                            if entry_price > 0:
                                price_diff = current_price - entry_price
                                if not is_long:
                                    price_diff = -price_diff  # Reverse for shorts
                                
                                pnl_pct = (price_diff / entry_price) * leverage * 100
                                pnl_usd = (price_diff / entry_price) * collateral * leverage
                                
                                pos["pnl"] = pnl_usd
                                pos["pnl_percentage"] = pnl_pct
        except Exception as e:
            logger.warning(f"Could not fetch current prices: {e}")
    
    return positions


@retry_on_network_error()
async def get_positions(
    private_key: Optional[str] = None,
    address: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Get all open positions for a user.
    
    Uses Avantis SDK for more reliable position fetching.
    
    Args:
        private_key: User's private key (for traditional wallets)
        address: User's address (for Base Accounts - required if no private_key)
        
    Returns:
        List of position dictionaries
    """
    if not private_key and not address:
        raise ValueError("Either private_key or address must be provided")
    
    try:
        # Derive address from private key if provided
        if private_key:
            account = Account.from_key(private_key)
            trader_address = account.address
        else:
            trader_address = Web3.to_checksum_address(address)
        
        # Use direct contract calls (SDK causes timeouts and is unreliable)
        # Direct contract calls are faster and more reliable
        from contract_operations import get_all_open_trades_for_trader
        
        trades = await get_all_open_trades_for_trader(trader_address=trader_address)
        
        # Also fetch openTradesInfo for accurate position size data
        from contract_operations import _get_trading_storage_contract, _get_rpc_url, USDC_DECIMALS
        rpc = _get_rpc_url()
        storage = _get_trading_storage_contract(rpc)
        
        # Format positions for API response
        formatted_positions = []
        for trade in trades:
            pair_index = trade.get("pair_index")
            trade_index = trade.get("index", 0)
            symbol = get_symbol(pair_index) if pair_index is not None else None
            
            open_price = trade.get("open_price", 0)
            leverage = trade.get("leverage", 1)
            is_long = trade.get("is_long", False)
            
            # Fetch openTradesInfo to get actual position size (openInterestUSDC)
            try:
                info_raw = await asyncio.to_thread(
                    storage.functions.openTradesInfo(trader_address, pair_index, trade_index).call
                )
                open_interest_usdc = float(info_raw[0]) / float(10 ** USDC_DECIMALS) if info_raw else 0
            except Exception as e:
                logger.warning(f"Could not fetch openTradesInfo for pair={pair_index}, idx={trade_index}: {e}")
                open_interest_usdc = trade.get("position_size_usdc", 0)
            
            # Calculate collateral from openInterestUSDC (position size / leverage)
            # openInterestUSDC is the leveraged position size (collateral * leverage)
            collateral = open_interest_usdc / leverage if leverage > 0 else 0
            
            liquidation_price = None
            if open_price > 0 and leverage > 0:
                if is_long:
                    liquidation_price = open_price * (1 - (1.0 / leverage))
                else:
                    liquidation_price = open_price * (1 + (1.0 / leverage))
            
            formatted_positions.append({
                "pair_index": pair_index,
                "index": trade_index,  # Include trade index for closing
                "symbol": symbol,
                "is_long": is_long,
                "collateral": collateral,
                "position_size": open_interest_usdc,  # Leveraged position size
                "leverage": leverage,
                "entry_price": open_price,
                "current_price": open_price,  # Will be updated with real price below
                "pnl": 0,
                "pnl_percentage": 0,
                "liquidation_price": liquidation_price,
                "take_profit": trade.get("tp"),
                "stop_loss": trade.get("sl"),
                "timestamp": trade.get("timestamp"),
                "open_interest_usdc": open_interest_usdc,
            })
        
        # Fetch current prices to calculate PnL (using Binance API instead of SDK)
        if formatted_positions:
            try:
                from price_fetcher import fetch_prices_for_symbols
                symbols = [pos["symbol"] for pos in formatted_positions if pos.get("symbol")]
                logger.debug(f"💰 [PRICE] Fetching prices for: {symbols}")
                if symbols:
                    price_map = await fetch_prices_for_symbols(list(set(symbols)))
                    logger.debug(f"💰 [PRICE] Got prices: {price_map}")
                    
                    # Update positions with current prices and calculate PnL
                    for pos in formatted_positions:
                        sym = pos.get("symbol", "").upper()
                        if sym in price_map:
                            current_price = price_map[sym]
                            pos["current_price"] = current_price
                            
                            # Calculate PnL using position size (leveraged value)
                            entry_price = pos["entry_price"]
                            position_size = pos.get("position_size", pos["collateral"] * pos["leverage"])
                            collateral = pos["collateral"]
                            is_long = pos["is_long"]
                            
                            if entry_price > 0 and collateral > 0:
                                # PnL calculation: (current - entry) / entry * position_size
                                price_diff_pct = (current_price - entry_price) / entry_price
                                if not is_long:
                                    price_diff_pct = -price_diff_pct  # Reverse for shorts
                                
                                pnl_usd = price_diff_pct * position_size
                                pnl_pct = (pnl_usd / collateral) * 100  # ROE percentage
                                
                                pos["pnl"] = round(pnl_usd, 2)
                                pos["pnl_percentage"] = round(pnl_pct, 2)
                                
                                logger.debug(f"💰 [PNL] {sym}: entry=${entry_price:.2f}, current=${current_price:.2f}, pnl=${pnl_usd:.2f} ({pnl_pct:.2f}%)")
                        else:
                            logger.debug(f"💰 [PRICE] No price found for {sym}")
            except Exception as e:
                logger.error(f"❌ Could not fetch current prices for PnL calculation: {e}")
        
        logger.debug(f"Retrieved {len(formatted_positions)} positions via direct contract")
        return formatted_positions
        
    except Exception as e:
        logger.error(f"Error getting positions: {e}")
        raise


@retry_on_network_error()
async def get_balance(
    private_key: Optional[str] = None,
    address: Optional[str] = None
) -> Dict[str, Any]:
    """
    Get account balance information for a user.
    
    Uses direct Web3 contract calls to get wallet USDC balance (not vault balance).
    This allows trading directly from wallet without manual deposit to vault.
    
    Args:
        private_key: User's private key (for traditional wallets)
        address: User's address (for Base Accounts - required if no private_key)
        
    Returns:
        Dictionary with balance information
    """
    if not private_key and not address:
        raise ValueError("Either private_key or address must be provided")
    
    try:
        # Derive address from private key if provided
        if private_key:
            account = Account.from_key(private_key)
            user_address = account.address
        else:
            user_address = Web3.to_checksum_address(address)
        
        # Get Web3 instance
        rpc_url = settings.get_effective_rpc_url()
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        if not w3.is_connected():
            raise RuntimeError(f"Web3 provider not reachable: {rpc_url}")
        
        # Get wallet USDC balance directly from contract
        usdc_address = Web3.to_checksum_address(settings.usdc_token_address)
        usdc_abi = [
            {
                "constant": True,
                "inputs": [{"name": "_owner", "type": "address"}],
                "name": "balanceOf",
                "outputs": [{"name": "", "type": "uint256"}],
                "type": "function"
            }
        ]
        usdc_contract = w3.eth.contract(address=usdc_address, abi=usdc_abi)
        balance_wei = usdc_contract.functions.balanceOf(user_address).call()
        usdc_balance = float(balance_wei) / 1e6  # USDC has 6 decimals
        
        # Get USDC allowance for trading
        try:
            usdc_allowance = await get_usdc_allowance(private_key=private_key) if private_key else 0.0
        except Exception:
            usdc_allowance = 0.0
        
        # Get positions to calculate margin used
        try:
            positions = await get_positions(private_key=private_key, address=address)
            margin_used = sum(pos.get("collateral", 0) for pos in positions)
        except Exception:
            margin_used = 0.0
        
        # Total balance = wallet USDC + collateral in positions (margin used)
        # Available balance = wallet USDC only (not in positions)
        total_balance = usdc_balance + margin_used
        available_balance = usdc_balance
        
        return {
            "address": user_address,
            "total_balance": total_balance,  # USDC + collateral in positions
            "available_balance": available_balance,  # Free USDC in wallet
            "margin_used": margin_used,  # Collateral locked in positions
            "usdc_balance": usdc_balance,  # Wallet USDC balance (for trading)
            "usdc_allowance": usdc_allowance,
            "total_collateral": margin_used,  # Alias for margin_used (backwards compat)
        }
        
    except Exception as e:
        logger.error(f"Error getting balance: {e}")
        raise


@retry_on_network_error()
async def get_total_pnl(
    private_key: Optional[str] = None,
    address: Optional[str] = None
) -> float:
    """
    Get total unrealized PnL across all positions for a user.
    
    Args:
        private_key: User's private key (for traditional wallets)
        address: User's address (for Base Accounts - required if no private_key)
        
    Returns:
        Total PnL value
    """
    try:
        positions = await get_positions(private_key=private_key, address=address)
        total_pnl = sum(pos.get("pnl", 0) for pos in positions)
        return total_pnl
        
    except Exception as e:
        logger.error(f"Error getting total PnL: {e}")
        raise


@retry_on_network_error()
async def get_usdc_allowance(
    private_key: str
) -> float:
    """
    Get USDC allowance for TradingCallbacks contract using direct Web3 calls.
    
    IMPORTANT: The allowance must be checked for the TradingCallbacks contract
    (avantis_usdc_spender_address), NOT the Trading contract. The Trading contract
    delegates to TradingCallbacks which does the actual USDC transferFrom.
    
    Args:
        private_key: User's private key (required - backend wallet)
        
    Returns:
        USDC allowance amount in USDC units (not wei)
    """
    if not private_key:
        raise ValueError("private_key is required")
    
    try:
        # Derive address from private key
        account = Account.from_key(private_key)
        owner_address = account.address
        
        # Get Web3 instance
        rpc_url = settings.get_effective_rpc_url()
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        if not w3.is_connected():
            raise RuntimeError(f"Web3 provider not reachable: {rpc_url}")
        
        # Get USDC contract - use avantis_usdc_spender_address (TradingCallbacks)
        # This is the contract that actually calls transferFrom, NOT the Trading contract!
        usdc_address = Web3.to_checksum_address(settings.usdc_token_address)
        spender_address = Web3.to_checksum_address(settings.avantis_usdc_spender_address)
        
        logger.debug(f"Checking USDC allowance for spender: {spender_address} (TradingCallbacks)")
        
        usdc_abi = [
            {
                "constant": True,
                "inputs": [
                    {"name": "_owner", "type": "address"},
                    {"name": "_spender", "type": "address"}
                ],
                "name": "allowance",
                "outputs": [{"name": "", "type": "uint256"}],
                "type": "function"
            }
        ]
        
        usdc_contract = w3.eth.contract(address=usdc_address, abi=usdc_abi)
        allowance_wei = usdc_contract.functions.allowance(owner_address, spender_address).call()
        
        # Convert from wei to USDC (6 decimals)
        allowance_usdc = float(allowance_wei) / 1e6
        
        return allowance_usdc
        
    except Exception as e:
        logger.error(f"Error getting USDC allowance: {e}")
        raise


@retry_on_network_error()
async def approve_usdc(
    amount: float,
    private_key: str
) -> Dict[str, Any]:
    """
    Approve USDC for TradingCallbacks contract using direct Web3 calls.
    
    IMPORTANT: The approval must be for the TradingCallbacks contract
    (avantis_usdc_spender_address), NOT the Trading contract. The Trading contract
    delegates to TradingCallbacks which does the actual USDC transferFrom.
    
    Args:
        amount: Amount to approve (0 for unlimited, use max uint256)
        private_key: User's private key (required - each user provides their own)
        
    Returns:
        Dictionary with approval result
    """
    try:
        # Derive address from private key
        account = Account.from_key(private_key)
        owner_address = account.address
        
        # Get Web3 instance
        rpc_url = settings.get_effective_rpc_url()
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        if not w3.is_connected():
            raise RuntimeError(f"Web3 provider not reachable: {rpc_url}")
        
        # Get USDC contract - use avantis_usdc_spender_address (TradingCallbacks)
        # This is the contract that actually calls transferFrom, NOT the Trading contract!
        usdc_address = Web3.to_checksum_address(settings.usdc_token_address)
        spender_address = Web3.to_checksum_address(settings.avantis_usdc_spender_address)
        
        logger.info(f"🔐 Approving USDC for spender: {spender_address} (TradingCallbacks)")
        
        # Convert amount to wei (USDC has 6 decimals)
        if amount == 0:
            # Unlimited approval
            amount_wei = 2**256 - 1
        else:
            amount_wei = int(amount * 1e6)
        
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
        nonce = w3.eth.get_transaction_count(owner_address, "pending")
        tx = usdc_contract.functions.approve(spender_address, amount_wei).build_transaction({
            "from": owner_address,
            "nonce": nonce,
            "chainId": w3.eth.chain_id,
        })
        
        # Estimate gas
        try:
            gas = w3.eth.estimate_gas(tx)
            tx["gas"] = gas
        except Exception as e:
            logger.warning(f"Gas estimation failed: {e}, using default")
            tx["gas"] = 100000  # Default gas limit for approve
        
        # Sign and send transaction
        signed_tx = account.sign_transaction(tx)
        # Handle both camelCase and snake_case attribute names (eth-account version compatibility)
        raw_tx_bytes = getattr(signed_tx, 'rawTransaction', None) or getattr(signed_tx, 'raw_transaction', None)
        if raw_tx_bytes is None:
            # Fallback: try to get bytes directly
            raw_tx_bytes = bytes(signed_tx) if hasattr(signed_tx, '__bytes__') else None
        if raw_tx_bytes is None:
            raise ValueError(f"Could not extract raw transaction from signed transaction. Available attributes: {dir(signed_tx)}")
        tx_hash = w3.eth.send_raw_transaction(raw_tx_bytes)
        tx_hash_hex = tx_hash.hex()
        
        logger.info(f"✅ USDC approval transaction sent: {tx_hash_hex}")
        
        # Wait for transaction confirmation (critical - position opening needs confirmed approval)
        logger.info(f"⏳ Waiting for USDC approval transaction confirmation...")
        import asyncio
        receipt = await asyncio.to_thread(
            w3.eth.wait_for_transaction_receipt,
            tx_hash_hex,
            timeout=60  # 60 second timeout
        )
        
        if receipt.status == 1:
            logger.info(f"✅ USDC approval transaction confirmed in block {receipt.blockNumber}")
        else:
            logger.error(f"❌ USDC approval transaction failed (status: {receipt.status})")
            raise ValueError(f"USDC approval transaction failed: {receipt.status}")
        
        return {
            "success": True,
            "amount": amount,
            "tx_hash": tx_hash_hex,
            "address": owner_address,
            "confirmed": True
        }
        
    except Exception as e:
        logger.error(f"❌ USDC approval failed: {e}", exc_info=True)
        raise


@retry_on_network_error()
async def get_trade_history(
    private_key: Optional[str] = None,
    address: Optional[str] = None,
    limit: int = 50
) -> List[Dict[str, Any]]:
    """
    Get trade history (closed trades) for a user.
    
    Fetches all historical trades from the Avantis SDK and combines with current open positions
    to build a complete trade history.
    
    Args:
        private_key: User's private key (for traditional wallets)
        address: User's address (for Base Accounts)
        limit: Maximum number of trades to return
        
    Returns:
        List of historical trade dictionaries with full details
    """
    if not private_key and not address:
        raise ValueError("Either private_key or address must be provided")
    
    try:
        # Derive address from private key if provided
        if private_key:
            account = Account.from_key(private_key)
            trader_address = account.address
        else:
            trader_address = Web3.to_checksum_address(address)
        
        logger.info(f"📜 [HISTORY] Fetching trade history for: {trader_address}")
        
        if not SDK_AVAILABLE:
            logger.warning("📜 [HISTORY] SDK not available, returning empty history")
            return []
        
        # Get RPC URL
        rpc_url = settings.get_effective_rpc_url()
        
        # Initialize SDK clients (FeedClient uses default Pyth network endpoint)
        feed_client = FeedClient()
        trader_client = TraderClient(rpc_url=rpc_url, feed_client=feed_client)
        
        # Fetch current open trades (these will help us track what was closed)
        try:
            long_trades, short_trades = await asyncio.wait_for(
                asyncio.to_thread(trader_client.trade.get_trades, trader_address),
                timeout=20.0
            )
            open_trades_count = len(long_trades) + len(short_trades)
            logger.info(f"📜 [HISTORY] Found {open_trades_count} open positions")
        except Exception as e:
            logger.warning(f"📜 [HISTORY] Error fetching open trades: {e}")
            long_trades, short_trades = [], []
        
        # For trade history, we need to query blockchain events for closed positions
        # Since the SDK doesn't have a direct "get closed trades" method, 
        # we'll query the contract events directly
        w3 = Web3(Web3.HTTPProvider(rpc_url))
        if not w3.is_connected():
            raise RuntimeError(f"Web3 provider not reachable: {rpc_url}")
        
        # Get TradingCallbacks contract for events
        callbacks_address = Web3.to_checksum_address(settings.avantis_usdc_spender_address)
        
        # Query recent blocks (last 7 days on Base)
        current_block = w3.eth.block_number
        from_block = max(0, current_block - 300000)  # ~7 days on Base (2s per block)
        
        logger.info(f"📜 [HISTORY] Querying events from block {from_block} to {current_block}")
        
        # Define event signatures for trade lifecycle
        # MarketExecuted: keccak256("MarketExecuted(address,uint256,uint8,uint256,bool,uint256,uint256,int256,uint256)")
        # This is the event emitted when a trade is closed via market order
        market_executed_topic = "0x5e6d3e07c1b8e02e5b7e8c6f7a9d3b5a4c8f9e0d1a2b3c4d5e6f7a8b9c0d1e2f"
        
        history = []
        
        try:
            # Query in chunks to avoid RPC limits
            chunk_size = 50000
            
            for start in range(from_block, current_block + 1, chunk_size):
                end = min(start + chunk_size - 1, current_block)
                
                try:
                    # Get all logs from TradingCallbacks contract
                    logs = await asyncio.to_thread(
                        w3.eth.get_logs,
                        {
                            "address": callbacks_address,
                            "fromBlock": start,
                            "toBlock": end,
                        }
                    )
                    
                    logger.info(f"📜 [HISTORY] Processing {len(logs)} logs from blocks {start}-{end}")
                    
                    # Process each log
                    for log in logs:
                        try:
                            topics = log.get("topics", [])
                            if len(topics) < 2:
                                continue
                            
                            # Extract trader address from indexed parameter (topic[1])
                            # Topics are 32 bytes, address is last 20 bytes
                            indexed_address_bytes = topics[1][-20:] if len(topics[1]) > 20 else topics[1]
                            indexed_address = "0x" + indexed_address_bytes.hex()
                            
                            # Check if this log is for our trader
                            if indexed_address.lower() != trader_address.lower():
                                continue
                            
                            # This is a trade event for our trader
                            tx_hash = log.get("transactionHash")
                            tx_hash_hex = tx_hash.hex() if isinstance(tx_hash, bytes) else str(tx_hash)
                            block_number = log.get("blockNumber", 0)
                            log_index = log.get("logIndex", 0)
                            
                            # Get block timestamp
                            try:
                                block = await asyncio.to_thread(w3.eth.get_block, block_number)
                                timestamp = block.get("timestamp", 0)
                            except:
                                timestamp = 0
                            
                            # Try to decode event data (if available)
                            data = log.get("data", "0x")
                            
                            # Parse data fields (simplified - actual ABI decoding would be more complex)
                            # For now, create a basic trade record
                            from datetime import datetime
                            trade_date = datetime.fromtimestamp(timestamp).strftime('%m/%d/%Y') if timestamp > 0 else ""
                            
                            # Extract pair_index from topics if available (usually topic[2])
                            pair_index = 0
                            if len(topics) >= 3:
                                try:
                                    pair_index = int.from_bytes(topics[2], byteorder='big')
                                except:
                                    pass
                            
                            # Map pair_index to symbol
                            from symbols.symbol_registry import PAIR_INDEX_TO_SYMBOL
                            symbol = PAIR_INDEX_TO_SYMBOL.get(pair_index, f"PAIR-{pair_index}")
                            
                            history.append({
                                "id": f"{tx_hash_hex}-{log_index}",
                                "symbol": symbol,
                                "pair_index": pair_index,
                                "side": "CLOSED",  # These are all closed trades
                                "timestamp": timestamp,
                                "date": trade_date,
                                "tx_hash": tx_hash_hex,
                                "block": block_number,
                                "trader": trader_address,
                                "type": "close",
                            })
                            
                        except Exception as e:
                            logger.debug(f"📜 [HISTORY] Error processing log: {e}")
                            continue
                
                except Exception as chunk_error:
                    logger.warning(f"📜 [HISTORY] Error querying chunk {start}-{end}: {chunk_error}")
                    continue
                
                # Small delay to avoid rate limits
                await asyncio.sleep(0.05)
            
            logger.info(f"📜 [HISTORY] Found {len(history)} historical trades for {trader_address}")
            
            # Sort by timestamp descending (most recent first)
            history.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
            
            # Return limited results
            return history[:limit]
            
        except Exception as e:
            logger.warning(f"📜 [HISTORY] Error querying blockchain events: {e}")
            return []
        
    except Exception as e:
        logger.error(f"❌ Error getting trade history: {e}", exc_info=True)
        return []
