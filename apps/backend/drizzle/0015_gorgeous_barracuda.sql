CREATE INDEX "mcp_request_audit_logs_api_key_user_created_at_idx" ON "mcp_request_audit_logs" USING btree ("api_key_user_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_oauth_user_created_at_idx" ON "mcp_request_audit_logs" USING btree ("oauth_user_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_api_key_created_at_idx" ON "mcp_request_audit_logs" USING btree ("api_key_uuid","created_at");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_namespace_created_at_idx" ON "mcp_request_audit_logs" USING btree ("namespace_uuid","created_at");--> statement-breakpoint
CREATE INDEX "mcp_request_audit_logs_status_created_at_idx" ON "mcp_request_audit_logs" USING btree ("status","created_at");