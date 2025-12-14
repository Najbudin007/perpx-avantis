"""FastAPI main application for Avantis trading service."""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, HTTPException, status, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from config import settings
from cache import cache

# Import operation modules
from trade_operations import (
    open_position,
    close_position,
    close_all_positions,
    update_tp_sl,
    update_margin,
    cancel_limit_order,
)
from position_queries import (
    get_positions,
    get_balance,
    get_total_pnl,
    get_usdc_allowance,
    approve_usdc,
    get_trade_history
)
from symbols import SymbolNotFoundError, get_all_supported_symbols, ensure_pair_map_initialized
from utils import map_exception_to_http_status
from transaction_preparation import (
    prepare_open_position_transaction,
    prepare_close_position_transaction,
    prepare_approve_usdc_transaction
)
from contract_operations import get_min_position_size_for_pair

# Configure logging
logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# Request/Response models
class OpenPositionRequest(BaseModel):
    symbol: str = Field(..., description="Trading symbol (e.g., BTC, ETH)")
    collateral: float = Field(..., gt=0, description="Collateral amount in USDC")
    leverage: int = Field(..., ge=2, le=50, description="Leverage multiplier (2x-50x)")
    is_long: bool = Field(..., description="True for long, False for short")
    tp: Optional[float] = Field(None, description="Take profit price")
    sl: Optional[float] = Field(None, description="Stop loss price")
    private_key: str = Field(..., description="User's private key (required - each user provides their own)")


class ClosePositionRequest(BaseModel):
    pair_index: int = Field(..., description="Avantis pair index")
    trade_index: int = Field(0, description="Trade index (defaults to 0 for backward compatibility)")
    private_key: str = Field(..., description="User's private key (required - each user provides their own)")


class CloseAllPositionsRequest(BaseModel):
    private_key: str = Field(..., description="User's private key (required - each user provides their own)")


class ApproveUSDCRequest(BaseModel):
    amount: float = Field(..., ge=0, description="Amount to approve (0 for unlimited)")
    private_key: str = Field(..., description="User's private key (required - each user provides their own)")


class PrepareOpenPositionRequest(BaseModel):
    symbol: str = Field(..., description="Trading symbol (e.g., BTC, ETH)")
    collateral: float = Field(..., gt=0, description="Collateral amount in USDC")
    leverage: int = Field(..., ge=2, le=50, description="Leverage multiplier (2x-50x)")
    is_long: bool = Field(..., description="True for long, False for short")
    address: str = Field(..., description="Base Account address (required for Base Accounts)")
    tp: Optional[float] = Field(None, description="Take profit price")
    sl: Optional[float] = Field(None, description="Stop loss price")


class PrepareClosePositionRequest(BaseModel):
    pair_index: int = Field(..., description="Avantis pair index")
    address: str = Field(..., description="Base Account address (required for Base Accounts)")


class PrepareApproveUSDCRequest(BaseModel):
    amount: float = Field(..., ge=0, description="Amount to approve (0 for unlimited)")
    address: str = Field(..., description="Base Account address (required for Base Accounts)")


class UpdateTpSlRequest(BaseModel):
    pair_index: int = Field(..., description="Avantis pair index")
    trade_index: int = Field(0, description="Trade index (defaults to 0)")
    new_tp: Optional[float] = Field(None, description="New take profit price (optional)")
    new_sl: Optional[float] = Field(None, description="New stop loss price (optional)")
    private_key: str = Field(..., description="User's private key (required)")


class UpdateMarginRequest(BaseModel):
    pair_index: int = Field(..., description="Avantis pair index")
    trade_index: int = Field(0, description="Trade index (defaults to 0)")
    update_type: int = Field(..., description="0 = DEPOSIT, 1 = WITHDRAW")
    amount_usdc: float = Field(..., gt=0, description="Amount in USDC")
    private_key: str = Field(..., description="User's private key (required)")


class CancelLimitOrderRequest(BaseModel):
    pair_index: int = Field(..., description="Avantis pair index")
    index: int = Field(..., description="Limit order index")
    private_key: str = Field(..., description="User's private key (required)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    logger.info("Starting Avantis Trading Service...")
    logger.info(f"Network: Base Mainnet")
    
    # Initialize pair map from SDK (if available) on startup
    try:
        from symbols.symbol_registry import ensure_pair_map_initialized
        # Await directly since we're in an async context
        await ensure_pair_map_initialized()
        logger.info("✅ Pair index map initialized (from SDK or static defaults)")
    except Exception as e:
        logger.warning(f"⚠️ Could not initialize pair map from SDK: {e}. Using static defaults.")
    
    logger.info(f"Supported symbols: {', '.join(get_all_supported_symbols())}")
    yield
    logger.info("Shutting down Avantis Trading Service...")


# Create FastAPI app
app = FastAPI(
    title="Avantis Trading Service",
    description="FastAPI microservice for Avantis trading operations",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add rate limiting middleware (60 requests/minute, 30 burst to handle multiple hooks and reduce flickering)
from rate_limit import RateLimitMiddleware
app.add_middleware(RateLimitMiddleware, requests_per_minute=60, burst=30)


# Health check endpoint - optimized for speed (no settings access, no middleware)
@app.get("/health", include_in_schema=False)
async def health_check(request: Request):
    """
    Health check endpoint.
    Optimized to return immediately without accessing settings or doing any I/O.
    Excluded from schema and should bypass heavy middleware.
    """
    # Return immediately - no I/O, no settings access
    from fastapi.responses import JSONResponse
    return JSONResponse(
        content={"status": "healthy", "service": "avantis-trading-service"},
        status_code=200
    )


# Cache stats endpoint (for monitoring)
@app.get("/api/cache/stats")
async def cache_stats():
    """Get cache statistics for monitoring."""
    try:
        # Use asyncio.wait_for with timeout to prevent hanging
        stats = await asyncio.wait_for(cache.get_stats_async(), timeout=1.0)
        return {
            "cache_stats": stats,
            "cache_enabled": True
        }
    except asyncio.TimeoutError:
        logger.warning("Cache stats timeout - returning basic stats")
        # Return basic stats without lock (non-blocking)
        return {
            "cache_stats": {
                "total_entries": len(cache._cache),
                "pending_requests": len(cache._pending_requests),
                "active_entries": sum(1 for entry in cache._cache.values() if not entry.is_expired()),
                "timeout": True
            },
            "cache_enabled": True
        }
    except Exception as e:
        logger.error(f"Error getting cache stats: {e}", exc_info=True)
        # Return basic stats on error (non-blocking)
        return {
            "cache_stats": {
                "total_entries": len(cache._cache),
                "pending_requests": len(cache._pending_requests),
                "active_entries": sum(1 for entry in cache._cache.values() if not entry.is_expired()),
                "error": str(e)
            },
            "cache_enabled": True
        }


# Trading operations endpoints
@app.post("/api/open-position")
async def api_open_position(request: OpenPositionRequest):
    # ==========================================
    # 🛡️ LAYER 1: API ENTRY POINT SAFEGUARD
    # ==========================================
    # CRITICAL: This is the FIRST line of defense - blocks invalid requests immediately
    # Prevents fund loss from "Transfer First, Validate Later" pattern
    # Updated: Avantis UI allows $10 minimum, so we match that
    # GUARANTEE: No request with < $10 reaches trading logic
    MIN_SAFE_COLLATERAL = 10.0  # Matches Avantis UI minimum (allows $10 trades)
    if request.collateral < MIN_SAFE_COLLATERAL:
        raise HTTPException(
            status_code=400,
            detail=f"❌ CRITICAL: Collateral ${request.collateral} is below safe minimum ${MIN_SAFE_COLLATERAL}. "
                   f"DO NOT attempt trade - funds will be transferred but position will fail! "
                   f"Minimum required: ${MIN_SAFE_COLLATERAL} USDC"
        )
    """
    Open a trading position.
    """
    try:
        result = await open_position(
            symbol=request.symbol,
            collateral=request.collateral,
            leverage=request.leverage,
            is_long=request.is_long,
            tp=request.tp,
            sl=request.sl,
            private_key=request.private_key
        )
        # Invalidate positions cache for this user
        from eth_account import Account
        user_address = Account.from_key(request.private_key).address
        await cache.invalidate("positions", private_key=request.private_key, address=None)
        await cache.invalidate("positions", private_key=None, address=user_address)
        logger.info(f"💾 [CACHE] Invalidated positions cache after opening position")
        return result
    except SymbolNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Symbol not supported: {str(e)}"
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error in open_position: {e}", exc_info=True)
        http_status = map_exception_to_http_status(e)
        raise HTTPException(
            status_code=http_status,
            detail=f"Failed to open position: {str(e)}"
        )


@app.post("/api/close-position")
async def api_close_position(request: ClosePositionRequest):
    """
    Close a specific position by pair index.
    """
    try:
        result = await close_position(
            pair_index=request.pair_index,
            trade_index=request.trade_index,  # Use provided trade_index instead of hardcoding 0
            private_key=request.private_key
        )
        # Invalidate positions and trade history cache for this user
        from eth_account import Account
        user_address = Account.from_key(request.private_key).address
        await cache.invalidate("positions", private_key=request.private_key, address=None)
        await cache.invalidate("positions", private_key=None, address=user_address)
        await cache.invalidate("trade-history", private_key=request.private_key, address=None)
        await cache.invalidate("trade-history", private_key=None, address=user_address)
        logger.info(f"💾 [CACHE] Invalidated positions and trade history cache after closing position")
        return result
    except Exception as e:
        logger.error(f"Error in close_position: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to close position: {str(e)}"
        )


@app.post("/api/close-all-positions")
async def api_close_all_positions(request: CloseAllPositionsRequest):
    """
    Close all open positions.
    """
    try:
        result = await close_all_positions(
            private_key=request.private_key
        )
        # Invalidate positions and trade history cache for this user
        from eth_account import Account
        user_address = Account.from_key(request.private_key).address
        await cache.invalidate("positions", private_key=request.private_key, address=None)
        await cache.invalidate("positions", private_key=None, address=user_address)
        await cache.invalidate("trade-history", private_key=request.private_key, address=None)
        await cache.invalidate("trade-history", private_key=None, address=user_address)
        logger.info(f"💾 [CACHE] Invalidated positions and trade history cache after closing all positions")
        return result
    except Exception as e:
        logger.error(f"Error in close_all_positions: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to close all positions: {str(e)}"
        )


@app.post("/api/update-tp-sl")
async def api_update_tp_sl(request: UpdateTpSlRequest):
    """
    Update take profit and/or stop loss for a position.
    """
    try:
        result = await update_tp_sl(
            pair_index=request.pair_index,
            trade_index=request.trade_index,
            new_tp=request.new_tp,
            new_sl=request.new_sl,
            private_key=request.private_key
        )
        # Invalidate positions cache for this user (TP/SL changes affect position data)
        from eth_account import Account
        user_address = Account.from_key(request.private_key).address
        await cache.invalidate("positions", private_key=request.private_key, address=None)
        await cache.invalidate("positions", private_key=None, address=user_address)
        logger.info(f"💾 [CACHE] Invalidated positions cache after updating TP/SL")
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error in update_tp_sl: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update TP/SL: {str(e)}"
        )


@app.post("/api/update-margin")
async def api_update_margin(request: UpdateMarginRequest):
    """
    Update margin (deposit or withdraw) for a position.
    """
    try:
        if request.update_type not in [0, 1]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="update_type must be 0 (DEPOSIT) or 1 (WITHDRAW)"
            )
        result = await update_margin(
            pair_index=request.pair_index,
            trade_index=request.trade_index,
            update_type=request.update_type,
            amount_usdc=request.amount_usdc,
            private_key=request.private_key
        )
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error in update_margin: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update margin: {str(e)}"
        )


@app.post("/api/cancel-limit-order")
async def api_cancel_limit_order(request: CancelLimitOrderRequest):
    """
    Cancel an open limit order.
    """
    try:
        result = await cancel_limit_order(
            pair_index=request.pair_index,
            index=request.index,
            private_key=request.private_key
        )
        return result
    except Exception as e:
        logger.error(f"Error in cancel_limit_order: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel limit order: {str(e)}"
        )


# Query endpoints
@app.get("/api/positions")
async def api_get_positions(
    private_key: Optional[str] = Query(None, description="User's private key (for traditional wallets)"),
    address: Optional[str] = Query(None, description="User's address (for Base Accounts)")
):
    """
    Get all open positions for a user.
    
    For Base Accounts: provide address (no private key needed for read operations)
    For traditional wallets: provide private_key
    """
    # Log the request (mask private key for security)
    masked_key = f"{private_key[:10]}...{private_key[-4:]}" if private_key and len(private_key) > 14 else "***"
    logger.info(f"📊 [API] GET /api/positions - private_key={masked_key}, address={address}")
    
    if not private_key and not address:
        logger.warning("📊 [API] No private_key or address provided")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either private_key (traditional wallets) or address (Base Accounts) must be provided"
        )
    try:
        # Derive address from private key for logging
        if private_key:
            from eth_account import Account
            derived_address = Account.from_key(private_key).address
            logger.info(f"📊 [API] Derived address from private_key: {derived_address}")
        
        # Use cache with 20 second TTL (positions change frequently)
        # Add timeout wrapper to prevent hanging (30 seconds max)
        async def _fetch_positions():
            try:
                # Wrap with timeout to prevent hanging on slow RPC calls
                return await asyncio.wait_for(
                    get_positions(private_key=private_key, address=address),
                    timeout=30.0
                )
            except asyncio.TimeoutError:
                logger.warning("📊 [API] Position fetching timed out after 30s - RPC may be slow")
                # Return empty positions on timeout (better than hanging)
                return []
        
        positions = await cache.get_or_compute(
            "positions",
            _fetch_positions,
            ttl=30.0,  # Cache for 30 seconds (increased to reduce requests and rate limiting)
            private_key=private_key,
            address=address
        )
        
        logger.info(f"📊 [API] Returning {len(positions)} position(s)")
        return {"positions": positions, "count": len(positions)}
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        logger.warning("📊 [API] Timeout fetching positions - RPC may be slow, returning empty positions")
        return {"positions": [], "count": 0}
    except Exception as e:
        error_msg = str(e)
        # If it's a timeout or connection error, return empty positions instead of 500
        if "timeout" in error_msg.lower() or "connection" in error_msg.lower() or "econnrefused" in error_msg.lower():
            logger.warning(f"📊 [API] Network error fetching positions: {e} - returning empty positions")
            return {"positions": [], "count": 0}
        logger.error(f"📊 [API] Error in get_positions: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get positions: {str(e)}"
        )


@app.get("/api/balance")
async def api_get_balance(
    private_key: Optional[str] = Query(None, description="User's private key (for traditional wallets)"),
    address: Optional[str] = Query(None, description="User's address (for Base Accounts)")
):
    """
    Get account balance information for a user.
    
    For Base Accounts: provide address (no private key needed for read operations)
    For traditional wallets: provide private_key
    """
    if not private_key and not address:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either private_key (traditional wallets) or address (Base Accounts) must be provided"
        )
    try:
        balance = await get_balance(private_key=private_key, address=address)
        return balance
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_balance: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get balance: {str(e)}"
        )


@app.get("/api/total-pnl")
async def api_get_total_pnl(
    private_key: Optional[str] = Query(None, description="User's private key (for traditional wallets)"),
    address: Optional[str] = Query(None, description="User's address (for Base Accounts)")
):
    """
    Get total unrealized PnL for a user.

    For Base Accounts: provide address (no private key needed for read operations)
    For traditional wallets: provide private_key
    """
    if not private_key and not address:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either private_key (traditional wallets) or address (Base Accounts) must be provided"
        )
    try:
        total_pnl = await get_total_pnl(private_key=private_key, address=address)
        return {"total_pnl": total_pnl}
    except Exception as e:
        logger.error(f"Error in get_total_pnl: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get total PnL: {str(e)}"
        )


@app.get("/api/prices")
async def api_get_prices(
    symbols: str = Query(..., description="Comma-separated list of symbols (e.g., BTC,ETH,SOL)")
):
    """
    Get current prices for multiple symbols (lightweight endpoint for real-time updates).
    This endpoint only fetches prices without fetching full position data.
    """
    try:
        from price_fetcher import fetch_prices_for_symbols
        
        symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if not symbol_list:
            return {"prices": {}}
        
        price_map = await fetch_prices_for_symbols(symbol_list)
        return {"prices": price_map}
    except Exception as e:
        logger.error(f"Error in get_prices: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get prices: {str(e)}"
        )


@app.get("/api/trade-history")
async def api_get_trade_history(
    private_key: Optional[str] = Query(None, description="User's private key (for traditional wallets)"),
    address: Optional[str] = Query(None, description="User's address (for Base Accounts)"),
    limit: int = Query(50, ge=1, le=200, description="Maximum number of trades to return")
):
    """
    Get trade history (closed trades) for a user.
    
    NOTE: This endpoint is deprecated. The Next.js API route now calls Avantis API directly.
    This is kept for backwards compatibility only.
    
    For Base Accounts: provide address (no private key needed for read operations)
    For traditional wallets: provide private_key
    """
    # Log the request
    masked_key = f"{private_key[:10]}...{private_key[-4:]}" if private_key and len(private_key) > 14 else "***"
    logger.info(f"📜 [API] GET /api/trade-history - private_key={masked_key}, address={address}, limit={limit}")
    
    if not private_key and not address:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Either private_key (traditional wallets) or address (Base Accounts) must be provided"
        )
    
    try:
        # Use cache with 60 second TTL (trade history changes less frequently)
        async def _fetch_history():
            return await get_trade_history(private_key=private_key, address=address, limit=limit)
        
        history = await cache.get_or_compute(
            "trade-history",
            _fetch_history,
            ttl=60.0,  # Cache for 60 seconds (trade history is expensive to query)
            private_key=private_key,
            address=address,
            limit=limit
        )
        
        logger.info(f"📜 [API] Returning {len(history)} historical trade(s)")
        return {
            "trades": history, 
            "count": len(history),
            "message": "Trade history fetched from Avantis API."
        }
    except Exception as e:
        logger.error(f"Error in get_trade_history: {e}", exc_info=True)
        # Return empty history on error (don't fail the request)
        return {
            "trades": [], 
            "count": 0, 
            "error": str(e),
            "message": "Error fetching trade history from Avantis API."
        }


@app.get("/api/min-position")
async def api_get_min_position(
    pair_index: int = Query(..., ge=0, description="Avantis pair index"),
    leverage: int = Query(..., ge=1, description="Leverage multiplier (>= 1)")
):
    """
    Get minimum position size requirement for a pair at a given leverage.
    
    This endpoint queries the on-chain pairMinLevPosUSDC value and calculates
    the minimum collateral required for a position at the specified leverage.
    
    Returns:
        - pair_index: The pair index
        - leverage: The leverage multiplier
        - pair_min_lev_pos_usdc: Minimum leveraged position size in USDC (raw wei, 6 decimals)
        - min_collateral_usdc: Minimum collateral required in USDC (human-readable)
        - status: "success" or "error"
        - error: Error message if status is "error"
    """
    try:
        result = await get_min_position_size_for_pair(
            pair_index=pair_index,
            leverage=leverage
        )
        
        if result.get("status") == "error":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=result.get("error", "Failed to fetch minimum position size")
            )
        
        return result
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except (asyncio.TimeoutError, asyncio.CancelledError) as e:
        logger.warning(f"Timeout/cancellation in get_min_position_size_for_pair: {e}")
        # Return default minimum: $10
        default_min = 10.0
        return {
            "pair_index": pair_index,
            "leverage": leverage,
            "min_collateral_usdc": default_min,
            "min_position_size_usdc": default_min * leverage,
            "note": "Using default minimum due to RPC timeout"
        }
    except Exception as e:
        error_msg = str(e)
        logger.warning(f"Error in get_min_position_size_for_pair: {e}")
        # If contract call fails, return a default minimum instead of error
        if "execution reverted" in error_msg.lower() or "no data" in error_msg.lower() or "timeout" in error_msg.lower() or "cancelled" in error_msg.lower():
            # Return default minimum: $10
            default_min = 10.0
            return {
                "pair_index": pair_index,
                "leverage": leverage,
                "min_collateral_usdc": default_min,
                "min_position_size_usdc": default_min * leverage,
                "note": "Using default minimum due to RPC/contract error"
            }
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get minimum position size: {str(e)}"
        )


@app.get("/api/usdc-allowance")
async def api_get_usdc_allowance(
    private_key: str = Query(..., description="User's private key (required - backend wallet)")
):
    """
    Get current USDC allowance for a user.
    
    Requires private_key (backend wallet for trading).
    """
    if not private_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="private_key is required"
        )
    try:
        allowance = await get_usdc_allowance(private_key=private_key)
        return {"allowance": allowance}
    except Exception as e:
        logger.error(f"Error in get_usdc_allowance: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get USDC allowance: {str(e)}"
        )


@app.post("/api/approve-usdc")
async def api_approve_usdc(request: ApproveUSDCRequest):
    """
    Approve USDC for trading.
    """
    try:
        result = await approve_usdc(
            amount=request.amount,
            private_key=request.private_key
        )
        return result
    except Exception as e:
        logger.error(f"Error in approve_usdc: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to approve USDC: {str(e)}"
        )


# Transaction preparation endpoints (for Base Accounts)
@app.post("/api/prepare/open-position")
async def api_prepare_open_position(request: PrepareOpenPositionRequest):
    """
    Prepare transaction data for opening a position (Base Account).
    
    Returns transaction data that the frontend should sign via Base Account SDK.
    """
    try:
        result = await prepare_open_position_transaction(
            symbol=request.symbol,
            collateral=request.collateral,
            leverage=request.leverage,
            is_long=request.is_long,
            address=request.address,
            tp=request.tp,
            sl=request.sl
        )
        return result
    except SymbolNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Symbol not supported: {str(e)}"
        )
    except Exception as e:
        logger.error(f"Error preparing open position transaction: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to prepare transaction: {str(e)}"
        )


@app.post("/api/prepare/close-position")
async def api_prepare_close_position(request: PrepareClosePositionRequest):
    """
    Prepare transaction data for closing a position (Base Account).
    
    Returns transaction data that the frontend should sign via Base Account SDK.
    """
    try:
        result = await prepare_close_position_transaction(
            pair_index=request.pair_index,
            address=request.address
        )
        return result
    except Exception as e:
        logger.error(f"Error preparing close position transaction: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to prepare transaction: {str(e)}"
        )


@app.post("/api/prepare/approve-usdc")
async def api_prepare_approve_usdc(request: PrepareApproveUSDCRequest):
    """
    Prepare transaction data for USDC approval (Base Account).
    
    Returns transaction data that the frontend should sign via Base Account SDK.
    """
    try:
        result = await prepare_approve_usdc_transaction(
            amount=request.amount,
            address=request.address
        )
        return result
    except Exception as e:
        logger.error(f"Error preparing approve USDC transaction: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to prepare transaction: {str(e)}"
        )


# Utility endpoints
@app.get("/api/symbols")
async def api_get_symbols():
    """
    Get all supported trading symbols.
    """
    symbols = get_all_supported_symbols()
    return {"symbols": symbols, "count": len(symbols)}


@app.get("/api/min-position")
async def api_get_min_position(
    pair_index: int = Query(..., description="Trading pair index"),
    leverage: int = Query(..., ge=2, le=50, description="Leverage multiplier (2x-50x)")
):
    """
    Get the minimum collateral required for a position at a given leverage.
    
    This endpoint queries the on-chain contract to get the actual minimum
    position size requirement, allowing the frontend to dynamically adjust
    validation and UI sliders.
    
    Returns:
        Dictionary with minimum collateral in USDC
    """
    try:
        from contract_operations import get_min_position_size_usdc
        
        min_collateral = await get_min_position_size_usdc(
            pair_index=pair_index,
            leverage=leverage
        )
        
        return {
            "pair_index": pair_index,
            "leverage": leverage,
            "min_collateral_usdc": min_collateral,
            "min_position_value_usdc": min_collateral * leverage,
        }
    except Exception as e:
        logger.error(f"Error getting min position size: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get minimum position size: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=settings.debug
    )

