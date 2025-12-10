"""Direct Web3 contract interface for Avantis Trading (no SDK)."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from eth_account import Account
from web3 import Web3

# ContractFunction type from web3.contract - use Any for type checkers that don't have web3 stubs
try:
    from web3.contract import ContractFunction  # type: ignore[import-untyped]
except (ImportError, AttributeError):
    # Fallback: use Any for type checkers that don't recognize web3.contract.ContractFunction
    ContractFunction = Any  # type: ignore[assignment, misc]

from config import settings


_CONTRACTS_DIR = os.path.join(os.path.dirname(__file__), "contracts")
_TRADING_ABI_PATH = os.path.join(_CONTRACTS_DIR, "trading_abi.json")


@dataclass
class TradeParams:
    """
    Parameters for building the ITradingStorage.Trade struct.

    All numeric fields are already in on-chain units:
    - collateral_usdc: USDC 6-decimals (e.g. 10 USDC -> 10 * 1e6)
    - tp_price / sl_price / open_price: 10-decimal price (e.g. 65000 -> 65000 * 1e10)
    """

    trader: str
    pair_index: int
    collateral_usdc: int
    leverage: int
    is_long: bool
    tp_price: int = 0
    sl_price: int = 0
    open_price: int = 0
    index: int = 0
    initial_pos_token: int = 0
    timestamp: int = 0


class AvantisTradingContract:
    """
    Direct interface to the Avantis Trading contract (no SDK).
    """

    def __init__(
        self,
        rpc_url: Optional[str] = None,
        contract_address: Optional[str] = None,
        private_key: Optional[str] = None,
    ) -> None:
        rpc = rpc_url or getattr(settings, "avantis_rpc_url", None) or "https://mainnet.base.org"
        self.web3 = Web3(Web3.HTTPProvider(rpc))
        if not self.web3.is_connected():
            raise RuntimeError(f"Web3 provider not reachable: {rpc}")

        addr = contract_address or settings.avantis_trading_contract_address
        if not addr:
            raise ValueError("Trading contract address not configured in settings.")
        self.contract_address = Web3.to_checksum_address(addr)

        if not os.path.exists(_TRADING_ABI_PATH):
            raise FileNotFoundError(
                f"Trading ABI file not found at '{_TRADING_ABI_PATH}'. "
                "Make sure contracts/trading_abi.json exists."
            )

        with open(_TRADING_ABI_PATH, "r") as f:
            self.abi: List[Dict[str, Any]] = json.load(f)

        self.contract = self.web3.eth.contract(
            address=self.contract_address,
            abi=self.abi,
        )

        self.account: Optional[Account] = None
        self.address: Optional[str] = None
        if private_key:
            if not private_key.startswith("0x"):
                private_key = f"0x{private_key}"
            account = Account.from_key(private_key)
            self.account = account
            self.address = account.address

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _require_account(self) -> None:
        if not self.account or not self.address:
            raise ValueError("Private key is required for this operation.")

    # ------------------------------------------------------------------
    # Trade struct builder
    # ------------------------------------------------------------------

    def build_trade_struct(self, params: TradeParams) -> Dict[str, Any]:
        """
        Build a dict compatible with ITradingStorage.Trade.

        struct Trade {
            address trader;
            uint pairIndex;
            uint index;
            uint initialPosToken;
            uint positionSizeUSDC;
            uint openPrice;
            bool buy;
            uint leverage;
            uint tp;
            uint sl;
            uint timestamp;
        }
        """
        return {
            "trader": Web3.to_checksum_address(params.trader),
            "pairIndex": int(params.pair_index),
            "index": int(params.index),
            "initialPosToken": int(params.initial_pos_token),
            "positionSizeUSDC": int(params.collateral_usdc),
            "openPrice": int(params.open_price),
            "buy": bool(params.is_long),
            "leverage": int(params.leverage),
            "tp": int(params.tp_price),
            "sl": int(params.sl_price),
            "timestamp": int(params.timestamp),
        }

    # ------------------------------------------------------------------
    # Raw function accessors
    # ------------------------------------------------------------------

    def open_trade_function(
        self,
        trade_struct: Dict[str, Any],
        order_type: int,
        slippage_p: int,
    ) -> ContractFunction:
        """
        Trading.openTrade(ITradingStorage.Trade, uint8, uint256)
        """
        return self.contract.functions.openTrade(trade_struct, order_type, slippage_p)

    def close_trade_market_function(
        self,
        pair_index: int,
        index: int,
        amount: int,
    ) -> ContractFunction:
        """
        Trading.closeTradeMarket(uint256, uint256, uint256)
        """
        return self.contract.functions.closeTradeMarket(
            int(pair_index),
            int(index),
            int(amount),
        )

    def update_tp_sl_function(
        self,
        pair_index: int,
        index: int,
        new_sl: int,
        new_tp: int,
        price_update_data: Optional[List[bytes]] = None,
    ) -> ContractFunction:
        """
        Trading.updateTpAndSl(uint256, uint256, uint256, uint256, bytes[])
        """
        if price_update_data is None:
            price_update_data = []
        return self.contract.functions.updateTpAndSl(
            int(pair_index),
            int(index),
            int(new_sl),
            int(new_tp),
            price_update_data,
        )

    def update_margin_function(
        self,
        pair_index: int,
        index: int,
        update_type: int,
        amount_usdc_raw: int,
        price_update_data: Optional[List[bytes]] = None,
    ) -> ContractFunction:
        """
        Trading.updateMargin(uint256, uint256, uint8, uint256, bytes[])
        update_type: 0 = DEPOSIT, 1 = WITHDRAW
        amount_usdc_raw: USDC with 6 decimals
        """
        if price_update_data is None:
            price_update_data = []
        return self.contract.functions.updateMargin(
            int(pair_index),
            int(index),
            int(update_type),
            int(amount_usdc_raw),
            price_update_data,
        )

    def cancel_open_limit_order_function(
        self,
        pair_index: int,
        index: int,
    ) -> ContractFunction:
        """
        Trading.cancelOpenLimitOrder(uint256, uint256)
        """
        return self.contract.functions.cancelOpenLimitOrder(
            int(pair_index),
            int(index),
        )

    # ------------------------------------------------------------------
    # Generic EIP-1559 tx builder
    # ------------------------------------------------------------------

    def build_transaction(
        self,
        fn: ContractFunction,
        from_address: Optional[str] = None,
        value_wei: int = 0,
        gas: Optional[int] = None,
        max_fee_per_gas: Optional[int] = None,
        max_priority_fee_per_gas: Optional[int] = None,
        nonce: Optional[int] = None,
    ) -> Dict[str, Any]:
        if from_address is None:
            if not self.address:
                raise ValueError("from_address is required when no private key was provided.")
            from_address = self.address
            assert from_address is not None, "from_address must be set"

        from_address = Web3.to_checksum_address(from_address)

        if nonce is None:
            nonce = self.web3.eth.get_transaction_count(from_address, "pending")

        if max_fee_per_gas is None or max_priority_fee_per_gas is None:
            base_fee = self.web3.eth.gas_price
            tip = base_fee // 10  # 10% tip
            max_priority_fee_per_gas = max_priority_fee_per_gas or tip
            max_fee_per_gas = max_fee_per_gas or base_fee + max_priority_fee_per_gas

        tx: Dict[str, Any] = {
            "from": from_address,
            "value": int(value_wei),
            "nonce": int(nonce),
            "chainId": self.web3.eth.chain_id,
            "maxFeePerGas": int(max_fee_per_gas),
            "maxPriorityFeePerGas": int(max_priority_fee_per_gas),
        }

        if gas is None:
            estimated_gas = fn.estimate_gas({"from": from_address, "value": int(value_wei)})
            gas = estimated_gas
        tx["gas"] = int(gas)  # gas is guaranteed to be int at this point

        built_tx = fn.build_transaction(tx)
        return built_tx

    # ------------------------------------------------------------------
    # Convenience wrappers
    # ------------------------------------------------------------------

    def build_open_trade_tx(
        self,
        params: TradeParams,
        order_type: int,
        slippage_p: int,
        execution_fee_wei: int,
        gas: Optional[int] = None,
        max_fee_per_gas: Optional[int] = None,
        max_priority_fee_per_gas: Optional[int] = None,
        nonce: Optional[int] = None,
    ) -> Dict[str, Any]:
        self._require_account()
        assert self.address is not None, "Address must be set when account is required"
        trade_struct = self.build_trade_struct(params)
        fn = self.open_trade_function(trade_struct, order_type, slippage_p)
        return self.build_transaction(
            fn=fn,
            from_address=self.address,
            value_wei=execution_fee_wei,
            gas=gas,
            max_fee_per_gas=max_fee_per_gas,
            max_priority_fee_per_gas=max_priority_fee_per_gas,
            nonce=nonce,
        )

    def build_close_trade_market_tx(
        self,
        pair_index: int,
        index: int,
        amount: int,
        execution_fee_wei: int,
        gas: Optional[int] = None,
        max_fee_per_gas: Optional[int] = None,
        max_priority_fee_per_gas: Optional[int] = None,
        nonce: Optional[int] = None,
    ) -> Dict[str, Any]:
        self._require_account()
        assert self.address is not None, "Address must be set when account is required"
        fn = self.close_trade_market_function(pair_index, index, amount)
        return self.build_transaction(
            fn=fn,
            from_address=self.address,
            value_wei=execution_fee_wei,
            gas=gas,
            max_fee_per_gas=max_fee_per_gas,
            max_priority_fee_per_gas=max_priority_fee_per_gas,
            nonce=nonce,
        )

    def build_update_tp_sl_tx(
        self,
        pair_index: int,
        index: int,
        new_sl: int,
        new_tp: int,
        price_update_data: Optional[List[bytes]] = None,
        gas: Optional[int] = None,
        max_fee_per_gas: Optional[int] = None,
        max_priority_fee_per_gas: Optional[int] = None,
        nonce: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Build transaction for updateTpAndSl.
        MUST set value to 1 wei for price update.
        """
        self._require_account()
        assert self.address is not None, "Address must be set when account is required"
        if price_update_data is None:
            price_update_data = []
        fn = self.update_tp_sl_function(pair_index, index, new_sl, new_tp, price_update_data)
        return self.build_transaction(
            fn=fn,
            from_address=self.address,
            value_wei=1,  # 🔴 MUST send 1 wei for price update
            gas=gas or 500_000,
            max_fee_per_gas=max_fee_per_gas,
            max_priority_fee_per_gas=max_priority_fee_per_gas,
            nonce=nonce,
        )

    def build_update_margin_tx(
        self,
        pair_index: int,
        index: int,
        update_type: int,
        amount_usdc_raw: int,
        price_update_data: Optional[List[bytes]] = None,
        gas: Optional[int] = None,
        max_fee_per_gas: Optional[int] = None,
        max_priority_fee_per_gas: Optional[int] = None,
        nonce: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Build transaction for updateMargin.
        update_type: 0 = DEPOSIT, 1 = WITHDRAW
        amount_usdc_raw: USDC with 6 decimals
        MUST set value to 1 wei for price update.
        """
        self._require_account()
        assert self.address is not None, "Address must be set when account is required"
        if price_update_data is None:
            price_update_data = []
        fn = self.update_margin_function(pair_index, index, update_type, amount_usdc_raw, price_update_data)
        return self.build_transaction(
            fn=fn,
            from_address=self.address,
            value_wei=1,  # 🔴 MUST send 1 wei for price update
            gas=gas or 500_000,
            max_fee_per_gas=max_fee_per_gas,
            max_priority_fee_per_gas=max_priority_fee_per_gas,
            nonce=nonce,
        )

    def build_cancel_open_limit_order_tx(
        self,
        pair_index: int,
        index: int,
        gas: Optional[int] = None,
        max_fee_per_gas: Optional[int] = None,
        max_priority_fee_per_gas: Optional[int] = None,
        nonce: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Build transaction for cancelOpenLimitOrder.
        No value required (value = 0).
        """
        self._require_account()
        assert self.address is not None, "Address must be set when account is required"
        fn = self.cancel_open_limit_order_function(pair_index, index)
        return self.build_transaction(
            fn=fn,
            from_address=self.address,
            value_wei=0,  # No value required
            gas=gas or 300_000,
            max_fee_per_gas=max_fee_per_gas,
            max_priority_fee_per_gas=max_priority_fee_per_gas,
            nonce=nonce,
        )

    # ------------------------------------------------------------------
    # Sign + send
    # ------------------------------------------------------------------

    def sign_and_send(self, tx: Dict[str, Any]) -> str:
        self._require_account()
        assert self.account is not None, "Account must be set when account is required"
        signed = self.account.sign_transaction(tx)
        # Handle both camelCase and snake_case attribute names (eth-account version compatibility)
        raw_tx_bytes = getattr(signed, 'rawTransaction', None) or getattr(signed, 'raw_transaction', None)
        if raw_tx_bytes is None:
            # Fallback: try to get bytes directly
            raw_tx_bytes = bytes(signed) if hasattr(signed, '__bytes__') else None
        if raw_tx_bytes is None:
            raise ValueError(f"Could not extract raw transaction from signed transaction. Available attributes: {dir(signed)}")
        tx_hash = self.web3.eth.send_raw_transaction(raw_tx_bytes)
        return tx_hash.hex()
