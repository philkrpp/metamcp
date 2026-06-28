CREATE TABLE "api_key_endpoint_access" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_uuid" uuid NOT NULL,
	"endpoint_uuid" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_endpoint_access_unique" UNIQUE("api_key_uuid","endpoint_uuid")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "restrict_endpoints" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_endpoint_access" ADD CONSTRAINT "api_key_endpoint_access_api_key_uuid_api_keys_uuid_fk" FOREIGN KEY ("api_key_uuid") REFERENCES "public"."api_keys"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_endpoint_access" ADD CONSTRAINT "api_key_endpoint_access_endpoint_uuid_endpoints_uuid_fk" FOREIGN KEY ("endpoint_uuid") REFERENCES "public"."endpoints"("uuid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_endpoint_access_api_key_uuid_idx" ON "api_key_endpoint_access" USING btree ("api_key_uuid");--> statement-breakpoint
CREATE INDEX "api_key_endpoint_access_endpoint_uuid_idx" ON "api_key_endpoint_access" USING btree ("endpoint_uuid");