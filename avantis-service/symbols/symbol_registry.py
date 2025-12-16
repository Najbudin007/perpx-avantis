"""Symbol registry mapping trading symbols to Avantis pair indices.

This module is the ONLY place where the Avantis SDK is allowed to be used,
and only for READ-ONLY metadata calls:

- get_pairs_info()
- get_pairs_count()
- (optionally) get_pair_index(symbol)

All trading interactions (open/close positions, margin, quotes, etc.) MUST
continue to use our direct smart-contract calls and NOT the SDK.

The registry bootstraps from a static default map, and can be refreshed from
the SDK once per process. After that, only the in-memory cache is used.
"""

from typing import Dict, Optional, List, Any

import logging

logger = logging.getLogger(__name__)

try:  # Optional, best-effort Avantis SDK import
    # Using the official Avantis Trader SDK package
    # The SDK is ONLY used for read-only metadata (get_pairs_info, get_pairs_count).
    from avantis_trader_sdk import FeedClient  # type: ignore[import]
    import asyncio
except Exception:  # pragma: no cover - SDK may not be installed in all envs
    FeedClient = None  # type: ignore[assignment,misc]
    logger.debug("Avantis SDK not available; using static symbol registry only.")


# ----------------------------------------------------------------------
# Static default mapping (used as fallback and initial bootstrap)
# ----------------------------------------------------------------------

SYMBOL_TO_PAIR_INDEX: Dict[str, int] = {
    # Core pairs (verified on Avantis Base mainnet)
    "BTC": 0,   # BTC/USD pair index (default)
    "ETH": 1,   # ETH/USD pair index
    "SOL": 2,
    "AVAX": 3,
    "BNB": 4,   # Note: BNB is at index 4 on Avantis Base mainnet
    "ARB": 5,
    "DOGE": 6,
    "OP": 7,
    "LINK": 8,
    "AAVE": 9,
    "NEAR": 10,
    "FET": 11,
    "SUI": 12,
    "JUP": 13,
    "MATIC": 14,  # MATIC/POL
    "WLD": 15,
    "TAO": 16,
    "EIGEN": 17,
    # Additional pairs
    "UNI": 18,
    "ATOM": 19,
    "DOT": 20,
    "ADA": 21,
    "XRP": 22,
    "MKR": 23,
    "LTC": 24,
    "WIF": 25,   # WIF is at index 25 (verified from transaction logs)
    "PEPE": 26,
    "BONK": 27,
    "RENDER": 28,
    "INJ": 29,
    "SEI": 30,
    "TIA": 31,
}

# Reverse mapping for pair index to symbol
PAIR_INDEX_TO_SYMBOL: Dict[int, str] = {v: k for k, v in SYMBOL_TO_PAIR_INDEX.items()}

# In-memory cache flag
_PAIR_MAP_INITIALIZED_FROM_SDK: bool = False


def _normalize_symbol(symbol: str) -> str:
    return symbol.upper().strip()


def get_pair_index(symbol: str) -> Optional[int]:
    """
    Get Avantis pair index for a given symbol.
    
    Args:
        symbol: Trading symbol (e.g., "BTC", "ETH")
        
    Returns:
        Pair index if found, None otherwise.

    Note: this function only uses the in-memory cached map. If the SDK-based
    initialization has run, the cache reflects on-chain metadata; otherwise
    it falls back to the static defaults above.
    """
    normalized_symbol = _normalize_symbol(symbol)
    return SYMBOL_TO_PAIR_INDEX.get(normalized_symbol)


def get_symbol(pair_index: int) -> Optional[str]:
    """
    Get trading symbol for a given pair index.
    
    Args:
        pair_index: Avantis pair index
        
    Returns:
        Trading symbol if found, None otherwise.
    """
    return PAIR_INDEX_TO_SYMBOL.get(pair_index)


def is_symbol_supported(symbol: str) -> bool:
    """
    Check if a symbol is supported.
    
    Args:
        symbol: Trading symbol
        
    Returns:
        True if symbol is supported, False otherwise.
    """
    return get_pair_index(symbol) is not None


def get_all_supported_symbols() -> list[str]:
    """
    Get all supported trading symbols.
    
    Returns:
        List of supported symbols.
    """
    return list(SYMBOL_TO_PAIR_INDEX.keys())


def update_pair_index(symbol: str, pair_index: int) -> None:
    """
    Update or add a symbol to pair index mapping.
    
    Args:
        symbol: Trading symbol
        pair_index: Avantis pair index
    """
    normalized_symbol = _normalize_symbol(symbol)
    SYMBOL_TO_PAIR_INDEX[normalized_symbol] = pair_index
    PAIR_INDEX_TO_SYMBOL[pair_index] = normalized_symbol


class SymbolNotFoundError(Exception):
    """Raised when a symbol is not found in the registry."""
    pass


# ----------------------------------------------------------------------
# Avantis SDK integration (READ-ONLY metadata only)
# ----------------------------------------------------------------------

def _build_sdk_client() -> Optional[Any]:
    """
    Build an Avantis SDK FeedClient instance, if the SDK is available.

    This MUST NOT be used for any trading functions; only for:
    - default_pair_fetcher() - to get pair metadata
    """
    if FeedClient is None:
        return None

    try:
        # FeedClient doesn't require any arguments for read-only operations
        client = FeedClient()
        return client
    except Exception as e:  # pragma: no cover - environment-specific
        logger.warning(f"Failed to initialize Avantis SDK FeedClient: {e}")
        return None


async def refresh_pair_index_map_from_sdk() -> None:
    """
    Refresh the in-memory symbol ↔ pair_index map using the Avantis SDK.

    This function:
    - Calls ONLY read-only SDK methods (get_pairs_info / get_pairs_count /
      optional get_pair_index).
    - Updates the local SYMBOL_TO_PAIR_INDEX and PAIR_INDEX_TO_SYMBOL.
    - Caches the map in memory for subsequent calls.

    If the SDK is not available or the call fails, the static defaults remain
    in place and are used as a fallback.
    """
    global _PAIR_MAP_INITIALIZED_FROM_SDK

    client = _build_sdk_client()
    if client is None:
        logger.info("Avantis SDK not available; using static symbol registry.")
        return

    try:
        # Use default_pair_fetcher() which is async
        pairs: List[Dict[str, Any]] = []

        if hasattr(client, "default_pair_fetcher"):
            # default_pair_fetcher() is async, await it directly
            try:
                pairs_info = await client.default_pair_fetcher()  # type: ignore[attr-defined]
                
                # Convert to list if it's not already (might be dict_values or similar)
                if not isinstance(pairs_info, list):
                    pairs_info = list(pairs_info)
                
                # Convert to list of dicts
                for p in pairs_info:
                    if hasattr(p, '__dict__'):
                        pairs.append(vars(p))
                    elif isinstance(p, dict):
                        pairs.append(p)
                    else:
                        # Try to convert to dict - check for common attributes
                        pair_dict = {}
                        if hasattr(p, 'symbol'):
                            pair_dict['symbol'] = getattr(p, 'symbol')
                        if hasattr(p, 'pair_index') or hasattr(p, 'index'):
                            pair_dict['pair_index'] = getattr(p, 'pair_index', None) or getattr(p, 'index', None)
                        if hasattr(p, 'name'):
                            pair_dict['name'] = getattr(p, 'name')
                        if pair_dict:
                            pairs.append(pair_dict)
                        else:
                            pairs.append({"pair": str(p)})
            except Exception as e:
                logger.warning(f"Failed to fetch pairs from SDK: {e}")
                return
        else:
            logger.warning(
                "Avantis SDK FeedClient does not expose default_pair_fetcher; "
                "falling back to static mapping."
            )
            return

        if not pairs:
            logger.warning("Avantis SDK returned empty pairs list; keeping static mapping.")
            return

        # Clear current maps and rebuild from SDK data
        SYMBOL_TO_PAIR_INDEX.clear()
        PAIR_INDEX_TO_SYMBOL.clear()

        for pair in pairs:
            # Extract symbol from various possible locations in SDK response
            symbol = None
            idx = None
            
            if isinstance(pair, dict):
                # Try 'from' field first (e.g., 'ETH', 'BTC')
                symbol = pair.get("from")
                # If not found, try feed.attributes.symbol (e.g., 'Crypto.ETH/USD')
                if not symbol:
                    feed_attrs = pair.get("feed", {}).get("attributes", {})
                    symbol = feed_attrs.get("symbol")
                    # Extract just the base symbol from 'Crypto.ETH/USD' -> 'ETH'
                    if symbol and "/" in symbol:
                        symbol = symbol.split("/")[0].split(".")[-1]
                
                # Extract pair index - IMPORTANT: use 'in' check to handle index=0 correctly
                # (0 is falsy in Python, so we can't use `or` chain)
                if "index" in pair and pair["index"] is not None:
                    idx = pair["index"]
                elif "pair_index" in pair and pair["pair_index"] is not None:
                    idx = pair["pair_index"]
                elif "id" in pair and pair["id"] is not None:
                    idx = pair["id"]
            elif hasattr(pair, '__dict__'):
                # Object with attributes
                pair_dict = vars(pair)
                symbol = pair_dict.get("from") or pair_dict.get("symbol")
                # Same fix for objects
                if "index" in pair_dict and pair_dict["index"] is not None:
                    idx = pair_dict["index"]
                elif "pair_index" in pair_dict and pair_dict["pair_index"] is not None:
                    idx = pair_dict["pair_index"]
            else:
                continue

            if symbol is None or idx is None:
                continue

            try:
                symbol_str = _normalize_symbol(str(symbol))
                pair_index_int = int(idx)
                
                # Add to registry
                SYMBOL_TO_PAIR_INDEX[symbol_str] = pair_index_int
                PAIR_INDEX_TO_SYMBOL[pair_index_int] = symbol_str
            except Exception as e:
                logger.debug(f"Skipping pair due to parsing error: {e}")
                continue

        _PAIR_MAP_INITIALIZED_FROM_SDK = True
        logger.info(
            "✅ Avantis symbol registry initialized from SDK: "
            f"{len(SYMBOL_TO_PAIR_INDEX)} pairs loaded."
        )
    except Exception as e:  # pragma: no cover - external dependency
        logger.warning(f"Failed to refresh symbol registry from Avantis SDK: {e}")


async def ensure_pair_map_initialized() -> None:
    """
    Ensure the pair map has been initialized from the SDK at least once.

    This is safe to call from trading code; it will only ever use the SDK
    for read-only metadata, and only in this module.
    """
    global _PAIR_MAP_INITIALIZED_FROM_SDK

    if _PAIR_MAP_INITIALIZED_FROM_SDK:
        return

    # Best-effort initialization; if it fails we keep static defaults.
    await refresh_pair_index_map_from_sdk()


def ensure_pair_map_initialized_sync() -> None:
    """
    Synchronous wrapper for ensure_pair_map_initialized().
    For use in non-async contexts - will use static mappings if SDK fails.
    """
    global _PAIR_MAP_INITIALIZED_FROM_SDK

    if _PAIR_MAP_INITIALIZED_FROM_SDK:
        return

    # Try to run async version, but if we're not in an async context, just use static
    try:
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Can't run in already-running loop, use static
                logger.debug("Event loop already running, using static mappings")
                return
        except RuntimeError:
            pass
        
        # Try to run
        asyncio.run(refresh_pair_index_map_from_sdk())
    except Exception:
        # Fall back to static mappings
        logger.debug("Could not initialize from SDK synchronously, using static mappings")


