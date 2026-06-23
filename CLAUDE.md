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

### Endpoint liefert leere Tool-Liste (`returning 0 tools`) trotz vieler Server

**Symptom:** Ein Endpoint verbindet sich im MCP Inspector als **Connected**, aber
`List Tools` zeigt 0 Tools — obwohl die gemappten MCP-Server jede Menge Tools haben.

**Wichtig:** „Connected" im Inspector bezieht sich nur auf die **metamcp-Endpoint-Session**.
Ob die *darunterliegenden* Backend-Server Tools liefern, ist davon unabhängig.

**Diagnose — kein Raten nötig, die Logs sagen es exakt.** Im Backend-Log einer
einzelnen `List Tools`-Anfrage:

```
[DEBUG-TOOLS] 🔍 tools/list called for namespace: <uuid>
[DEBUG-TOOLS] 📋 Processing N servers          ← N=0? → Namespace leer / Server INACTIVE
[DEBUG-TOOLS] ❌ No session for: <name>        ← Session konnte nicht aufgebaut werden
[DEBUG-TOOLS] ✅ tools/list completed ... returning M tools
tools/list DEGRADED for namespace <uuid>: K/N backend server(s) failed (...)
```

**Häufigste Ursache: Connection-Pool gesättigt.** Begleitend im Log:

```
Connection limit reached: 30/30. Refusing to create new connection.
Skipping connection for server <name> (<uuid>) - connection limit reached
```

Der Pool (`mcp-server-pool.ts`) deckelt die Gesamtzahl gleichzeitiger Backend-
Verbindungen (= STDIO-Kindprozesse) auf `MAX_TOTAL_CONNECTIONS`. Mit
`PREWARM_IDLE_SERVERS=true` (Default) öffnet `startup.ts:initializeIdleServers`
beim Start **eager** je eine Idle-Verbindung für **jeden** konfigurierten Server
**plus** eine Idle-MetaMCP-Instanz **pro Namespace** (die wiederum eigene Backend-
Verbindungen aufbaut). Bei vielen Servern × mehreren Namespaces ist das Limit damit
**vor dem ersten Client-Request** ausgeschöpft → neue Endpoints bekommen 0 freie
Slots → alle Backends werden abgelehnt → `returning 0 tools`.

Hinweis: Ein Zählerwert *über* dem Limit (z.B. `31/30`, `32/30`) ist **kein** Bug,
sondern die mitgezählten In-Flight-Reservierungen (`pendingActiveConnections`) aus
dem Race-Fix. Der Pool bleibt nur deshalb dauerhaft bei `30/30`, weil konvertierte
Prewarm-Idle-Sessions sofort nachgespawnt werden und den Floor permanent belegen.

**Fix (Deployment-`.env`, kein Code-Bug):**

```env
# Lazy statt eager verbinden — Slots werden erst bei tatsächlicher Nutzung belegt
# und nach SESSION_LIFETIME (30 min) wieder freigegeben.
PREWARM_IDLE_SERVERS=false
# Headroom für gleichzeitig aktive Endpoints. Faustregel: >= Summe der gemappten
# Server über alle gleichzeitig genutzten Namespaces + Puffer. Code-Default ist 100.
MAX_TOTAL_CONNECTIONS=60
```

Danach den **metamcp-Container neu starten** — der gesättigte Pool heilt sich nicht
von selbst (Prewarm-Idles werden sofort nachgezogen); erst ein Restart leert ihn.

Bleibt Prewarm aus RAM-Gründen an, stattdessen nur `MAX_TOTAL_CONNECTIONS` deutlich
hochsetzen (z.B. 100) — kostet aber entsprechend Idle-RAM/Prozesse.

**Weitere Ursachen für leere Tool-Liste** (falls *nicht* „connection limit reached"
im Log steht):
- `Processing 0 servers` → Namespace hat keine Server gemappt oder alle stehen auf
  `INACTIVE` (`fetch-metamcp.ts` filtert `status != ACTIVE` und `error_status != NONE` raus).
- Server error-gated → beim Start gecrasht (siehe SDK-Abschnitt oben),
  `error_status=ERROR` → werden komplett aus `tools/list` ausgeschlossen.
- Alle Tools der Namespace manuell auf `INACTIVE` → Filter-Middleware entfernt sie
  nach dem Abruf (`filter-tools.functional.ts`).
