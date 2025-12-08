-- ============================================================================
-- Remove wallet_audit_log and web_wallet_audit_log tables
-- Migration script to drop audit log tables and related objects
-- ============================================================================

-- Drop functions first (they have dependencies on tables)
DROP FUNCTION IF EXISTS log_wallet_access(INTEGER, VARCHAR(50), VARCHAR(100), INET);
DROP FUNCTION IF EXISTS log_web_wallet_access(INTEGER, VARCHAR(50), VARCHAR(100), INET);

-- Drop RLS policies (if they exist)
DROP POLICY IF EXISTS "Service role has full access to wallet_audit_log" ON wallet_audit_log;
DROP POLICY IF EXISTS "Service role has full access to web_wallet_audit_log" ON web_wallet_audit_log;

-- Drop indexes
DROP INDEX IF EXISTS idx_audit_log_wallet_id;
DROP INDEX IF EXISTS idx_audit_log_timestamp;
DROP INDEX IF EXISTS idx_web_audit_log_wallet_id;
DROP INDEX IF EXISTS idx_web_audit_log_timestamp;

-- Drop tables (CASCADE will drop any remaining dependencies)
DROP TABLE IF EXISTS wallet_audit_log CASCADE;
DROP TABLE IF EXISTS web_wallet_audit_log CASCADE;

-- ============================================================================
-- Verification queries (run these after migration to verify)
-- ============================================================================

-- Check if tables are dropped (should return 0 rows)
-- SELECT COUNT(*) FROM information_schema.tables 
-- WHERE table_name IN ('wallet_audit_log', 'web_wallet_audit_log');

-- Check if functions are dropped (should return 0 rows)
-- SELECT COUNT(*) FROM information_schema.routines 
-- WHERE routine_name IN ('log_wallet_access', 'log_web_wallet_access');










