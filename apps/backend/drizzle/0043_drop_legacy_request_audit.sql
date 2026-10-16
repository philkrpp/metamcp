-- Drop the fork's pre-umbrella request audit log. Umbrella's tool_call_audit /
-- audit_log replace it, and no code reads or writes it since the umbrella merge.
-- DEPLOY: take a table-only dump of mcp_request_audit_logs from production
-- right before deploying this; the rows are not recoverable afterwards.
DROP TABLE IF EXISTS "mcp_request_audit_logs";--> statement-breakpoint
DROP TYPE IF EXISTS "mcp_request_audit_status";--> statement-breakpoint
-- TEMP(api-key-legacy-scope): keep the confinement flag (a fresh install never
-- had it) until the shim and api_key_endpoint_access are dropped.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "restrict_endpoints" boolean DEFAULT false NOT NULL;
