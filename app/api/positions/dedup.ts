/**
 * Request deduplication for positions API.
 * Prevents multiple simultaneous requests for the same user.
 */
interface PendingRequest {
  promise: Promise<any>;
  timestamp: number;
}

const pendingRequests = new Map<string, PendingRequest>();
const CACHE_TTL = 20000; // 20 seconds (matches backend cache)
const REQUEST_TIMEOUT = 30000; // 30 seconds

export async function deduplicateRequest<T>(
  key: string,
  fetchFn: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  
  // Clean up old pending requests
  for (const [k, req] of pendingRequests.entries()) {
    if (now - req.timestamp > REQUEST_TIMEOUT) {
      pendingRequests.delete(k);
    }
  }
  
  // Check if there's already a pending request for this key
  const existing = pendingRequests.get(key);
  if (existing && (now - existing.timestamp) < REQUEST_TIMEOUT) {
    console.log(`[DEDUP] Reusing existing request for key: ${key.substring(0, 20)}...`);
    return existing.promise;
  }
  
  // Create new request
  const promise = fetchFn()
    .then(result => {
      // Remove from pending after completion
      setTimeout(() => {
        pendingRequests.delete(key);
      }, 1000); // Keep for 1 second after completion for deduplication
      return result;
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
  
  return promise;
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
