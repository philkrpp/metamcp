# CLAUDE.md

Guidance for Claude Code when working in this repository (metamcp).

## Troubleshooting

### MCP-Server bricht beim Start mit SDK-Versions-Inkompatibilität

**Symptom** (Beispiel PrimeNG / `@primeng/mcp`):

```
Failed to start <X> MCP Server: Error: Tool <name> expected a Zod schema or
ToolAnnotations, but received an unrecognized object
  at McpServer.tool (.../@modelcontextprotocol/sdk/dist/esm/server/mcp.js)
```

**Ursache:** Der MCP-Server hängt per `^`-Range an `@modelcontextprotocol/sdk`
(z.B. `^1.25.2`), und `npx` zieht die **neueste** passende SDK. Neuere SDK-Versionen
haben `server.tool()` strenger gemacht und erkennen die (oft zod-v3-basierten)
Tool-Schemas des Servers nicht mehr → Crash bei der Tool-Registrierung.

Für `@modelcontextprotocol/sdk` verifiziert: **1.25.2 / 1.26.0 / 1.27.0 = ok**,
ab **~1.28 / 1.29.0 = bricht**. Es ist kein Bug in metamcp, sondern im jeweiligen
MCP-Server bzw. dessen zu lockerer SDK-Range — eigentlich ein Upstream-Fix.

**Eigen-Fix: SDK auf eine kompatible Version pinnen.**

Allgemeines Prinzip — beim npx-Start die SDK mit-installieren, npm dedupt dann
die ganze Abhängigkeitskette auf die gepinnte Version:

```
npx -y -p <server-pkg> -p @modelcontextprotocol/sdk@1.27.0 -c <server-bin>
```

- `-p` zweimal → beide Pakete top-level → Dedup auf die gepinnte SDK.
- `-c <bin>` ist **wichtig**: die positionale Form (`npx -p A -p B <bin>`) scheitert
  im Container an der bin-Auflösung mit `npm error code ENOVERSIONS`
  (`No versions available for <bin>`). `-c` führt den bin in vorbereiteter
  PATH-Umgebung aus und umgeht das.

Konkret für PrimeNG (bin heißt `primeng-mcp`):

```
npx -y -p @primeng/mcp@21.1.9 -p @modelcontextprotocol/sdk@1.27.0 -c primeng-mcp
```

**Zuverlässigster Fallback (ins Docker-Image backen):** gepinnte Installation per
`overrides`, Start über `node` mit absolutem Pfad — keine npx-Auflösung zur Laufzeit:

`primeng-mcp/package.json`:
```json
{
  "name": "primeng-mcp-pinned",
  "private": true,
  "dependencies": { "@primeng/mcp": "21.1.9" },
  "overrides": { "@modelcontextprotocol/sdk": "1.27.0" }
}
```

Dockerfile:
```dockerfile
RUN mkdir -p /opt/primeng-mcp
COPY primeng-mcp/package.json /opt/primeng-mcp/package.json
RUN cd /opt/primeng-mcp && npm install --omit=dev --no-audit --no-fund
```

metamcp-Server-Config:
```json
{ "type": "STDIO", "command": "node",
  "args": ["/opt/primeng-mcp/node_modules/@primeng/mcp/dist/index.js"] }
```

**Diagnose-Hinweise für ähnliche Fälle:**
- Wrapper-Pakete kennen: `@primeng/mcp` (hat bin `primeng-mcp`) lädt intern
  `@primeuix/mcp` und ruft beim Modul-Laden top-level `runPrimeMcpServer({...})`
  mit eingebetteten Daten auf. Daher **nicht** das innere Paket direkt starten —
  sonst fehlen die Daten.
- Bricht ein Server, prüfen welche SDK-Range er deklariert
  (`npm view <pkg> dependencies`) und ob eine ältere SDK den strengen Check noch
  nicht hat (SDK-Quelle unter `dist/esm/server/mcp.js`).
