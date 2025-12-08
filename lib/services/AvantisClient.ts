/**
 * TypeScript client for Avantis Trading API
 * Communicates with the Python FastAPI service
 */

import axios, { AxiosInstance, AxiosError } from 'axios';

/**
 * Configuration for Avantis API client
 */
export interface AvantisConfig {
  baseUrl: string;
  timeout?: number;
  privateKey?: string;
  network?: string;
}

/**
 * Parameters for opening a position
 */
export interface OpenPositionParams {
  symbol: string;
  collateral: number;
  leverage: number;
  is_long: boolean;
  tp?: number;
  sl?: number;
  private_key?: string;
}

/**
 * Avantis position structure
 */
export interface Position {
  pair_index: number;
  symbol: string;
  collateral: number;
  leverage: number;
  is_long: boolean;
  entry_price: number;
  current_price: number;
  pnl: number;
  pnl_percentage?: number;
  liquidation_price?: number | null;
  take_profit?: number | null;
  stop_loss?: number | null;
  margin?: string;
  timestamp?: string;
}

/**
 * Balance information
 */
export interface Balance {
  usdc_balance: number;
  usdc_allowance: number;
  total_collateral: number;
}

/**
 * Trade response
 */
export interface TradeResponse {
  success: boolean;
  transaction_hash?: string;
  message?: string;
  error?: string;
}

/**
 * Custom error class for Avantis API errors
 */
export class AvantisApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public response?: any
  ) {
    super(message);
    this.name = 'AvantisApiError';
  }
}

/**
 * Avantis API Client
 * Provides methods to interact with the Avantis Python FastAPI service
 */
export class AvantisClient {
  private axiosInstance: AxiosInstance;
  private defaultPrivateKey?: string;
  private defaultNetwork?: string;

  constructor(config: AvantisConfig) {
    // Server-side: use AVANTIS_API_URL, client-side: use NEXT_PUBLIC_ or API route
    // Use NEXT_PUBLIC_AVANTIS_API_URL for both client and server (CI/CD compliant)
    // AVANTIS_API_URL is now in trading-engine/.env and not available to frontend
    const baseURL = config.baseUrl || 
      (typeof window !== 'undefined' 
        ? (process.env.NEXT_PUBLIC_AVANTIS_API_URL || '/api/avantis-proxy')
        : (process.env.NEXT_PUBLIC_AVANTIS_API_URL || process.env.AVANTIS_API_URL || 'http://localhost:8000'));
    const timeout = config.timeout || 30000;

    this.axiosInstance = axios.create({
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.defaultPrivateKey = config.privateKey;
    this.defaultNetwork = config.network;

    // Add request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (config) => {
        console.log(`[AvantisClient] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[AvantisClient] Request error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const statusCode = error.response?.status;
        const errorMessage = error.response?.data 
          ? (error.response.data as any).detail || error.message
          : error.message;

        console.error(`[AvantisClient] API error (${statusCode}):`, errorMessage);

        throw new AvantisApiError(
          errorMessage || 'Unknown Avantis API error',
          statusCode,
          error.response?.data
        );
      }
    );
  }

  /**
   * Get private key for request (from parameter or default)
   */
  private getPrivateKey(providedKey?: string): string | undefined {
    return providedKey || this.defaultPrivateKey;
  }

  /**
   * Open a trading position
   */
  async openPosition(params: OpenPositionParams): Promise<TradeResponse> {
    try {
      const response = await this.axiosInstance.post('/api/open-position', {
        symbol: params.symbol,
        collateral: params.collateral,
        leverage: params.leverage,
        is_long: params.is_long,
        tp: params.tp,
        sl: params.sl,
        private_key: params.private_key || this.getPrivateKey(),
      });

      return {
        success: true,
        transaction_hash: response.data.transaction_hash,
        message: response.data.message || 'Position opened successfully',
      };
    } catch (error) {
      if (error instanceof AvantisApiError) {
        throw error;
      }
      throw new AvantisApiError(
        `Failed to open position: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Close a specific position by pair index
   */
  async closePosition(pairIndex: number, privateKey?: string): Promise<TradeResponse> {
    try {
      const response = await this.axiosInstance.post('/api/close-position', {
        pair_index: pairIndex,
        private_key: privateKey || this.getPrivateKey(),
      });

      return {
        success: true,
        transaction_hash: response.data.transaction_hash,
        message: response.data.message || 'Position closed successfully',
      };
    } catch (error) {
      if (error instanceof AvantisApiError) {
        throw error;
      }
      throw new AvantisApiError(
        `Failed to close position: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Close all open positions
   */
  async closeAllPositions(privateKey?: string): Promise<TradeResponse> {
    try {
      const response = await this.axiosInstance.post('/api/close-all-positions', {
        private_key: privateKey || this.getPrivateKey(),
      });

      return {
        success: true,
        transaction_hash: response.data.transaction_hash,
        message: response.data.message || 'All positions closed successfully',
      };
    } catch (error) {
      if (error instanceof AvantisApiError) {
        throw error;
      }
      throw new AvantisApiError(
        `Failed to close all positions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get all open positions
   * Supports both private key (traditional wallets) and address (Base Accounts)
   */
  async getPositions(privateKey?: string, address?: string): Promise<Position[]> {
    try {
      const params: any = {};
      
      if (address) {
        // Query by address (for Base Accounts)
        params.address = address;
      } else if (privateKey || this.getPrivateKey()) {
        // Query by private key (for traditional wallets)
        params.private_key = privateKey || this.getPrivateKey();
      }

      const response = await this.axiosInstance.get('/api/positions', { params });

      return response.data.positions || [];
    } catch (error) {
      if (error instanceof AvantisApiError) {
        throw error;
      }
      throw new AvantisApiError(
        `Failed to get positions: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get account balance information
   * Supports both private key (traditional wallets) and address (Base Accounts)
   */
  async getBalance(privateKey?: string, address?: string): Promise<Balance> {
    try {
      const params: any = {};
      
      if (address) {
        // Query by address (for Base Accounts)
        params.address = address;
      } else if (privateKey || this.getPrivateKey()) {
        // Query by private key (for traditional wallets)
        params.private_key = privateKey || this.getPrivateKey();
      }

      const response = await this.axiosInstance.get('/api/balance', { params });

      return {
        usdc_balance: response.data.usdc_balance || 0,
        usdc_allowance: response.data.usdc_allowance || 0,
        total_collateral: response.data.total_collateral || 0,
      };
    } catch (error) {
      if (error instanceof AvantisApiError) {
        throw error;
      }
      throw new AvantisApiError(
        `Failed to get balance: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Approve USDC for trading
   */
  async approveUSDC(amount?: number, privateKey?: string): Promise<TradeResponse> {
    try {
      const response = await this.axiosInstance.post('/api/approve-usdc', {
        amount: amount || 0, // 0 means unlimited
        private_key: privateKey || this.getPrivateKey(),
      });

      return {
        success: true,
        transaction_hash: response.data.transaction_hash,
        message: response.data.message || 'USDC approved successfully',
      };
    } catch (error) {
      if (error instanceof AvantisApiError) {
        throw error;
      }
      throw new AvantisApiError(
        `Failed to approve USDC: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get current price for a symbol
   * Note: This endpoint may need to be implemented in the Python API
   */
  async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const response = await this.axiosInstance.get(`/api/price/${symbol}`);
      return response.data.price || 0;
    } catch (error) {
      // If endpoint doesn't exist, return 0 or throw based on requirements
      console.warn(`[AvantisClient] Price endpoint not available for ${symbol}`);
      return 0;
    }
  }

  /**
   * Get total unrealized PnL
   */
  async getTotalPnL(privateKey?: string): Promise<number> {
    try {
      const params = privateKey || this.getPrivateKey() 
        ? { private_key: privateKey || this.getPrivateKey() }
        : {};

      const response = await this.axiosInstance.get('/api/total-pnl', { params });

      return response.data.total_pnl || 0;
    } catch (error) {
      if (error instanceof AvantisApiError) {
        throw error;
      }
      throw new AvantisApiError(
        `Failed to get total PnL: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get USDC allowance
   */
  async getUSDCAllowance(privateKey?: string): Promise<number> {
    try {
      const params = privateKey || this.getPrivateKey() 
        ? { private_key: privateKey || this.getPrivateKey() }
        : {};

      const response = await this.axiosInstance.get('/api/usdc-allowance', { params });

      return response.data.allowance || 0;
    } catch (error) {
      if (error instanceof AvantisApiError) {
        throw error;
      }
      throw new AvantisApiError(
        `Failed to get USDC allowance: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get all supported symbols
   */
  async getSupportedSymbols(): Promise<string[]> {
    try {
      const response = await this.axiosInstance.get('/api/symbols');
      return response.data.symbols || [];
    } catch (error) {
      if (error instanceof AvantisApiError) {
        throw error;
      }
      throw new AvantisApiError(
        `Failed to get symbols: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; service: string; network?: string }> {
    try {
      const response = await this.axiosInstance.get('/health');
      return response.data;
    } catch (error) {
      throw new AvantisApiError(
        `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        error
      );
    }
  }
}

/**
 * Factory function to create AvantisClient instance
 */
export function createAvantisClient(config?: Partial<AvantisConfig>): AvantisClient {
  // Use NEXT_PUBLIC_AVANTIS_API_URL for CI/CD compliance
  // AVANTIS_API_URL is now in trading-engine/.env
  const baseUrl = config?.baseUrl || 
    process.env.NEXT_PUBLIC_AVANTIS_API_URL || 
    process.env.AVANTIS_API_URL || 
    'http://localhost:8000';
  
  return new AvantisClient({
    baseUrl,
    timeout: config?.timeout || 30000,
    privateKey: config?.privateKey || process.env.AVANTIS_PK,
    network: config?.network || process.env.NEXT_PUBLIC_AVANTIS_NETWORK || process.env.AVANTIS_NETWORK,
  });
}

