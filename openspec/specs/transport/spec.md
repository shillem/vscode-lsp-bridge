# Transport

## Purpose

Provide a Unix domain socket transport layer for the bridge, allowing external processes to connect and communicate with the LSP server running inside VS Code, with access restricted to the owning user.

## Requirements

### Requirement: Extension listens on a Unix domain socket

The extension SHALL create a Unix domain socket at a deterministic path derived from the workspace folder URI. The path SHALL be `<os.tmpdir()>/<EXTENSION_NAME>-<hash>.sock` where `<EXTENSION_NAME>` is the shared constant and `<hash>` is the first 8 hex characters of a hash of the workspace folder URI.

#### Scenario: Extension starts and listens

- **WHEN** the bridge server starts
- **THEN** the extension creates a Unix domain socket at the deterministic path and accepts connections

#### Scenario: Socket path is deterministic

- **WHEN** two processes compute the socket path for the same workspace folder URI
- **THEN** both derive the identical path

#### Scenario: Socket path uses shared constant

- **WHEN** the socket path is constructed
- **THEN** the path prefix SHALL use the shared `EXTENSION_NAME` constant instead of a hardcoded string

#### Scenario: Stale socket cleanup on startup

- **WHEN** the bridge server starts and a socket file already exists at the target path
- **THEN** the extension SHALL unlink the stale socket file before binding

#### Scenario: Socket cleanup on deactivation

- **WHEN** the extension deactivates
- **THEN** the extension SHALL unlink the socket file

### Requirement: UDS transport implements the Transport interface

The UDS transport SHALL implement the existing `Transport` interface (`onMessage`, `onClose`, `onError`, `send`, `close`). Messages on the socket SHALL be raw JSON strings (no Content-Length framing) — framing is only needed on the stdio side.

#### Scenario: Client connects and sends a message

- **WHEN** a client connects to the socket and sends a JSON string
- **THEN** the transport SHALL invoke the `onMessage` callback with the raw string

#### Scenario: Client disconnects

- **WHEN** a connected client's socket closes
- **THEN** the transport SHALL invoke the `onClose` callback

### Requirement: Multiple simultaneous connections

The server SHALL accept multiple client connections, each creating an independent `Session` instance, consistent with the current architecture. Server capabilities advertised during the `initialize` handshake SHALL be derived dynamically from handler registrations rather than a hardcoded object. The only static capability SHALL be `textDocumentSync`. The `serverInfo` returned during `initialize` SHALL be passed via the `Session` constructor rather than imported from `package.json`.

#### Scenario: Two clients connect

- **WHEN** two clients connect to the same socket
- **THEN** each gets an independent session with its own state

#### Scenario: Capabilities reflect registered handlers

- **WHEN** a new handler is registered with a capability declaration
- **THEN** the server capabilities returned during `initialize` SHALL include that handler's capability without any additional configuration

#### Scenario: Server info reflects extension metadata

- **WHEN** a client sends an `initialize` request
- **THEN** the response `serverInfo` SHALL contain the extension name and version passed through the constructor chain
- **THEN** the `serverInfo` SHALL NOT be sourced from a direct `package.json` import

### Requirement: Socket file permissions are restricted to the owner

After the server starts listening on the Unix domain socket, the extension SHALL set the socket file permissions to `0o600` (owner read/write only) using `chmodSync` from `node:fs`.

#### Scenario: Server starts listening

- **WHEN** the UDS transport server begins listening on the socket
- **THEN** the socket file permissions SHALL be set to `0o600`

#### Scenario: Socket path and naming are unchanged

- **WHEN** socket security is applied
- **THEN** the socket path and naming convention SHALL remain the same as defined above

### Requirement: Security hardening is additive

The permission restriction SHALL be purely additive hardening with no impact on systems where isolation is already guaranteed (e.g., macOS per-user tmpdir or single-user systems).

#### Scenario: macOS per-user tmpdir

- **WHEN** the host OS already isolates the tmpdir per user
- **THEN** the `0o600` permission is applied as defense-in-depth without affecting functionality

### Requirement: Session initialization handshake

The system SHALL respond to an `initialize` request with server capabilities and server info, and transition to the `initializing` state.

#### Scenario: Successful initialize

- **WHEN** a client sends an `initialize` request over a connected UDS transport
- **THEN** the session responds with a JSON-RPC result containing `capabilities` (including `textDocumentSync: 1` and handler capabilities) and `serverInfo`

#### Scenario: Double initialize rejected

- **WHEN** a client sends an `initialize` request after already initializing
- **THEN** the session responds with an `InvalidRequest` error (-32600)

### Requirement: Session state enforcement

The system SHALL reject requests that arrive in an invalid state.

#### Scenario: Request before initialize

- **WHEN** a client sends a `textDocument/hover` request before sending `initialize`
- **THEN** the session responds with a `ServerNotInitialized` error (-32002)

#### Scenario: Request after shutdown

- **WHEN** a client sends a `textDocument/hover` request after the session has been shut down
- **THEN** the session responds with a `ServerNotInitialized` error (-32002)

### Requirement: Session shutdown flow

The system SHALL support a clean shutdown handshake.

#### Scenario: Shutdown then exit

- **WHEN** a client sends `shutdown` followed by `exit`
- **THEN** the session responds to `shutdown` with `null`, then closes the transport on `exit`

#### Scenario: Shutdown before initialize

- **WHEN** a client sends `shutdown` without having initialized
- **THEN** the session responds with an `InvalidRequest` error (-32600)

### Requirement: Method dispatch to handlers

The system SHALL route LSP method requests to registered handlers when in the `ready` state.

#### Scenario: Known method dispatched

- **WHEN** a client sends a request for a method with a registered (stubbed) handler
- **THEN** the session invokes the handler and returns the result as a JSON-RPC response

#### Scenario: Unknown method rejected

- **WHEN** a client sends a request for an unregistered method
- **THEN** the session responds with a `MethodNotFound` error (-32601)

#### Scenario: Handler throws error

- **WHEN** a registered handler throws an exception
- **THEN** the session responds with an `InternalError` (-32603) containing the error message

### Requirement: JSON parse error handling

The system SHALL respond with a parse error when receiving malformed JSON.

#### Scenario: Invalid JSON received

- **WHEN** the transport delivers a non-JSON string
- **THEN** the session sends a `ParseError` response (-32700)

### Requirement: Notification routing

The system SHALL handle LSP notifications without sending a response.

#### Scenario: initialized notification transitions to ready

- **WHEN** a client sends `initialized` after a successful `initialize` request
- **THEN** the session transitions to the `ready` state (subsequent method requests succeed)

#### Scenario: exit notification disposes session

- **WHEN** a client sends an `exit` notification
- **THEN** the session disposes and closes the transport

### Requirement: Multiple concurrent sessions

The server SHALL support multiple independent client sessions on the same UDS server.

#### Scenario: Two clients connect simultaneously

- **WHEN** two clients connect to the same `UdsTransportServer` and each sends an `initialize` request
- **THEN** each receives an independent `initialize` response and operates in its own state

### Requirement: Transport close cleanup

The session SHALL dispose cleanly when the transport closes unexpectedly.

#### Scenario: Client disconnects

- **WHEN** the client socket closes without sending `shutdown`/`exit`
- **THEN** the session disposes without errors and is removed from the server's session set
