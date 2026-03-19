# LSP Handlers

## Purpose

Support additional LSP methods beyond the core set, allowing clients to search for symbols, navigate to type definitions, and find implementations by delegating to VS Code's built-in providers.

## Requirements

### Requirement: Bridge handles workspace/symbol requests

The bridge SHALL handle `workspace/symbol` LSP requests by delegating to `vscode.executeWorkspaceSymbolProvider` with the provided query string and returning serialized `SymbolInformation` results.

#### Scenario: Client sends workspace/symbol with a query

- **WHEN** a client sends a `workspace/symbol` request with `{ "query": "Foo" }`
- **THEN** the bridge SHALL invoke `vscode.executeWorkspaceSymbolProvider` with `"Foo"` and return the results as serialized `SymbolInformation[]`

#### Scenario: Client sends workspace/symbol with empty query

- **WHEN** a client sends a `workspace/symbol` request with `{ "query": "" }` or no query field
- **THEN** the bridge SHALL invoke `vscode.executeWorkspaceSymbolProvider` with `""` and return all available symbols

#### Scenario: No symbols found

- **WHEN** `vscode.executeWorkspaceSymbolProvider` returns `null` or an empty array
- **THEN** the bridge SHALL return an empty array `[]`

### Requirement: Bridge handles textDocument/typeDefinition requests

The bridge SHALL handle `textDocument/typeDefinition` LSP requests by delegating to `vscode.executeTypeDefinitionProvider` with the provided document position and returning serialized `Location[]` results.

#### Scenario: Client sends typeDefinition request

- **WHEN** a client sends a `textDocument/typeDefinition` request with `TextDocumentPositionParams`
- **THEN** the bridge SHALL invoke `vscode.executeTypeDefinitionProvider` with the given URI and position and return the results serialized with `serializeLocation`

#### Scenario: No type definition found

- **WHEN** `vscode.executeTypeDefinitionProvider` returns `null` or an empty array
- **THEN** the bridge SHALL return `null`

### Requirement: Bridge handles textDocument/implementation requests

The bridge SHALL handle `textDocument/implementation` LSP requests by delegating to `vscode.executeImplementationProvider` with the provided document position and returning serialized `Location[]` results.

#### Scenario: Client sends implementation request

- **WHEN** a client sends a `textDocument/implementation` request with `TextDocumentPositionParams`
- **THEN** the bridge SHALL invoke `vscode.executeImplementationProvider` with the given URI and position and return the results serialized with `serializeLocation`

#### Scenario: No implementation found

- **WHEN** `vscode.executeImplementationProvider` returns `null` or an empty array
- **THEN** the bridge SHALL return `null`

### Requirement: Server advertises handler capabilities

The bridge SHALL include the following in its server capabilities during the `initialize` handshake:

- `workspaceSymbolProvider: true`
- `typeDefinitionProvider: true`
- `implementationProvider: true`

#### Scenario: Client initializes

- **WHEN** a client sends an `initialize` request
- **THEN** the response capabilities SHALL include all three provider capabilities listed above
