/**
 * Authentication Helper Utilities
 * 
 * Helps verify Farcaster tokens and extract user info
 */

import { AuthService } from '@/lib/services/AuthService';

// Lazy-load service to avoid requiring JWT_SECRET at build time
let authService: AuthService | null = null;

function getAuthService(): AuthService {
  if (!authService) {
    authService = new AuthService();
  }
  return authService;
}

export interface AuthContextResult {
  context: 'farcaster';
  fid: number;
  userId: string;
}

/**
 * Verify Farcaster token and extract user context
 */
export async function verifyTokenAndGetContext(token: string): Promise<AuthContextResult> {
  const authServiceInstance = getAuthService();

  try {
    const payload = await authServiceInstance.verifyToken(token);
    if (!payload.fid) {
      throw new Error('Invalid token: FID not found');
    }
    
    console.log('[authHelper] ✅ Verified Farcaster token, FID:', payload.fid);
    return {
      context: 'farcaster',
      fid: payload.fid,
      userId: payload.userId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[authHelper] ❌ Token verification failed:', errorMessage);
    
    if (errorMessage.includes('expired') || errorMessage.includes('Token expired')) {
      throw new Error('Token expired. Please refresh your session.');
    }
    
    if (errorMessage.includes('Invalid token') || errorMessage.includes('invalid') || errorMessage.includes('jwt')) {
      throw new Error('Invalid token. Please log in again.');
    }
    
    throw new Error('Token verification failed. Please log in again.');
  }
}
