-- Add messages to the Supabase Realtime publication so clients can
-- receive INSERT (new message) and UPDATE (read receipt) events.
-- REPLICA IDENTITY FULL makes UPDATE payloads include the old row too,
-- which lets clients diff read-state cleanly.
--
-- Applied live via Supabase MCP on 2026-04-21. File kept in the repo so
-- future re-bootstraps stay in sync.
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
