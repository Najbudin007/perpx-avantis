"""Position and balance query operations."""
import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional
from eth_account import Account
from web3 import Web3
from hexbytes import HexBytes
from avantis_client import get_avantis_client
from symbols import get_symbol
from symbols.symbol_registry import PAIR_INDEX_TO_SYMBOL
from config import settings
from utils import retry_on_network_error
import logging
import aiohttp

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
            if address is None:
                raise ValueError("address must be provided when private_key is not provided")
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
        # Add timeout to prevent price fetching from blocking position response
        if formatted_positions:
            try:
                from price_fetcher import fetch_prices_for_symbols
                symbols = [pos["symbol"] for pos in formatted_positions if pos.get("symbol")]
                logger.debug(f"💰 [PRICE] Fetching prices for: {symbols}")
                if symbols:
                    # Add 5 second timeout for price fetching (non-blocking)
                    try:
                        price_map = await asyncio.wait_for(
                            fetch_prices_for_symbols(list(set(symbols))),
                            timeout=5.0
                        )
                        logger.debug(f"💰 [PRICE] Got prices: {price_map}")
                    except asyncio.TimeoutError:
                        logger.warning(f"💰 [PRICE] Price fetching timed out after 5s - using entry prices")
                        price_map = {}  # Use entry prices if price fetch times out
                    
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
            if address is None:
                raise ValueError("address must be provided when private_key is not provided")
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
    private_key: str,
    spender_address: Optional[str] = None,
) -> float:
    """
    Get USDC allowance for the specified spender (defaults to TradingCallbacks).
    
    IMPORTANT: The Avantis Trading contract forwards USDC transfers through the
    TradingCallbacks contract. In some flows the Trading contract address may be
    the msg.sender that performs `transferFrom`, so we allow callers to specify
    the spender explicitly and reuse this helper for both contract addresses.
    
    Args:
        private_key: User's private key (required - backend wallet)
        spender_address: Optional override for the allowance spender. If not
            provided, defaults to settings.avantis_usdc_spender_address.
        
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
        
        # Get USDC contract - defaults to TradingCallbacks (spender), but can be overridden.
        usdc_addr = settings.usdc_token_address
        if usdc_addr is None:
            raise ValueError("usdc_token_address must be configured in settings")
        usdc_address = Web3.to_checksum_address(usdc_addr)
        spender_addr = spender_address or settings.avantis_usdc_spender_address
        if spender_addr is None:
            raise ValueError("spender_address must be provided or configured in settings")
        spender = Web3.to_checksum_address(spender_addr)
        
        logger.debug(f"Checking USDC allowance for spender: {spender}")
        
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
        allowance_wei = usdc_contract.functions.allowance(owner_address, spender).call()
        
        # Convert from wei to USDC (6 decimals)
        allowance_usdc = float(allowance_wei) / 1e6
        
        return allowance_usdc
        
    except Exception as e:
        logger.error(f"Error getting USDC allowance: {e}")
        raise


@retry_on_network_error()
async def approve_usdc(
    amount: float,
    private_key: str,
    spender_address: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Approve USDC for the specified spender (defaults to TradingCallbacks).
    
    IMPORTANT: The Trading contract may route `transferFrom` through the
    TradingCallbacks contract. To be safe we allow callers to target either
    contract address.
    
    Args:
        amount: Amount to approve (0 for unlimited, use max uint256)
        private_key: User's private key (required - each user provides their own)
        spender_address: Optional override for the spender address. Defaults to
            settings.avantis_usdc_spender_address.
        
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
        
        # Get USDC contract - defaults to TradingCallbacks (spender), but can be overridden.
        usdc_addr = settings.usdc_token_address
        if usdc_addr is None:
            raise ValueError("usdc_token_address must be configured in settings")
        usdc_address = Web3.to_checksum_address(usdc_addr)
        spender_addr = spender_address or settings.avantis_usdc_spender_address
        if spender_addr is None:
            raise ValueError("spender_address must be provided or configured in settings")
        spender = Web3.to_checksum_address(spender_addr)
        
        logger.info(f"🔐 Approving USDC for spender: {spender}")
        
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
        tx = usdc_contract.functions.approve(spender, amount_wei).build_transaction({
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
        receipt = await asyncio.to_thread(
            w3.eth.wait_for_transaction_receipt,
            HexBytes(tx_hash_hex),
            timeout=60  # 60 second timeout
        )
        
        if receipt["status"] == 1:
            logger.info(f"✅ USDC approval transaction confirmed in block {receipt['blockNumber']}")
        else:
            logger.error(f"❌ USDC approval transaction failed (status: {receipt['status']})")
            raise ValueError(f"USDC approval transaction failed: {receipt['status']}")
        
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
    Get trade history (closed trades) for a user using Avantis backend API.
    
    This function fetches trade history from the Avantis API endpoint which provides
    the same normalized data used by the Avantis dashboard. This is the single source
    of truth for trade history.
    
    Args:
        private_key: User's private key (for traditional wallets)
        address: User's address (for Base Accounts)
        limit: Maximum number of trades to return
        
    Returns:
        List of historical trade dictionaries with full details matching Avantis dashboard format
    """
    if not private_key and not address:
        raise ValueError("Either private_key or address must be provided")
    
    try:
        # Derive address from private key if provided
        if private_key:
            account = Account.from_key(private_key)
            trader_address = account.address
        else:
            if address is None:
                raise ValueError("address must be provided when private_key is not provided")
            trader_address = Web3.to_checksum_address(address)
        
        logger.info(f"📜 [HISTORY] Fetching trade history from Avantis API for: {trader_address}")
        
        # Avantis API endpoint
        # NOTE: To verify the correct endpoint format, check browser network requests
        # when viewing trade history on https://www.avantisfi.com
        # Look for requests to api.avantisfi.com in the Network tab
        api_base_url = "https://api.avantisfi.com"
        all_trades = []
        page = 1
        
        # Headers to match browser requests
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://www.avantisfi.com",
            "Origin": "https://www.avantisfi.com",
            "Accept": "application/json",
        }
        
        # Try multiple address formats (some APIs are picky about format)
        address_variants = [
            trader_address,  # Checksummed (0x...)
            trader_address.lower(),  # Lowercase (0x...)
            trader_address.replace("0x", ""),  # Without 0x prefix
            trader_address.lower().replace("0x", ""),  # Lowercase without 0x
        ]
        
        async with aiohttp.ClientSession() as session:
            for address_variant in address_variants:
                page = 1
                logger.info(f"📜 [HISTORY] Trying address format: {address_variant}")
                
                while True:
                    # Construct API URL with wallet address and page number
                    api_url = f"{api_base_url}/v2/history/portfolio/history/{address_variant}/{page}"
                    
                    try:
                        logger.info(f"📜 [HISTORY] Fetching page {page} from {api_url}")
                        
                        async with session.get(api_url, headers=headers, timeout=aiohttp.ClientTimeout(total=30)) as response:
                            response_text = await response.text()
                            
                            if response.status == 404:
                                # No more pages or no trades
                                logger.info(f"📜 [HISTORY] Page {page} returned 404, no more trades")
                                if page == 1:
                                    # If first page is 404, try next address variant
                                    logger.info(f"📜 [HISTORY] First page 404, will try next address format")
                                    break
                                else:
                                    # We got some pages, this is the end
                                    break
                            
                            if response.status != 200:
                                logger.warning(f"📜 [HISTORY] API returned status {response.status}: {response_text[:500]}")
                                if response.status >= 500:
                                    # Server error, retry might help
                                    raise Exception(f"Avantis API server error: {response.status} - {response_text[:200]}")
                                if page == 1:
                                    # If first page failed, try next address variant
                                    break
                                else:
                                    # We got some pages, stop here
                                    break
                            
                            # Try to parse JSON
                            try:
                                data = await response.json() if response_text else {}
                            except Exception as json_err:
                                logger.error(f"📜 [HISTORY] Failed to parse JSON response: {json_err}")
                                logger.error(f"📜 [HISTORY] Response text: {response_text[:500]}")
                                if page == 1:
                                    break
                                else:
                                    break
                            
                            # Log the response structure for debugging
                            if page == 1:
                                logger.info(f"📜 [HISTORY] First page response structure: {type(data)}, keys: {list(data.keys()) if isinstance(data, dict) else 'N/A (not a dict)'}")
                                logger.debug(f"📜 [HISTORY] First page response sample: {str(data)[:500]}")
                        
                            # Extract trades from response
                            # API response structure: {"portfolio": [...], "count": N, "pageCount": M, "success": true}
                            trades = []
                            if isinstance(data, list):
                                trades = data
                            elif isinstance(data, dict):
                                # Avantis API uses "portfolio" key
                                if "portfolio" in data:
                                    trades = data["portfolio"]
                                    logger.debug(f"📜 [HISTORY] Found {len(trades)} trades in 'portfolio' key")
                                elif "trades" in data:
                                    trades = data["trades"]
                                elif "data" in data:
                                    trades = data["data"]
                                elif "history" in data:
                                    trades = data["history"]
                                elif "items" in data:
                                    trades = data["items"]
                                elif "results" in data:
                                    trades = data["results"]
                                else:
                                    # Check if dict values are arrays
                                    for key, value in data.items():
                                        if isinstance(value, list):
                                            trades = value
                                            logger.info(f"📜 [HISTORY] Found trades array in key: {key}")
                                            break
                            
                            if not trades:
                                logger.info(f"📜 [HISTORY] Page {page} returned no trades (data type: {type(data)})")
                                if page == 1 and not all_trades:
                                    # If first page has no trades, try next address variant
                                    break
                                else:
                                    # We got some pages, this is the end
                                    break
                            
                            logger.info(f"📜 [HISTORY] Page {page}: Found {len(trades)} trades")
                            all_trades.extend(trades)
                            
                            # Check if there are more pages
                            # API response includes "pageCount" field
                            page_count = None
                            if isinstance(data, dict):
                                page_count = data.get("pageCount") or data.get("totalPages") or data.get("pages") or data.get("total_pages")
                                if page_count is not None:
                                    logger.debug(f"📜 [HISTORY] API reports {page_count} total pages")
                            
                            if page_count is not None:
                                if page >= page_count:
                                    logger.info(f"📜 [HISTORY] Reached last page ({page_count})")
                                    break
                            elif len(trades) == 0:
                                # No trades on this page, assume we're done
                                break
                            
                            # Rate limit: wait 300ms between requests
                            await asyncio.sleep(0.3)
                            page += 1
                            
                    except aiohttp.ClientError as e:
                        logger.error(f"📜 [HISTORY] Network error fetching page {page}: {e}")
                        if page == 1:
                            # Try next address variant
                            break
                        raise
                    except Exception as e:
                        logger.error(f"📜 [HISTORY] Error fetching page {page}: {e}", exc_info=True)
                        if page == 1:
                            # Try next address variant
                            break
                        # If we have some trades, return what we have
                        if all_trades:
                            logger.warning(f"📜 [HISTORY] Returning {len(all_trades)} trades despite error")
                            break
                        raise
                
                # If we got trades with this address variant, stop trying others
                if all_trades:
                    logger.info(f"📜 [HISTORY] Successfully fetched trades using address format: {address_variant}")
                    break
        
        if not all_trades:
            logger.warning(f"📜 [HISTORY] No trades found from API for address {trader_address}. Tried {len(address_variants)} address format(s).")
            logger.warning(f"📜 [HISTORY] This could mean: 1) No trades exist for this wallet, 2) API endpoint/format is incorrect, 3) API requires authentication")
            return []
        
        logger.info(f"📜 [HISTORY] Fetched {len(all_trades)} total trades from API")
        
        # Normalize trades to match expected format
        # API structure: portfolio[].event.args.t (trade data), portfolio[].event.args.price (close price), portfolio[]._grossPnl (PnL)
        normalized_trades = []
        for trade_item in all_trades:
            try:
                # Extract nested structure from API response
                event = trade_item.get("event", {})
                args = event.get("args", {})
                trade_data = args.get("t", {})  # Trade struct
                
                # Get values directly from API (already in decimal format, no conversion needed)
                is_long = trade_data.get("buy", False)
                pair_index = trade_data.get("pairIndex")
                leverage = trade_data.get("leverage", 1)
                collateral = trade_data.get("initialPosToken", 0)  # Already in USDC (decimal)
                open_price = trade_data.get("openPrice", 0)  # Already in decimal
                close_price = args.get("price", 0)  # Close price from event.args
                tp = trade_data.get("tp", 0) if trade_data.get("tp", 0) > 0 else None
                sl = trade_data.get("sl", 0) if trade_data.get("sl", 0) > 0 else None
                position_size_usdc = args.get("positionSizeUSDC", 0)  # Already in USDC (decimal)
                
                # PnL is at top level of trade_item
                pnl = trade_item.get("_grossPnl", 0)
                
                # Timestamp - API provides timeStamp (ISO string) at top level, or timestamp (unix) in trade_data
                time_stamp_str = trade_item.get("timeStamp")  # ISO string like "2025-12-12T16:03:41.000Z"
                time_stamp_unix = trade_data.get("timestamp", 0)  # Unix timestamp
                
                # Prefer ISO string, convert to unix timestamp
                if time_stamp_str:
                    try:
                        dt = datetime.fromisoformat(time_stamp_str.replace("Z", "+00:00"))
                        timestamp = int(dt.timestamp())
                    except Exception as e:
                        logger.debug(f"📜 [HISTORY] Failed to parse ISO timestamp {time_stamp_str}: {e}, using unix timestamp")
                        timestamp = time_stamp_unix if time_stamp_unix > 0 else int(datetime.now().timestamp())
                elif time_stamp_unix > 0:
                    timestamp = time_stamp_unix
                else:
                    # Fallback: use current time if no timestamp
                    timestamp = int(datetime.now().timestamp())
                
                # Format date from timestamp
                if timestamp:
                    trade_date = datetime.fromtimestamp(timestamp).strftime('%m/%d/%Y')
                else:
                    trade_date = ""
                
                # Get symbol from pair_index
                symbol = PAIR_INDEX_TO_SYMBOL.get(pair_index, f"PAIR-{pair_index}") if pair_index is not None else "UNKNOWN"
                
                # Calculate position_size_asset
                position_size_asset = position_size_usdc / close_price if close_price > 0 else 0
                
                # Calculate pnl_percentage
                pnl_percentage = (pnl / collateral * 100) if collateral > 0 else 0
                
                # Build normalized trade record
                normalized_trade = {
                    "id": trade_item.get("_id") or f"trade-{len(normalized_trades)}",
                    "symbol": symbol,
                    "pair_index": pair_index,
                    "is_long": is_long,
                    "side": "Long" if is_long else "Short",
                    "leverage": leverage,
                    "collateral": collateral,
                    "position_size_usdc": position_size_usdc,
                    "position_size_asset": position_size_asset,
                    "open_price": open_price,
                    "close_price": close_price,
                    "tp": tp,
                    "sl": sl,
                    "pnl": pnl,  # Use _grossPnl directly from API
                    "pnl_percentage": pnl_percentage,
                    "timestamp": timestamp,
                    "open_timestamp": trade_data.get("timestamp", timestamp),
                    "date": trade_date,
                    "trader": trade_data.get("trader") or trader_address,
                    "type": "close",
                    "tx_hash": "",  # Not provided by API
                    "block": 0,  # Not provided by API
                }
                
                normalized_trades.append(normalized_trade)
                
            except Exception as e:
                logger.warning(f"📜 [HISTORY] Error normalizing trade: {e}", exc_info=True)
                continue
        
        logger.info(f"📜 [HISTORY] Normalized {len(normalized_trades)} trades")
        
        # Sort by timestamp descending (most recent first)
        normalized_trades.sort(key=lambda x: x.get("timestamp", 0), reverse=True)
        
        # Return limited results
        return normalized_trades[:limit]
        
    except Exception as e:
        logger.error(f"❌ Error getting trade history: {e}", exc_info=True)
        return []
