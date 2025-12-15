/**
 * Supabase Client Singleton
 * 
 * This creates a single instance of the Supabase client for the entire application.
 * It's configured with the service role key for backend operations.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Database types for type-safe queries
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: number;
          fid: number;
          created_at: string;
          updated_at: string;
          last_login_at: string | null;
        };
        Insert: {
          id?: number;
          fid: number;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string | null;
        };
        Update: {
          id?: number;
          fid?: number;
          created_at?: string;
          updated_at?: string;
          last_login_at?: string | null;
        };
      };
      wallets: {
        Row: {
          id: number;
          fid: number;
          address: string;
          encrypted_private_key: string | null;
          iv: string | null;
          chain: string;
          wallet_type: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          fid: number;
          address: string;
          encrypted_private_key?: string | null;
          iv?: string | null;
          chain: string;
          wallet_type: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          fid?: number;
          address?: string;
          encrypted_private_key?: string | null;
          iv?: string | null;
          chain?: string;
          wallet_type?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}

// Global singleton instance
let supabaseInstance: SupabaseClient<Database> | null = null;

/**
 * Get Supabase client instance (server-side only)
 * Uses service role key for full database access
 */
export function getSupabaseClient(): SupabaseClient<Database> {
  if (supabaseInstance) {
    return supabaseInstance;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      'Missing Supabase environment variables. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
  }

  // Create client with service role key for backend operations
  supabaseInstance = createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return supabaseInstance;
}

/**
 * Get Supabase client instance for client-side use
 * Uses anon key with Row Level Security
 */
export function getSupabaseClientPublic(): SupabaseClient<Database> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing public Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'
    );
  }

  return createClient<Database>(supabaseUrl, supabaseAnonKey);
}

// Export types
export type SupabaseClientType = SupabaseClient<Database>;
export type WalletRow = Database['public']['Tables']['wallets']['Row'];
export type WalletInsert = Database['public']['Tables']['wallets']['Insert'];
export type WalletUpdate = Database['public']['Tables']['wallets']['Update'];
