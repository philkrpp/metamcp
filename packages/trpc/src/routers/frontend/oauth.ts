import {
  ExchangeOAuthTokenRequestSchema,
  ExchangeOAuthTokenResponseSchema,
  GetOAuthSessionRequestSchema,
  GetOAuthSessionResponseSchema,
  RefreshOAuthTokenRequestSchema,
  RefreshOAuthTokenResponseSchema,
  UpsertOAuthSessionRequestSchema,
  UpsertOAuthSessionResponseSchema,
} from "@repo/zod-types";
import { z } from "zod";

import { adminProcedure, router } from "../../trpc";

// Define the OAuth router with procedure definitions
// The actual implementation will be provided by the backend
export const createOAuthRouter = (
  // These are the implementation functions that the backend will provide
  implementations: {
    get: (
      input: z.infer<typeof GetOAuthSessionRequestSchema>,
    ) => Promise<z.infer<typeof GetOAuthSessionResponseSchema>>;
    upsert: (
      input: z.infer<typeof UpsertOAuthSessionRequestSchema>,
    ) => Promise<z.infer<typeof UpsertOAuthSessionResponseSchema>>;
    exchangeToken: (
      input: z.infer<typeof ExchangeOAuthTokenRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof ExchangeOAuthTokenResponseSchema>>;
    refreshToken: (
      input: z.infer<typeof RefreshOAuthTokenRequestSchema>,
      userId: string,
    ) => Promise<z.infer<typeof RefreshOAuthTokenResponseSchema>>;
  },
) => {
  return router({
    // Admin only: Get OAuth session by MCP server UUID. The response is the
    // raw upstream credential set for that MCP server — `tokens`
    // (access_token + refresh_token), `client_information` (client_id +
    // client_secret) and `code_verifier`, all unredacted (see
    // `apps/backend/src/db/serializers/oauth-sessions.serializer.ts`). It is
    // server config, not per-user data: there is no per-caller row here, so
    // `protectedProcedure` handed every member the gateway's credentials for
    // every upstream MCP server. Gated to match its sibling `upsert`, which
    // writes the same records.
    get: adminProcedure
      .input(GetOAuthSessionRequestSchema)
      .output(GetOAuthSessionResponseSchema)
      .query(async ({ input }) => {
        return await implementations.get(input);
      }),

    // Admin only: Upsert OAuth session — writes upstream MCP-server OAuth
    // client credentials/tokens, a server-config surface, not a per-user one.
    upsert: adminProcedure
      .input(UpsertOAuthSessionRequestSchema)
      .output(UpsertOAuthSessionResponseSchema)
      .mutation(async ({ input }) => {
        return await implementations.upsert(input);
      }),

    // Admin only: Server-side authorization-code-to-tokens exchange. This
    // exists because most enterprise OAuth providers don't return CORS
    // headers on their token endpoints, so the browser cannot do the
    // exchange directly. See docs/en/troubleshooting/oauth-troubleshooting.
    //
    // ctx.user.id is forwarded so the impl can enforce ownership on the
    // referenced MCP server (the upstream URL is loaded from that row, not
    // taken from the request, to prevent SSRF).
    exchangeToken: adminProcedure
      .input(ExchangeOAuthTokenRequestSchema)
      .output(ExchangeOAuthTokenResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.exchangeToken(input, ctx.user.id);
      }),

    // Admin only: Server-side refresh-token grant. Same CORS rationale and
    // same ownership-check requirement. Both return raw upstream tokens, so
    // they share the admin gate of `get`/`upsert`.
    refreshToken: adminProcedure
      .input(RefreshOAuthTokenRequestSchema)
      .output(RefreshOAuthTokenResponseSchema)
      .mutation(async ({ input, ctx }) => {
        return await implementations.refreshToken(input, ctx.user.id);
      }),
  });
};
