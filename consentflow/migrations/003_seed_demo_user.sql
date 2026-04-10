-- ============================================================
-- ConsentFlow — Migration 003: Seed demo user
-- ============================================================
-- Inserts the canonical demo user so that the well-known test UUID
-- (550e8400-e29b-41d4-a716-446655440000) is always present in the
-- users table.  This prevents FK violations when running manual
-- tests or hitting the API docs (/docs) straight after startup.
--
-- ON CONFLICT DO NOTHING makes this idempotent — safe to re-apply.
INSERT INTO users (id, email)
VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'demo@consentflow.dev'
)
ON CONFLICT (id) DO NOTHING;
