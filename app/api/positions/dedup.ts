/**
 * Request deduplication for positions API.
 * Prevents multiple simultaneous requests for the same user.
 * FIXED: Caches data instead of response to avoid ReadableStream locked errors.
 */
import { NextResponse } from 'next/server';

interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
}

interface CachedData {
  data: any;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();
const cachedData = new Map<string, CachedData>();
const CACHE_TTL = 20000; // 20 seconds (matches backend cache)
const REQUEST_TIMEOUT = 30000; // 30 seconds

export async function deduplicateRequest<T>(
  key: string,
  fetchFn: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  
  // Clean up old pending requests and cached data
  for (const [k, req] of pendingRequests.entries()) {
    if (now - req.timestamp > REQUEST_TIMEOUT) {
      pendingRequests.delete(k);
    }
  }
  for (const [k, cached] of cachedData.entries()) {
    if (now - cached.timestamp > CACHE_TTL) {
      cachedData.delete(k);
    }
  }
  
  // Check if we have cached data (not expired) - use this first to avoid ReadableStream issues
  const cached = cachedData.get(key);
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    console.log(`[DEDUP] Using cached data for key: ${key.substring(0, 20)}...`);
    // Create a new NextResponse from cached data to avoid ReadableStream locked error
    return NextResponse.json(cached.data) as T;
  }
  
  // Check if there's already a pending request for this key
  const existing = pendingRequests.get(key);
  if (existing && (now - existing.timestamp) < REQUEST_TIMEOUT) {
    console.log(`[DEDUP] Reusing existing request for key: ${key.substring(0, 20)}...`);
    // Wait for the existing request - it now resolves to data, not response
    try {
      const data = await existing.promise;
      
      // The promise now resolves to data directly, so we can safely create a new response
      // Cache it if not already cached (should be cached, but just in case)
      if (!cachedData.has(key)) {
        cachedData.set(key, { data, timestamp: Date.now() });
      }
      
      // Create a new NextResponse from the data for this consumer
      return NextResponse.json(data) as T;
    } catch (error) {
      // If existing request failed, remove it and create new one
      console.error(`[DEDUP] Error reusing existing request: ${error}`);
      pendingRequests.delete(key);
      // Fall through to create new request
    }
  }
  
  // Create new request
  // CRITICAL: Resolve promise to data, not response, to avoid ReadableStream locked errors
  // Each consumer will create their own NextResponse from the cached data
  const promise = fetchFn()
    .then(async (result) => {
      // Extract JSON data from NextResponse if it's a response object
      let data;
      if (result && typeof result === 'object' && 'json' in result) {
        data = await (result as any).json();
      } else {
        data = result;
      }
      
      // Cache the data (not the response object) to avoid ReadableStream locked errors
      cachedData.set(key, { data, timestamp: Date.now() });
      
      // Remove from pending after completion
      setTimeout(() => {
        pendingRequests.delete(key);
      }, 2000); // Keep for 2 seconds after completion for deduplication
      
      // Return the data, not the response, so multiple consumers can use it
      return data;
    })
    .catch(error => {
      // Remove from pending on error
      pendingRequests.delete(key);
      throw error;
    });
  
  pendingRequests.set(key, {
    promise,
    timestamp: now
  });
  
  // When returning, create a NextResponse from the data
  // This ensures each consumer gets their own response object
  return promise.then((data) => {
    return NextResponse.json(data) as T;
  });
}

export function createRequestKey(privateKey: string, address?: string): string {
  // Create a unique key for this user
  if (privateKey) {
    return `pk_${privateKey}`;
  }
  if (address) {
    return `addr_${address.toLowerCase()}`;
  }
  return 'unknown';
}
