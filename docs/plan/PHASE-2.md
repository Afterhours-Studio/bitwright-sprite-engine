# Phase 2 — MCP, broken into tasks

This is the working breakdown of [Phase 2 in the plan](PLAN.md#phase-2--mcp).
The tool catalogue it builds against is [the MCP tools](../architecture/mcp-tools.md),
and the document it drives is [the document model](../architecture/document-model.md).

The rules of [§7 of the plan](PLAN.md#7-rules-of-execution) apply unchanged:
parallel tasks never share a file, a contract task precedes the wave that
depends on it, every task is reviewed by a worker that did not write it, and a
wave passes on real `cargo build`, `cargo test`, `npm run typecheck`,
`npm run lint` and `npm run test` output, not on a report.

Paths below are relative to `apps/desktop/src-tauri/src/` for Rust and
`apps/desktop/src/` for TypeScript.

---

## Scope moved out of Phase 2

Four tools in the catalogue need machinery that later phases build, and are
registered by those phases rather than stubbed here:

| Tool                         | Needs                                 | Registered by |
| ---------------------------- | ------------------------------------- | ------------- |
| `read_reference`             | conformed references from the sidecar | 3.3           |
| `extract_palette`            | the sidecar's weighted k-means        | 3.3           |
| `export_png`, `export_sheet` | the export root and writer            | 4.2           |

The Settings panel's **Install Skills** button belongs to 3.2 for the same
reason. A tool that is not registered is absent from `tools/list`; nothing in
Phase 2 answers with a placeholder.

---

## Wave A — the contract (one task, blocks everything else)

### A.1 The `mcp` module skeleton

**Owns:** `mcp/mod.rs`, `mcp/error.rs`, `mcp/host.rs`, `mcp/session.rs`,
`mcp/tools/mod.rs`, and one empty group file per Wave B tool task
(`mcp/tools/{orientation,read,write,shading,palette,workflow,history}.rs`, each
exporting `pub fn tools() -> Vec<ToolSpec> { Vec::new() }`), `main.rs` (the
single line `mod mcp;` only), `Cargo.toml`, `commands/document.rs` (the two
visibility changes below only).

The shapes every later task codes against:

```rust
// mcp/error.rs
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolError { pub code: String, pub message: String, pub hint: String }
impl ToolError { pub fn new(code: &str, message: impl Into<String>, hint: impl Into<String>) -> Self }
impl From<AppError> for ToolError   // maps store and raster codes onto the catalogue's §2 table
pub type ToolResult = Result<serde_json::Value, ToolError>;

// mcp/session.rs
pub struct Session { pub id: String, current: Mutex<Option<AssetId>> }
impl Session {
    pub fn new(id: impl Into<String>) -> Self;
    pub fn actor(&self) -> String;                    // "agent:<id>"
    pub fn current_asset(&self) -> Option<AssetId>;
    pub fn set_current_asset(&self, id: AssetId);
}

// mcp/host.rs — what a tool may touch, and nothing else
pub trait DocumentHost: Send + Sync {
    fn store(&self) -> Arc<Mutex<Store>>;
    fn changed(&self, asset: AssetId, result: &OpResult);   // after a pixel commit
    fn palette_changed(&self, asset: AssetId);
    fn step_changed(&self, asset: AssetId, gate: &GateReport);
    fn opened(&self, asset: AssetId);                       // bring it up in the window
    fn activity(&self, session: &str, tool: &str, asset: AssetId);
}
pub struct TauriHost<R: Runtime> { app: AppHandle<R> }      // emits the document:// and agent:// events
pub struct HeadlessHost { store: Arc<Mutex<Store>> }        // stdio and tests; notifications are no-ops
pub fn with_store<T>(host: &dyn DocumentHost, work: impl FnOnce(&mut Store) -> crate::store::Result<T>)
    -> Result<T, ToolError>;                                // poisoned lock -> store.lock_failed

// mcp/tools/mod.rs
pub type Handler = fn(&dyn DocumentHost, &Session, serde_json::Value) -> ToolResult;
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,       // written for a model, from the catalogue
    pub input_schema: fn() -> serde_json::Value,   // JSON Schema object
    pub handler: Handler,
}
pub fn catalogue() -> Vec<ToolSpec>;     // concatenates every group's tools()
pub fn call(host: &dyn DocumentHost, session: &Session, name: &str, args: serde_json::Value) -> ToolResult;
                                         // unknown name -> tool.unknown; emits activity for asset tools

// shared helpers, in tools/mod.rs, used by every group
pub fn parse<T: DeserializeOwned>(args: serde_json::Value) -> Result<T, ToolError>;        // args.invalid
pub fn asset_id(value: &str) -> Result<AssetId, ToolError>;                                 // asset.not_found
pub fn resolve_asset(session: &Session, value: Option<&str>) -> Result<AssetId, ToolError>; // asset.not_open
pub fn role(value: &str) -> Result<LayerRole, ToolError>;                                  // layer.unknown_role
pub fn step_of(role: LayerRole) -> &'static str;           // the §6 table of the document model
pub fn guard_step(asset: &Asset, role: LayerRole, force: bool) -> Result<(), ToolError>;   // step.wrong
pub fn summary(result: &OpResult) -> serde_json::Value;    // { changed, bounds: {x,y,w,h} | null, seq }
```

`commands/document.rs` gains exactly two things: `DocumentState::store()`
returning the `Arc<Mutex<Store>>`, and `pub fn notify_changed` (today's private
`changed`) so `TauriHost` reuses the frame-coalesced emit instead of writing a
second one.

`Cargo.toml` gains every Phase 2 dependency now, so no Wave B task has to touch
it: `rmcp` (server, macros, stdio and streamable HTTP server transports),
`axum`, `tokio` with `rt-multi-thread`, `net`, `io-std`, `signal`, `rand`, and
`dirs` if client detection needs it.

**Done when:** `cargo build` and `cargo test` pass, and `mcp/tools/mod.rs` has
tests for `parse`, `role`, `step_of`, `guard_step`, `summary` and the `From`
mapping.

---

## Wave B — tools, transports and panels (parallel)

Every task here owns only the files listed. Tool tasks test against
`HeadlessHost` over `Store::memory()`, in a `#[cfg(test)]` module in the file
they own.

| Task    | Owns                                                                                              | Builds                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B.1** | `mcp/tools/orientation.rs`                                                                        | `list_projects`, `create_project`, `list_assets`, `create_asset`, `open_asset`, `get_style_rules`                                                                                                                                                                       |
| **B.2** | `mcp/grid.rs`, `mcp/tools/read.rs`                                                                | the grid text codec (slot ↔ character, legend, rulers); `read_canvas`, `read_region`, `describe_palette`, `diff_layers`                                                                                                                                                 |
| **B.3** | `mcp/tools/write.rs`                                                                              | `paste_grid`, `draw_runs`, `set_pixels` (512 cap), `draw_shape`, `fill_region`, `mirror`, `translate`, `clear_layer`, each behind `guard_step` with `force`                                                                                                             |
| **B.4** | `mcp/tools/shading.rs`, `mcp/tools/palette.rs`                                                    | `shade`, `outline`, `antialias`; `set_palette` (hex in, rules checked, `palette.rule_violation` naming the ramp), `create_variation`                                                                                                                                    |
| **B.5** | `mcp/tools/workflow.rs`, `mcp/tools/history.rs`, `store/workflow.rs`                              | `get_step`, `check_step`, `advance_step` (forced advances recorded), `revisit_step` (with `Store::step_revisit`); `undo`/`redo` with `count`, `read_history`                                                                                                            |
| **B.6** | `mcp/server.rs`, `mcp/stdio.rs`, `mcp/config.rs`, and their three `pub mod` lines in `mcp/mod.rs` | streamable HTTP on loopback, bearer token, `Origin` refused, a `Session` per MCP session, `agent://session` events; stdio over `HeadlessHost`; persisted port and token; the Tauri commands below                                                                       |
| **B.7** | `mcp/clients.rs`, and its `pub mod` line in `mcp/mod.rs`                                          | detection and config writing for Claude Code, Claude Desktop and Cursor; register, unregister, manual snippet; the Tauri commands below                                                                                                                                 |
| **B.8** | `features/settings/mcp/**`, `features/editor/live/**`, `types/mcp.ts`, `lib/mcp.ts`, `locales/**` | the Settings panel: transport, port, token, session list, per-client rows, Configure All Detected Clients, manual config; the agent-activity indicator and throttled refresh on `document://changed` and `agent://*`; every string both need, in English and Vietnamese |

B.1–B.5 depend only on A.1. B.6 depends on A.1 and serves whatever
`catalogue()` returns. B.7 reads the endpoint from B.6, so it follows it, and
the two are the only Wave B tasks that touch `mcp/mod.rs`, one after the other. B.8 depends only on the command and event contract
below. The two panels are one task because both need new strings, and the
locale files cannot have two owners.

### The Tauri commands and events B.6, B.7 and B.8 share

```ts
// commands (snake_case on the Rust side, camelCase fields on the wire)
mcp_status(): McpStatus
mcp_set_transport(transport: "http" | "off"): McpStatus
mcp_regenerate_token(): McpStatus
mcp_clients(): McpClient[]
mcp_client_register(id: McpClientId): McpClient
mcp_client_unregister(id: McpClientId): McpClient
mcp_manual_config(): string          // a JSON snippet for any other client

type McpClientId = "claude-code" | "claude-desktop" | "cursor";
interface McpStatus {
  transport: "http" | "off";
  running: boolean;
  port: number | null;
  url: string | null;               // "http://127.0.0.1:<port>/mcp"
  token: string;
  sessions: { id: string; connectedAt: number; lastToolAt: number | null; lastTool: string | null }[];
}
interface McpClient {
  id: McpClientId; name: string; detected: boolean;
  configPath: string; registered: boolean;
}

// events (already emitted by commands/document.rs)
"agent://session"  { sessionId, state: "connected" | "disconnected" }
"agent://activity" { sessionId, tool, assetId }
"document://changed" { assetId, roles, seq }
```

---

## Wave C — integration (one task, after Wave B passes)

**Owns:** `main.rs`, `commands.rs`, `features/settings/SettingsScreen.tsx`,
`features/editor/EditorScreen.tsx`, `locales/**` (only strings Wave C itself adds), `docs/**` except
`docs/plan/`, `README.md`.

Starts the HTTP server during setup when the transport is `http`; routes
`--mcp-stdio` to `mcp::stdio::run` before the window is created; registers the
B.6 and B.7 commands in `commands::handler`; mounts the B.8 panel and indicator; brings the
getting-started and architecture docs in line with what now exists.

---

## Review and the gate

Each Wave B task is reviewed by the other worker slot. A review names file and
line, and says what input produces the wrong result; style preferences are not
findings. Findings go back to the author, and the pair repeat until the reviewer
has nothing. Then the gate is run and read: `cargo build`, `cargo test`,
`npm run typecheck`, `npm run lint`, `npm run test`, `pytest`. Phase 3 starts
when all of them pass on the integrated branch.

---

## Status

Phase 2 is complete. The `rmcp` server runs inside the application over two
transports — loopback HTTP with a bearer token, and stdio via `--mcp-stdio` —
and registers the thirty tools of the catalogue. The Settings **Agent
connection** card, client detection and configuration writing, and the live sync
are built.

Four tools moved out of the phase, as recorded in
[Scope moved out of Phase 2](#scope-moved-out-of-phase-2), and are registered by
the phases that build their machinery:

- `read_reference` and `extract_palette` — Phase 3, reference import.
- `export_png` and `export_sheet` — Phase 4, export.
- The **Install Skills** button — Phase 3, the skill pack.

`useLiveRefresh` was dropped: the events are already coalesced per frame in
`commands/document.rs`, so a second throttling layer in the renderer would only
add latency.
