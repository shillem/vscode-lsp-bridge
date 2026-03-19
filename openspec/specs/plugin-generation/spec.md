# Plugin Generation

## Purpose

Generate the Claude Code plugin directory (`.claude/plugins/vscode-lsp-bridge/`) including the plugin manifest, LSP config, and bundled proxy, triggered by an explicit user command, so Claude Code can discover and use the bridge without manual setup.

## Requirements

### Requirement: Generate Local Claude Plugins command

The extension SHALL register a command `lspBridge.generateClaudePlugin` titled "LSP Bridge: Generate Local Claude Plugins" that writes the Claude plugin directory to the workspace.

#### Scenario: Successful plugin generation

- **WHEN** the user invokes the "Generate Local Claude Plugins" command
- **AND** a workspace folder is open
- **AND** `lspBridge.languages` contains at least one language
- **THEN** the plugin directory SHALL be written to `.claude/plugins/vscode-lsp-bridge/` with `plugin.json`, `.lsp.json`, and `proxy.cjs`
- **THEN** a success message SHALL be shown

#### Scenario: No workspace folder open

- **WHEN** the user invokes the command without a workspace folder open
- **THEN** the extension SHALL show a warning message indicating no workspace folder is open
- **THEN** no files SHALL be written

#### Scenario: No languages selected

- **WHEN** the user invokes the command with `lspBridge.languages` empty
- **THEN** the extension SHALL show a warning with an option to select languages
- **THEN** no files SHALL be written until languages are configured

### Requirement: Extension generates Claude Code plugin directory

The command SHALL remove the existing plugin directory and recreate it before writing files to `.claude/plugins/vscode-lsp-bridge/` relative to the workspace root:

- `.claude-plugin/plugin.json` — plugin manifest with name sourced from the shared `EXTENSION_NAME` constant and version sourced from `package.json` via `ExtensionContext`
- `.lsp.json` — LSP server configuration pointing to the bundled proxy
- `proxy.cjs` — the single bundled stdio-to-UDS relay script (copied from `out/bundle/proxy.cjs`)

#### Scenario: User runs generate command in a workspace

- **WHEN** the user invokes the "Generate Local Claude Plugins" command and a workspace folder is open with languages configured
- **THEN** the plugin directory is created with all three files
- **THEN** `proxy.cjs` in the plugin directory is a single self-contained file
- **THEN** `plugin.json` SHALL contain the version from `package.json`
- **THEN** `plugin.json` SHALL contain the name from the shared `EXTENSION_NAME` constant

#### Scenario: Plugin directory already exists

- **WHEN** the user invokes the "Generate Local Claude Plugins" command and the plugin directory already exists
- **THEN** the extension SHALL remove all existing contents of the plugin directory before writing
- **THEN** only the currently generated files SHALL be present after generation completes

#### Scenario: Plugin directory contains stale files from a prior generation

- **WHEN** the plugin directory contains files that are no longer part of the current generation set
- **AND** the user invokes the "Generate Local Claude Plugins" command
- **THEN** the stale files SHALL be removed
- **THEN** only the currently generated files SHALL remain

#### Scenario: Plugin directory path uses shared constant

- **WHEN** the plugin directory path is constructed
- **THEN** the path SHALL use the shared `EXTENSION_NAME` constant instead of a hardcoded string

### Requirement: .lsp.json reflects selected languages

The generated `.lsp.json` SHALL contain an `extensionToLanguage` map built from the user's `lspBridge.languages` setting, including only languages that match installed VS Code extensions.

#### Scenario: User has TypeScript and Python selected

- **WHEN** `lspBridge.languages` is `["typescript", "python"]` and VS Code has extensions for both
- **THEN** `.lsp.json` SHALL include entries for TypeScript and Python file extensions only

#### Scenario: Selected language has no matching extension

- **WHEN** `lspBridge.languages` contains a language ID not provided by any installed extension
- **THEN** that language is silently skipped — no entry in `.lsp.json`

### Requirement: .lsp.json regenerated on language or extension changes

The extension SHALL regenerate `.lsp.json` when:

- The `lspBridge.languages` setting changes while the server is running AND the plugin directory exists
- The set of installed VS Code extensions changes while the server is running AND the plugin directory exists

#### Scenario: User changes language setting while server is running and plugin exists

- **WHEN** the server is running and the user adds `"go"` to `lspBridge.languages`
- **AND** the plugin directory `.claude/plugins/vscode-lsp-bridge/` exists in the workspace
- **THEN** `.lsp.json` is regenerated to include Go file extensions

#### Scenario: User changes language setting but plugin directory does not exist

- **WHEN** the server is running and the user changes `lspBridge.languages`
- **AND** the plugin directory does not exist in the workspace
- **THEN** no files SHALL be written

### Requirement: .lsp.json command points to bundled proxy

The `.lsp.json` SHALL use `"command": "node"` with `"args"` containing the relative path to the bundled `proxy.cjs` so that Claude Code spawns the proxy directly.

#### Scenario: Claude Code reads .lsp.json

- **WHEN** Claude Code parses the generated `.lsp.json`
- **THEN** it finds a valid LSP server config with `command`, `args`, and `extensionToLanguage`

### Requirement: No workspace, no plugin generation

The extension SHALL NOT generate the plugin directory if no workspace folder is open.

#### Scenario: Extension activates without a workspace

- **WHEN** the extension activates and no workspace folder is open
- **THEN** the plugin directory is not created and no error is shown
