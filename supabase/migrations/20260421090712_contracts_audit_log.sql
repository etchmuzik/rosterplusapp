-- Contract signing audit log.
-- Backfilled into the repo on 2026-04-24.
--
-- Records when the contract was signed, by whom, from where.
-- Not sufficient as standalone legal evidence but far better than the
-- previous blank-timestamp shape.

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS promoter_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS artist_signed_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promoter_signed_ua TEXT,
  ADD COLUMN IF NOT EXISTS artist_signed_ua   TEXT,
  ADD COLUMN IF NOT EXISTS audit_log          JSONB DEFAULT '[]'::jsonb;

-- audit_log entries look like:
-- { "event": "signed_by_promoter", "at": "2026-04-21T...", "ua": "..." }
-- Each signing appends a new entry; we never delete history.

COMMENT ON COLUMN public.contracts.audit_log IS
  'Append-only history of signing events. Each entry: {event, at, ua}.';
