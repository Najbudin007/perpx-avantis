"""Price fetcher for calculating PnL - uses Avantis SDK on-chain oracle as primary source."""
import logging
import aiohttp
import ssl
import certifi
import asyncio
from typing import Dict, Optional
import json

logger = logging.getLogger(__name__)

# Try to import Avantis SDK for on-chain price oracle (most reliable)
try:
    from avantis_trader_sdk import FeedClient
    SDK_AVAILABLE = True
except ImportError:
    SDK_AVAILABLE = False
    logger.warning("Avantis SDK not available for price fetching")

# API endpoints (fallback sources)
BINANCE_API_URL = "https://api.binance.com/api/v3/ticker/price"
COINGECKO_API_URL = "https://api.coingecko.com/api/v3/simple/price"
COINBASE_API_URL = "https://api.coinbase.com/v2/exchange-rates"
KRAKEN_API_URL = "https://api.kraken.com/0/public/Ticker"

# Symbol to CoinGecko ID mapping
COINGECKO_IDS = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "BNB": "binancecoin",
    "ARB": "arbitrum",
    "DOGE": "dogecoin",
    "AVAX": "avalanche-2",
    "OP": "optimism",
    "MATIC": "matic-network",
    "POL": "matic-network",
    "TIA": "celestia",
    "SEI": "sei-network",
    "LINK": "chainlink",
    "NEAR": "near",
    "SUI": "sui",
    "APT": "aptos",
    "XRP": "ripple",
    "PEPE": "pepe",
    "SHIB": "shiba-inu",
    "BONK": "bonk",
}

# Coinbase symbol mapping
COINBASE_SYMBOLS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    "SOL": "SOL-USD",
}

# Kraken symbol mapping
KRAKEN_SYMBOLS = {
    "BTC": "XBTUSD",
    "ETH": "ETHUSD",
    "SOL": "SOLUSD",
}


def get_ssl_context():
    """Create an SSL context that works on macOS."""
    try:
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        return ssl_context
    except Exception:
        # Fallback: disable SSL verification (not recommended for production)
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        return ssl_context


async def fetch_price_from_binance(symbol: str) -> Optional[float]:
    """Fetch current price from Binance API with SSL fix."""
    try:
        binance_symbol = f"{symbol.upper()}USDT"
        ssl_context = get_ssl_context()
        connector = aiohttp.TCPConnector(ssl=ssl_context, limit=10)
        
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(
                f"{BINANCE_API_URL}?symbol={binance_symbol}",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    price = float(data.get("price", 0))
                    if price > 0:
                        logger.debug(f"💰 [BINANCE] {symbol} price: ${price:,.2f}")
                        return price
                else:
                    logger.debug(f"Binance returned status {response.status} for {symbol}")
                return None
    except asyncio.TimeoutError:
        logger.debug(f"Binance timeout for {symbol}")
        return None
    except aiohttp.ClientError as e:
        logger.debug(f"Binance client error for {symbol}: {e}")
        return None
    except Exception as e:
        logger.debug(f"Binance fetch failed for {symbol}: {e}")
        return None


async def fetch_price_from_coingecko(symbol: str) -> Optional[float]:
    """Fetch current price from CoinGecko API."""
    try:
        coin_id = COINGECKO_IDS.get(symbol.upper())
        if not coin_id:
            return None
            
        ssl_context = get_ssl_context()
        connector = aiohttp.TCPConnector(ssl=ssl_context, limit=10)
        
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(
                f"{COINGECKO_API_URL}?ids={coin_id}&vs_currencies=usd",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    if coin_id in data and "usd" in data[coin_id]:
                        price = float(data[coin_id]["usd"])
                        if price > 0:
                            logger.debug(f"💰 [COINGECKO] {symbol} price: ${price:,.2f}")
                            return price
                else:
                    logger.debug(f"CoinGecko returned status {response.status} for {symbol}")
                return None
    except asyncio.TimeoutError:
        logger.debug(f"CoinGecko timeout for {symbol}")
        return None
    except aiohttp.ClientError as e:
        logger.debug(f"CoinGecko client error for {symbol}: {e}")
        return None
    except Exception as e:
        logger.debug(f"CoinGecko fetch failed for {symbol}: {e}")
        return None


async def fetch_price_from_coinbase(symbol: str) -> Optional[float]:
    """Fetch current price from Coinbase API."""
    try:
        coinbase_symbol = COINBASE_SYMBOLS.get(symbol.upper())
        if not coinbase_symbol:
            return None
            
        ssl_context = get_ssl_context()
        connector = aiohttp.TCPConnector(ssl=ssl_context, limit=10)
        
        # Coinbase API endpoint for spot prices
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(
                f"https://api.coinbase.com/v2/prices/{coinbase_symbol}/spot",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    if "data" in data and "amount" in data["data"]:
                        price = float(data["data"]["amount"])
                        if price > 0:
                            logger.debug(f"💰 [COINBASE] {symbol} price: ${price:,.2f}")
                            return price
                return None
    except asyncio.TimeoutError:
        logger.debug(f"Coinbase timeout for {symbol}")
        return None
    except aiohttp.ClientError as e:
        logger.debug(f"Coinbase client error for {symbol}: {e}")
        return None
    except Exception as e:
        logger.debug(f"Coinbase fetch failed for {symbol}: {e}")
        return None


async def fetch_price_from_kraken(symbol: str) -> Optional[float]:
    """Fetch current price from Kraken API."""
    try:
        kraken_symbol = KRAKEN_SYMBOLS.get(symbol.upper())
        if not kraken_symbol:
            return None
            
        ssl_context = get_ssl_context()
        connector = aiohttp.TCPConnector(ssl=ssl_context, limit=10)
        
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(
                f"{KRAKEN_API_URL}?pair={kraken_symbol}",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    if "result" in data and kraken_symbol in data["result"]:
                        ticker = data["result"][kraken_symbol]
                        if "c" in ticker and len(ticker["c"]) > 0:
                            price = float(ticker["c"][0])
                            if price > 0:
                                logger.debug(f"💰 [KRAKEN] {symbol} price: ${price:,.2f}")
                                return price
                return None
    except asyncio.TimeoutError:
        logger.debug(f"Kraken timeout for {symbol}")
        return None
    except aiohttp.ClientError as e:
        logger.debug(f"Kraken client error for {symbol}: {e}")
        return None
    except Exception as e:
        logger.debug(f"Kraken fetch failed for {symbol}: {e}")
        return None


async def fetch_price_from_avantis_oracle(symbol: str) -> Optional[float]:
    """Fetch price from Avantis on-chain oracle (most reliable source)."""
    if not SDK_AVAILABLE:
        logger.debug(f"SDK not available for {symbol}")
        return None
    
    try:
        feed_client = FeedClient()
        pair_name = f"{symbol.upper()}/USD"
        
        logger.debug(f"💰 [ORACLE] Fetching {pair_name} from Avantis on-chain oracle...")
        
        # Get latest price from on-chain oracle
        price_data = await feed_client.get_latest_price_updates([pair_name])
        
        logger.debug(f"💰 [ORACLE] Price data type: {type(price_data)}, has parsed: {hasattr(price_data, 'parsed') if price_data else False}")
        
        if price_data and hasattr(price_data, 'parsed') and price_data.parsed:
            logger.debug(f"💰 [ORACLE] Found {len(price_data.parsed)} price(s)")
            for p in price_data.parsed:
                # Extract symbol from feed
                if hasattr(p, 'id') or hasattr(p, 'symbol'):
                    sym = getattr(p, 'symbol', None) or str(getattr(p, 'id', ''))
                    logger.debug(f"💰 [ORACLE] Processing symbol: {sym}, converted_price: {getattr(p, 'converted_price', 'N/A')}")
                    if '/' in sym:
                        sym = sym.split('/')[0]
                    if sym.upper() == symbol.upper():
                        price = p.converted_price
                        if price > 0:
                            logger.debug(f"💰 [AVANTIS_ORACLE] {symbol} price: ${price:,.2f}")
                            return price
        else:
            logger.warning(f"💰 [ORACLE] No parsed price data for {pair_name}")
        return None
    except Exception as e:
        logger.warning(f"Avantis oracle fetch failed for {symbol}: {e}")
        import traceback
        logger.debug(f"Oracle traceback: {traceback.format_exc()}")
        return None


async def fetch_price(symbol: str) -> Optional[float]:
    """Fetch price with fallback sources. Uses Avantis on-chain oracle as primary source."""
    # Try Avantis on-chain oracle first (most reliable, no external API needed)
    if SDK_AVAILABLE:
        price = await fetch_price_from_avantis_oracle(symbol)
        if price:
            return price
    
    # Fallback to external APIs (try all in parallel)
    tasks = [
        fetch_price_from_binance(symbol),
        fetch_price_from_coingecko(symbol),
        fetch_price_from_coinbase(symbol),
        fetch_price_from_kraken(symbol),
    ]
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Return first successful result
    for result in results:
        if isinstance(result, Exception):
            continue
        if result is not None and result > 0:
            return result
    
    logger.warning(f"Could not fetch price for {symbol} from any source")
    return None


async def fetch_prices_for_symbols(symbols: list[str]) -> Dict[str, float]:
    """
    Fetch current prices for multiple symbols.
    Uses Avantis SDK on-chain oracle as primary source for reliability.
    """
    import asyncio
    
    price_map: Dict[str, float] = {}
    unique_symbols = list(set(s.upper() for s in symbols if s))
    
    if not unique_symbols:
        return price_map
    
    # Try Avantis SDK FeedClient first (on-chain oracle, most reliable)
    if SDK_AVAILABLE:
        try:
            feed_client = FeedClient()
            pair_names = [f"{sym}/USD" for sym in unique_symbols]
            
            logger.info(f"💰 [ORACLE] Fetching prices from Avantis on-chain oracle for: {unique_symbols}")
            
            # Add timeout to oracle call
            try:
                price_data = await asyncio.wait_for(
                    feed_client.get_latest_price_updates(pair_names),
                    timeout=15.0  # 15 second timeout for oracle
                )
                
                logger.info(f"💰 [ORACLE] Received price data, type: {type(price_data)}")
                
                if price_data and hasattr(price_data, 'parsed'):
                    logger.info(f"💰 [ORACLE] Has parsed attr, data: {price_data.parsed if price_data.parsed else 'None'}")
                    if price_data.parsed:
                        logger.info(f"💰 [ORACLE] Processing {len(price_data.parsed)} price(s)")
                        
                        # Match prices by position in response (order should match request order)
                        for idx, p in enumerate(price_data.parsed):
                            # Get symbol from request order (most reliable)
                            if idx < len(unique_symbols):
                                symbol = unique_symbols[idx]
                                price = p.converted_price
                                if price > 0:
                                    price_map[symbol] = price
                                    logger.debug(f"💰 [ORACLE] ✅ {symbol} price: ${price:,.2f} (matched by position)")
                            else:
                                # Fallback: try to extract symbol from response
                                if hasattr(p, 'id') or hasattr(p, 'symbol'):
                                    sym = getattr(p, 'symbol', None) or str(getattr(p, 'id', ''))
                                    if '/' in sym:
                                        sym = sym.split('/')[0]
                                    sym_upper = sym.upper()
                                    logger.info(f"💰 [ORACLE] Found symbol: {sym_upper}")
                                    if sym_upper in unique_symbols:
                                        price = p.converted_price
                                        if price > 0:
                                            price_map[sym_upper] = price
                                            logger.debug(f"💰 [ORACLE] ✅ {sym_upper} price: ${price:,.2f}")
                
                if price_map:
                    logger.info(f"💰 [ORACLE] Successfully fetched {len(price_map)}/{len(unique_symbols)} prices from oracle")
                    return price_map  # Return immediately if oracle succeeded
                else:
                    logger.warning(f"💰 [ORACLE] No prices from oracle (parsed but empty), falling back to external APIs")
            except asyncio.TimeoutError:
                logger.warning(f"💰 [ORACLE] Timeout fetching from oracle (15s), falling back to external APIs")
        except Exception as e:
            logger.warning(f"💰 [ORACLE] Avantis oracle failed: {e}, falling back to external APIs")
            import traceback
            logger.debug(f"Oracle traceback: {traceback.format_exc()}")
    else:
        logger.info(f"💰 [ORACLE] SDK not available, using external APIs only")
    
    # Fallback: Fetch prices in parallel from external APIs
    logger.info(f"💰 [FALLBACK] Fetching from external APIs for: {unique_symbols}")
    tasks = [fetch_price(symbol) for symbol in unique_symbols]
    try:
        prices = await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as e:
        logger.error(f"Error in parallel price fetch: {e}")
        prices = [None] * len(unique_symbols)
    
    for symbol, price in zip(unique_symbols, prices):
        if isinstance(price, Exception):
            logger.warning(f"Error fetching price for {symbol}: {price}")
        elif price is not None and price > 0:
            price_map[symbol] = price
    
    if price_map:
        logger.info(f"💰 [PRICES] Fetched {len(price_map)}/{len(unique_symbols)} prices: {price_map}")
    else:
        logger.warning(f"💰 [PRICES] Failed to fetch any prices for {unique_symbols}")
    
    return price_map
