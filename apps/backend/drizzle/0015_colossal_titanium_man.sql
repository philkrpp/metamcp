ALTER TABLE "mcp_request_audit_logs" ADD COLUMN "mcp_server_uuid" uuid;--> statement-breakpoint
ALTER TABLE "mcp_request_audit_logs" ADD COLUMN "mcp_server_name" text;--> statement-breakpoint
ALTER TABLE "mcp_request_audit_logs" ADD CONSTRAINT "mcp_request_audit_logs_mcp_server_uuid_mcp_servers_uuid_fk" FOREIGN KEY ("mcp_server_uuid") REFERENCES "public"."mcp_servers"("uuid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_mcp_server_uuid_idx" ON "mcp_request_audit_logs" USING btree ("mcp_server_uuid");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_mcp_server_name_idx" ON "mcp_request_audit_logs" USING btree ("mcp_server_name");