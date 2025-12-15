/**
 * Authentication Context Detection Utility
 * 
 * For Farcaster (Base context) authentication only.
 */

export type AuthContext = 'farcaster';

export interface AuthContextInfo {
  context: AuthContext;
  userId: string | number;
  fid: number;
}

/**
 * Detect authentication context from request headers or environment
 * Returns 'farcaster' as this app only supports Farcaster authentication
 */
export function detectAuthContext(): AuthContext {
  return 'farcaster';
}

/**
 * Extract user identifier from request
 */
export function extractUserIdentifier(): { fid?: number; userId?: string } {
  // Farcaster authentication - FID would be extracted from JWT token
  return {};
}
