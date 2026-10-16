-- philkrpp fork: reconcile production DB with the umbrella migration chain.
--
-- 1) Re-apply umbrella 0015/0016/0017 (mcp_sessions + gateway_boot_id +
--    capability_hash). Production previously ran our fork's own 0014-0019,
--    whose journal `when` (last: 1782670882423) is later than umbrella's
--    0015-0017 `when` values. Drizzle only applies entries newer than the last
--    applied migration, so prod skipped those three. Statements are verbatim
--    from umbrella and idempotent, so this is a no-op on fresh databases.
-- 2) Fork-only features that umbrella does not carry: per-server header
--    forwarding (mcp_servers.forward_headers), MetaMCP admin tools endpoint
--    toggle (endpoints.enable_metamcp_admin_tools), upstream OAuth CSRF state
--    (oauth_sessions.expected_state) and the legacy multi-endpoint API-key
--    access table (api_key_endpoint_access, TEMP(api-key-legacy-scope)).
--    Existing prod DBs already have these from our old 0015-0019; fresh DBs
--    get them here.
--
-- Everything is guarded (IF NOT EXISTS / pg_constraint check) so it is safe
-- on both prod and fresh databases.
CREATE TABLE IF NOT EXISTS "mcp_sessions" (
	"session_id" text PRIMARY KEY NOT NULL,
	"namespace_uuid" uuid NOT NULL,
	"endpoint_name" text NOT NULL,
	"auth_principal" text NOT NULL,
	"auth_method" text NOT NULL,
	"init_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_sessions_last_seen_at_idx" ON "mcp_sessions" USING btree ("last_seen_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_sessions_namespace_uuid_idx" ON "mcp_sessions" USING btree ("namespace_uuid");
--> statement-breakpoint
ALTER TABLE "mcp_sessions" ADD COLUMN IF NOT EXISTS "gateway_boot_id" uuid;
--> statement-breakpoint
ALTER TABLE "mcp_sessions" ADD COLUMN IF NOT EXISTS "capability_hash" text;
--> statement-breakpoint
ALTER TABLE "mcp_servers" ADD COLUMN IF NOT EXISTS "forward_headers" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "endpoints" ADD COLUMN IF NOT EXISTS "enable_metamcp_admin_tools" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD COLUMN IF NOT EXISTS "expected_state" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_key_endpoint_access" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_uuid" uuid NOT NULL,
	"endpoint_uuid" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_endpoint_access_unique" UNIQUE("api_key_uuid","endpoint_uuid")
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_key_endpoint_access_api_key_uuid_api_keys_uuid_fk') THEN
		ALTER TABLE "api_key_endpoint_access" ADD CONSTRAINT "api_key_endpoint_access_api_key_uuid_api_keys_uuid_fk" FOREIGN KEY ("api_key_uuid") REFERENCES "public"."api_keys"("uuid") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_key_endpoint_access_endpoint_uuid_endpoints_uuid_fk') THEN
		ALTER TABLE "api_key_endpoint_access" ADD CONSTRAINT "api_key_endpoint_access_endpoint_uuid_endpoints_uuid_fk" FOREIGN KEY ("endpoint_uuid") REFERENCES "public"."endpoints"("uuid") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_endpoint_access_api_key_uuid_idx" ON "api_key_endpoint_access" USING btree ("api_key_uuid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_key_endpoint_access_endpoint_uuid_idx" ON "api_key_endpoint_access" USING btree ("endpoint_uuid");
