# Proxy

## Purpose

Provide a standalone relay process that bridges Content-Length-framed LSP messages on stdio to raw JSON on a Unix domain socket, bundled as a single self-contained file for distribution in the plugin directory.

## Requirements

### Requirement: Proxy relays stdio to UDS

The proxy SHALL read LSP messages from stdin (Content-Length framed), strip the framing, and forward the raw JSON to the Unix domain socket. Responses from the socket SHALL be wrapped with Content-Length headers and written to stdout.

#### Scenario: Request from Claude Code reaches VS Code

- **WHEN** Claude Code writes a Content-Length framed JSON-RPC message to the proxy's stdin
- **THEN** the proxy forwards the raw JSON body to the UDS connection

#### Scenario: Response from VS Code reaches Claude Code

- **WHEN** the VS Code extension sends a JSON-RPC response over the UDS connection
- **THEN** the proxy wraps it with a `Content-Length` header and writes it to stdout

#### Scenario: Server notification reaches Claude Code

- **WHEN** the VS Code extension sends a JSON-RPC notification (e.g., `textDocument/publishDiagnostics`) over the UDS
- **THEN** the proxy wraps it with a `Content-Length` header and writes it to stdout

### Requirement: Proxy discovers socket from working directory

The proxy SHALL compute the socket path from `process.cwd()` using the same hash algorithm as the extension. It SHALL NOT accept a port number or explicit socket path as an argument.

#### Scenario: Proxy starts in a workspace directory

- **WHEN** the proxy starts and `process.cwd()` matches a VS Code workspace with an active bridge
- **THEN** the proxy connects to the corresponding socket

#### Scenario: Proxy starts with no matching socket

- **WHEN** the proxy starts and no socket file exists at the computed path
- **THEN** the proxy SHALL write a descriptive error to stderr and exit with a nonzero code

### Requirement: Proxy lifecycle follows stdio

The proxy SHALL exit when stdin closes (Claude Code terminated) and SHALL close the UDS connection on exit.

#### Scenario: stdin closes

- **WHEN** stdin emits an end event
- **THEN** the proxy closes the UDS connection and exits with code 0

#### Scenario: UDS connection drops

- **WHEN** the UDS connection closes unexpectedly (VS Code shut down)
- **THEN** the proxy SHALL exit with a nonzero code

### Requirement: Proxy entry point is bundled into a single file

The build system SHALL use esbuild to bundle `src/proxy.ts` and all its dependencies into a single self-contained file at `out/bundle/proxy.cjs`.

#### Scenario: Build produces bundled proxy

- **WHEN** the build runs
- **THEN** `out/bundle/proxy.cjs` exists and contains all code from `proxy.ts` and `socket-path.ts` inlined

#### Scenario: Bundled proxy runs standalone

- **WHEN** `node out/bundle/proxy.cjs` is executed
- **THEN** it SHALL behave identically to the previous two-file setup (no external requires needed)

### Requirement: Proxy is excluded from tsc compilation

The TypeScript compiler SHALL NOT compile `src/proxy.ts`. Only esbuild SHALL produce the proxy output.

#### Scenario: tsc runs

- **WHEN** `tsc -p ./` compiles the project
- **THEN** `out/proxy.cjs` is NOT produced
- **THEN** `out/socket-path.js` is still produced (used by the extension)

### Requirement: Content-Length framing from stdin to UDS

The proxy SHALL parse Content-Length framed messages from stdin and forward the JSON body as newline-delimited messages over the UDS socket.

#### Scenario: Single message through proxy

- **WHEN** a Content-Length framed JSON-RPC message is written to the proxy's stdin
- **THEN** the UDS server receives the JSON body followed by a newline

#### Scenario: Multiple messages in sequence

- **WHEN** multiple Content-Length framed messages are written to stdin in sequence
- **THEN** the UDS server receives each JSON body as a separate newline-delimited message

### Requirement: Newline-delimited framing from UDS to stdout

The proxy SHALL read newline-delimited JSON from the UDS socket and write each message to stdout with Content-Length framing.

#### Scenario: Response written to stdout

- **WHEN** the UDS server sends a newline-delimited JSON response
- **THEN** the proxy writes a Content-Length framed message to stdout with the correct byte length

### Requirement: End-to-end initialize handshake through proxy

The proxy SHALL correctly relay a full LSP initialize/initialized/shutdown/exit sequence.

#### Scenario: Full lifecycle through proxy

- **WHEN** a client performs initialize → initialized → shutdown → exit through the proxy's stdin/stdout
- **THEN** each response is correctly framed and contains the expected JSON-RPC content

### Requirement: Proxy exits on stdin close

The proxy SHALL exit cleanly when its stdin stream ends.

#### Scenario: stdin EOF

- **WHEN** the proxy's stdin is closed
- **THEN** the proxy process exits with code 0

### Requirement: Proxy exits on socket error

The proxy SHALL exit when the UDS socket connection fails or drops.

#### Scenario: UDS server not running

- **WHEN** the proxy starts but no UDS server is listening
- **THEN** the proxy exits with a non-zero exit code and writes an error to stderr
