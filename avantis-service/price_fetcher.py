"""Price fetcher for calculating PnL - uses multiple sources with SSL fix."""
import logging
import aiohttp
import ssl
import certifi
from typing import Dict, Optional

logger = logging.getLogger(__name__)

# API endpoints
BINANCE_API_URL = "https://api.binance.com/api/v3/ticker/price"
COINGECKO_API_URL = "https://api.coingecko.com/api/v3/simple/price"

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
        connector = aiohttp.TCPConnector(ssl=ssl_context)
        
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(
                f"{BINANCE_API_URL}?symbol={binance_symbol}",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    price = float(data.get("price", 0))
                    if price > 0:
                        logger.info(f"💰 [BINANCE] {symbol} price: ${price:,.2f}")
                        return price
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
        connector = aiohttp.TCPConnector(ssl=ssl_context)
        
        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(
                f"{COINGECKO_API_URL}?ids={coin_id}&vs_currencies=usd",
                timeout=aiohttp.ClientTimeout(total=5)
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    if coin_id in data and "usd" in data[coin_id]:
                        price = float(data[coin_id]["usd"])
                        if price > 0:
                            logger.info(f"💰 [COINGECKO] {symbol} price: ${price:,.2f}")
                            return price
                return None
    except Exception as e:
        logger.debug(f"CoinGecko fetch failed for {symbol}: {e}")
        return None


async def fetch_price(symbol: str) -> Optional[float]:
    """Fetch price with fallback sources."""
    # Try Binance first
    price = await fetch_price_from_binance(symbol)
    if price:
        return price
    
    # Fallback to CoinGecko
    price = await fetch_price_from_coingecko(symbol)
    if price:
        return price
    
    logger.warning(f"Could not fetch price for {symbol} from any source")
    return None


async def fetch_prices_for_symbols(symbols: list[str]) -> Dict[str, float]:
    """Fetch current prices for multiple symbols."""
    import asyncio
    
    price_map: Dict[str, float] = {}
    unique_symbols = list(set(s.upper() for s in symbols))
    
    # Fetch prices in parallel
    tasks = [fetch_price(symbol) for symbol in unique_symbols]
    prices = await asyncio.gather(*tasks, return_exceptions=True)
    
    for symbol, price in zip(unique_symbols, prices):
        if isinstance(price, Exception):
            logger.warning(f"Error fetching price for {symbol}: {price}")
        elif price is not None and price > 0:
            price_map[symbol] = price
    
    logger.info(f"💰 [PRICES] Fetched: {price_map}")
    return price_map
