# Scaling Plan: Supporting Thousands of Users and Positions

## Executive Summary

This document outlines a comprehensive scaling strategy to support thousands of concurrent users and positions. The plan addresses infrastructure, architecture, database, caching, real-time updates, and monitoring.

**Current Architecture:**
- Next.js frontend (React)
- Python FastAPI service (Avantis trading operations)
- Node.js/Express trading engine
- Supabase/PostgreSQL (wallet storage)
- In-memory caching and rate limiting
- WebSocket server for real-time updates
- Direct blockchain RPC calls for position data

**Target Scale:**
- 1,000-10,000+ concurrent users
- 10,000-100,000+ active positions
- Sub-second position updates
- 99.9% uptime

---

## 1. Infrastructure & Deployment

### 1.1 Horizontal Scaling

**Current State:** Single-instance deployment
**Target State:** Multi-instance, load-balanced architecture

#### Implementation:
- **Frontend (Next.js)**
  - Deploy on Vercel/Cloudflare Pages with edge functions
  - Enable ISR (Incremental Static Regeneration) for static pages
  - Use edge middleware for authentication checks

- **Backend Services**
  - Containerize services (Docker)
  - Deploy on Kubernetes (EKS/GKE) or managed container service
  - Use horizontal pod autoscaling (HPA) based on CPU/memory/request rate
  - Minimum 3 instances per service for high availability

- **Load Balancing**
  - Use AWS ALB/NLB or Cloudflare Load Balancer
  - Implement health checks for all services
  - Session affinity for WebSocket connections (sticky sessions)

#### Resource Requirements:
```
Frontend: 2-4 instances (auto-scale 2-10 based on traffic)
Avantis Service: 3-5 instances (auto-scale 3-15 based on load)
Trading Engine: 3-5 instances (auto-scale 3-15 based on load)
```

---

## 2. Database Optimization

### 2.1 Position Data Caching Database

**Problem:** Positions are fetched from blockchain on every request (slow, rate-limited)

**Solution:** Create a position cache database

#### Schema Design:
```sql
-- Position cache table
CREATE TABLE position_cache (
    id BIGSERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    pair_index INTEGER NOT NULL,
    trade_index INTEGER NOT NULL,
    position_data JSONB NOT NULL,
    last_updated TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(wallet_address, pair_index, trade_index)
);

CREATE INDEX idx_position_cache_wallet ON position_cache(wallet_address);
CREATE INDEX idx_position_cache_expires ON position_cache(expires_at);
CREATE INDEX idx_position_cache_updated ON position_cache(last_updated);

-- Position update queue (for background workers)
CREATE TABLE position_update_queue (
    id BIGSERIAL PRIMARY KEY,
    wallet_address VARCHAR(42) NOT NULL,
    priority INTEGER DEFAULT 5, -- 1-10, 1 = highest
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    attempts INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_position_queue_status ON position_update_queue(status, priority, next_retry_at);
CREATE INDEX idx_position_queue_wallet ON position_update_queue(wallet_address);
```

#### Implementation:
1. **Background Position Sync Workers**
   - Separate worker processes that poll blockchain for position updates
   - Update cache database every 5-10 seconds for active users
   - Use priority queue: active users (recent API calls) get updated more frequently
   - Batch updates for multiple positions per wallet

2. **API Layer**
   - Read from cache database first (sub-millisecond queries)
   - Fallback to blockchain only if cache miss or stale
   - Return cached data with `stale` flag if > 10 seconds old

### 2.2 Database Scaling

**PostgreSQL Optimization:**
- Use connection pooling (PgBouncer or Supabase connection pooler)
- Read replicas for read-heavy queries (position reads)
- Partition `position_cache` table by wallet_address hash
- Enable query result caching at database level

**Alternative: Add Redis Layer**
- Cache frequently accessed positions in Redis (TTL: 5-10 seconds)
- Use Redis for rate limiting (distributed)
- Use Redis for WebSocket pub/sub (multi-instance support)

---

## 3. Caching Strategy

### 3.1 Distributed Caching

**Current State:** In-memory cache (doesn't scale across instances)

**Solution:** Redis Cluster

#### Implementation:
- **Redis Cluster Setup**
  - 3-6 Redis nodes (1 primary + replicas per shard)
  - Use Redis Cluster mode for automatic sharding
  - Enable persistence (AOF + RDB snapshots)

- **Cache Layers:**
  1. **L1: Redis (5-10s TTL)** - Hot data, frequently accessed positions
  2. **L2: PostgreSQL Cache Table (30-60s TTL)** - Warm data
  3. **L3: Blockchain RPC** - Cold data, fallback only

#### Cache Keys:
```
positions:{wallet_address} -> List of positions (JSON)
position:{wallet_address}:{pair_index}:{trade_index} -> Single position
prices:{symbol} -> Current price
rate_limit:{user_id}:{endpoint} -> Rate limit counter
```

### 3.2 CDN & Edge Caching

- Use Cloudflare/Vercel Edge for static assets
- Cache API responses at edge (for public/read-only endpoints)
- Cache price data at edge (1-2 second TTL)

---

## 4. Real-Time Updates

### 4.1 WebSocket Scaling

**Current State:** Single-instance WebSocket server

**Solution:** Distributed WebSocket with Redis Pub/Sub

#### Architecture:
```
Client -> Load Balancer -> WebSocket Instance (sticky session)
                              |
                              v
                    Redis Pub/Sub Channel
                              |
                              v
                    All WebSocket Instances
```

#### Implementation:
1. **WebSocket Server Updates**
   - Each instance subscribes to Redis channels
   - When position/price updates occur, publish to Redis
   - All instances receive update and broadcast to connected clients

2. **Connection Management**
   - Store WebSocket connection mappings in Redis
   - Use Redis Sets: `ws:connections:{user_id}` -> Set of connection IDs
   - On disconnect, remove from Redis set

3. **Scaling Considerations**
   - Limit connections per instance (e.g., 10,000 per instance)
   - Auto-scale WebSocket servers based on connection count
   - Use WebSocket compression (perMessageDeflate)

### 4.2 Price Updates

**Current State:** Polling every 5 seconds per client

**Solution:** Server-Sent Events (SSE) or WebSocket price feed

#### Implementation:
- **Centralized Price Service**
  - Single service subscribes to exchange WebSocket feeds
  - Updates Redis with latest prices (key: `price:{symbol}`)
  - All API instances read from Redis

- **Client Updates**
  - Single WebSocket connection per client for all updates
  - Subscribe to symbols user is interested in
  - Server pushes updates when prices change (not polling)

---

## 5. Rate Limiting & Throttling

### 5.1 Distributed Rate Limiting

**Current State:** In-memory rate limiting (doesn't work with load balancing)

**Solution:** Redis-based rate limiting

#### Implementation:
```python
# Redis-based rate limiter
import redis
from datetime import timedelta

class DistributedRateLimiter:
    def __init__(self, redis_client):
        self.redis = redis_client
    
    def check_rate_limit(self, user_id: str, endpoint: str, 
                        limit: int, window: int) -> bool:
        key = f"rate_limit:{endpoint}:{user_id}"
        current = self.redis.incr(key)
        
        if current == 1:
            self.redis.expire(key, window)
        
        return current <= limit
```

#### Rate Limits:
- **Positions API:** 60 requests/minute per user (burst: 10)
- **Trade API:** 30 requests/minute per user (burst: 5)
- **Price API:** 120 requests/minute per user (burst: 20)

### 5.2 Request Queuing

For high-traffic scenarios:
- Use Redis Queue (RQ) or Celery for async processing
- Queue non-critical operations (analytics, logging)
- Prioritize real-time position updates

---

## 6. Blockchain RPC Optimization

### 6.1 RPC Provider Scaling

**Current State:** Single RPC endpoint (rate-limited, slow)

**Solution:** Multiple RPC providers with failover

#### Implementation:
- **RPC Provider Pool**
  - Use multiple providers (Alchemy, Infura, QuickNode, public RPCs)
  - Implement round-robin with health checks
  - Automatic failover on timeout/error
  - Rate limit per provider (distribute load)

- **RPC Caching**
  - Cache blockchain reads aggressively (positions, balances)
  - Use block number-based cache invalidation
  - Cache for 1-2 blocks (~2-4 seconds on Base)

### 6.2 Batch Operations

- Batch multiple position queries into single RPC call
- Use `eth_call` batch requests
- Implement request coalescing (group similar requests)

---

## 7. Monitoring & Observability

### 7.1 Metrics Collection

**Required Metrics:**
- Request rate (per endpoint, per user)
- Response times (p50, p95, p99)
- Error rates (4xx, 5xx)
- Cache hit rates
- Database query times
- WebSocket connection count
- Position update latency
- RPC call success rate

**Tools:**
- Prometheus + Grafana
- Datadog / New Relic
- Custom dashboards

### 7.2 Logging

- Structured logging (JSON format)
- Centralized log aggregation (ELK stack, Datadog, CloudWatch)
- Log levels: ERROR, WARN, INFO, DEBUG
- Include request IDs for tracing

### 7.3 Alerting

**Critical Alerts:**
- Error rate > 1%
- Response time p95 > 2 seconds
- Database connection pool exhaustion
- Redis unavailable
- RPC provider failures
- WebSocket disconnection spike

---

## 8. Security & Performance

### 8.1 Authentication Optimization

- Cache JWT validation results (Redis, 5-minute TTL)
- Use JWKS endpoint caching
- Implement refresh token rotation

### 8.2 Database Connection Pooling

- Use PgBouncer or Supabase connection pooler
- Pool size: 20-50 connections per instance
- Enable prepared statements

### 8.3 API Response Optimization

- Enable gzip compression
- Use JSON streaming for large responses
- Implement pagination for position lists
- Add `ETag` headers for caching

---

## 9. Implementation Phases

### Phase 1: Foundation (Weeks 1-2)
- [ ] Set up Redis cluster
- [ ] Migrate rate limiting to Redis
- [ ] Implement distributed caching
- [ ] Add database connection pooling
- [ ] Set up monitoring (Prometheus/Grafana)

### Phase 2: Position Caching (Weeks 3-4)
- [ ] Create position_cache database table
- [ ] Implement background position sync workers
- [ ] Update API to read from cache first
- [ ] Add cache warming for active users

### Phase 3: Real-Time Scaling (Weeks 5-6)
- [ ] Implement Redis Pub/Sub for WebSockets
- [ ] Set up centralized price service
- [ ] Migrate clients to single WebSocket connection
- [ ] Add WebSocket load balancing

### Phase 4: RPC Optimization (Weeks 7-8)
- [ ] Implement RPC provider pool
- [ ] Add RPC request batching
- [ ] Implement RPC caching layer
- [ ] Add automatic failover

### Phase 5: Infrastructure Scaling (Weeks 9-10)
- [ ] Containerize all services
- [ ] Set up Kubernetes cluster
- [ ] Implement auto-scaling
- [ ] Add load balancers
- [ ] Set up CDN/edge caching

### Phase 6: Optimization & Testing (Weeks 11-12)
- [ ] Load testing (simulate 10,000 users)
- [ ] Performance optimization
- [ ] Database query optimization
- [ ] Cache tuning
- [ ] Documentation

---

## 10. Cost Estimates

### Infrastructure Costs (Monthly)

**Small Scale (1,000 users):**
- Redis Cluster (3 nodes): $150-300
- Database (Supabase Pro): $25-100
- Compute (Kubernetes): $200-400
- Load Balancer: $50-100
- CDN: $50-100
- **Total: ~$500-1,000/month**

**Medium Scale (5,000 users):**
- Redis Cluster (6 nodes): $300-600
- Database (Supabase Team): $100-300
- Compute (Kubernetes): $500-1,000
- Load Balancer: $100-200
- CDN: $100-200
- **Total: ~$1,100-2,300/month**

**Large Scale (10,000+ users):**
- Redis Cluster (9 nodes): $600-1,200
- Database (Supabase Enterprise): $300-1,000
- Compute (Kubernetes): $1,000-2,000
- Load Balancer: $200-400
- CDN: $200-400
- **Total: ~$2,300-5,000/month**

---

## 11. Performance Targets

### Latency Targets:
- Position API: < 100ms (p95)
- Price updates: < 50ms (p95)
- Trade execution: < 500ms (p95)
- WebSocket message delivery: < 50ms

### Throughput Targets:
- Position API: 10,000 requests/second
- Price updates: 50,000 updates/second
- WebSocket connections: 50,000 concurrent
- Database queries: 100,000 queries/second

### Availability Targets:
- Uptime: 99.9% (8.76 hours downtime/year)
- RTO (Recovery Time Objective): < 5 minutes
- RPO (Recovery Point Objective): < 1 minute

---

## 12. Risk Mitigation

### Single Points of Failure:
1. **Database:** Use read replicas, automated backups, failover
2. **Redis:** Use Redis Cluster with replication
3. **RPC Providers:** Multiple providers with failover
4. **Load Balancer:** Use managed service with health checks

### Data Consistency:
- Eventual consistency for position cache (acceptable 5-10s delay)
- Strong consistency for trades (write-through cache)
- Use database transactions for critical operations

### Scaling Bottlenecks:
- Monitor database connection pool usage
- Monitor Redis memory usage
- Monitor RPC rate limits
- Implement circuit breakers for external services

---

## 13. Testing Strategy

### Load Testing:
- Use k6, Locust, or Artillery
- Test scenarios:
  - 1,000 concurrent users fetching positions
  - 5,000 concurrent WebSocket connections
  - 10,000 positions being updated simultaneously
  - RPC provider failure scenarios

### Stress Testing:
- Gradually increase load until failure point
- Identify bottlenecks
- Test failover scenarios

### Chaos Engineering:
- Randomly kill instances
- Simulate database failures
- Simulate Redis failures
- Verify system resilience

---

## 14. Success Metrics

### Key Performance Indicators (KPIs):
1. **User Experience:**
   - Average page load time < 2 seconds
   - Position update latency < 1 second
   - Error rate < 0.1%

2. **System Performance:**
   - API response time p95 < 200ms
   - Cache hit rate > 80%
   - Database query time p95 < 50ms

3. **Scalability:**
   - Support 10,000+ concurrent users
   - Handle 100,000+ positions
   - Auto-scale within 2 minutes of load increase

---

## 15. Future Considerations

### Long-Term Scaling (100,000+ users):
- Microservices architecture (split trading, positions, prices)
- Event-driven architecture (Kafka/RabbitMQ)
- GraphQL API for flexible queries
- Multi-region deployment
- Database sharding by user ID
- CQRS pattern for read/write separation

### Advanced Features:
- Real-time analytics pipeline
- Machine learning for position prediction
- Advanced caching strategies (predictive prefetching)
- Edge computing for low-latency regions

---

## Conclusion

This scaling plan provides a comprehensive roadmap to support thousands of users and positions. The phased approach allows for incremental improvements while maintaining system stability. Key focus areas:

1. **Distributed caching** (Redis) for scalability
2. **Position caching database** to reduce blockchain calls
3. **Distributed WebSocket** for real-time updates
4. **Horizontal scaling** with load balancing
5. **Monitoring** for proactive issue detection

Implementation should be done incrementally, with thorough testing at each phase. Regular performance reviews and optimization will ensure the system continues to scale effectively.
