"""Configuration management for Avantis service."""
import logging
from typing import Optional, List
from pydantic_settings import BaseSettings

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Application settings."""
    
    # ------------------------------------------------------------------
    # Server configuration
    # ------------------------------------------------------------------
    host: str = "0.0.0.0"
    port: int = 8000
    debug: bool = False
    
    # ------------------------------------------------------------------
    # Network / RPC configuration
    # ------------------------------------------------------------------
    # Only Base Mainnet is supported by Avantis
    avantis_rpc_url: Optional[str] = None

    # ------------------------------------------------------------------
    # Core contract addresses (direct contract calls)
    # ------------------------------------------------------------------
    # Trading contract (main entry for open/close/updateTpAndSl)
    # Base Mainnet: 0x44914408af82bC9983bbb330e3578E1105e11d4e
    avantis_trading_contract_address: Optional[str] = "0x44914408af82bC9983bbb330e3578E1105e11d4e"

    # TradingCallbacks contract (THIS is where USDC approval must go!)
    # The Trading contract delegates to TradingCallbacks which does the actual USDC transferFrom.
    # Base Mainnet: 0x0C16ff40065Cc3Ab4bc55B60E447504AFB9C7970
    avantis_usdc_spender_address: Optional[str] = "0x0C16ff40065Cc3Ab4bc55B60E447504AFB9C7970"

    # TradingStorage contract (used for reading openTrades, positions)
    # Base Mainnet: 0x8a311D7048c35985aa31C131B9A13e03a5f7422d
    avantis_trading_storage_contract_address: Optional[str] = "0x8a311D7048c35985aa31C131B9A13e03a5f7422d"

    # PairInfos contract (optional, for pair configuration / limits)
    avantis_pair_infos_contract_address: Optional[str] = None

    # Max pair index to scan when reading positions if no explicit list
    avantis_max_pair_index: int = 32

    # ------------------------------------------------------------------
    # Token addresses
    # ------------------------------------------------------------------
    # USDC token address (Base Mainnet)
    usdc_token_address: str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

    # ------------------------------------------------------------------
    # Network helpers
    # ------------------------------------------------------------------
    def get_network_name(self) -> str:
        """Get human-readable network name."""
        return "Base Mainnet"
    
    def get_block_explorer_url(self) -> str:
        """Get block explorer URL for current network."""
        return "https://basescan.org"

    def get_effective_rpc_url(self) -> str:
        """
        Get the RPC URL to actually use.
        Falls back to Base Mainnet default if avantis_rpc_url is not set.
        """
        if self.avantis_rpc_url:
            return self.avantis_rpc_url
        return "https://mainnet.base.org"
    
    # ------------------------------------------------------------------
    # Retry configuration
    # ------------------------------------------------------------------
    max_retries: int = 3
    retry_delay: float = 1.0  # seconds
    
    # ------------------------------------------------------------------
    # CORS configuration
    # ------------------------------------------------------------------
    # Comma-separated string; converted to list by helper below.
    cors_origins: str = "http://localhost:3000,http://localhost:3001,https://avantis.superapp.gg"
    
    def get_cors_origins_list(self) -> List[str]:
        """Parse comma-separated CORS origins string into list."""
        if not self.cors_origins:
            return ["http://localhost:3000", "http://localhost:3001"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"  # Ignore extra fields from .env that aren't in the model


# Global settings instance - lazy initialization at runtime
_settings_instance: Optional[Settings] = None


def get_settings() -> Settings:
    """Get settings instance (lazy initialization at runtime)."""
    global _settings_instance
    if _settings_instance is None:
        _settings_instance = Settings()
    
    return _settings_instance


# For backward compatibility, create settings on first import
settings = get_settings()
