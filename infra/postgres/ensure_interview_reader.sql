-- Provision the isolated interview stack's reader before Rails applies table grants.
-- This also supports retained fixture volumes without deleting any database or ledger.
DO $role$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_reader') THEN
    CREATE ROLE ai_reader LOGIN PASSWORD 'ai_reader';
  END IF;
END
$role$;
