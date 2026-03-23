# LSP Bridge for VS Code

> **Experimental** — this extension is under active development and may change significantly.

A VS Code extension that gives [Claude Code](https://docs.anthropic.com/en/docs/claude-code) access to VS Code's language intelligence over a local LSP bridge.

## Why

Claude Code runs in the terminal and has no direct access to VS Code's language server features. This extension bridges that gap by exposing VS Code's language server providers through a Unix domain socket. When the bridge is running, Claude Code can query the same type information, diagnostics, and navigation data that you see in the editor.

Other approaches — such as MCP servers that wrap LSP — suffer from significant token overhead. Every MCP tool definition is injected into the system prompt, and each tool-call response is serialized into the conversation history where it is re-processed on every subsequent turn. An MCP LSP server exposing even a handful of operations adds a significant amount of tokens overhead.

This extension avoids that cost entirely. It integrates as a native LSP server plugin, so Claude Code handles language-server operations through its built-in LSP support rather than through MCP tool calls. Diagnostics flow automatically after every file edit without an explicit tool invocation, and active queries like hover or go-to-definition use Claude Code's internal LSP handling with no per-server schema overhead. The result is the most straightforward and token-efficient way to give Claude Code access to VS Code's language intelligence.

## Supported Language Features

| Feature               | LSP Method                        |
| --------------------- | --------------------------------- |
| Hover                 | `textDocument/hover`              |
| Go to Definition      | `textDocument/definition`         |
| Go to Type Definition | `textDocument/typeDefinition`     |
| Go to Implementation  | `textDocument/implementation`     |
| Find References       | `textDocument/references`         |
| Completions           | `textDocument/completion`         |
| Document Symbols      | `textDocument/documentSymbol`     |
| Workspace Symbols     | `workspace/symbol`                |
| Rename                | `textDocument/rename`             |
| Diagnostics           | `textDocument/publishDiagnostics` |

## Requirements

- VS Code 1.85.0 or later
- macOS or Linux (Windows is not currently supported but could be added if requested)

## Usage

1. Open a workspace in VS Code.
2. Run **LSP Bridge: Select Languages** to choose which languages to expose.
3. Run **LSP Bridge: Generate Local Claude Plugin** to create the plugin directory.
4. Run **LSP Bridge: Start Server** from the Command Palette (`Cmd+Shift+P`).

### Loading the Plugin

The **Generate Local Claude Plugin** command (step 3) creates a plugin directory at `.claude/plugins/vscode-lsp-bridge/` inside your workspace. This is not a marketplace plugin, so Claude Code does not discover it automatically — you need to load it explicitly:

```sh
claude --plugin-dir .claude/plugins/vscode-lsp-bridge
```

To avoid typing this every time, you can add it as a shell alias or use a project-level script.

### Commands

All commands are available from the Command Palette (`Cmd+Shift+P`):

| Command                                      | Description                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **LSP Bridge: Start Server**                 | Start the bridge server for the current workspace                                         |
| **LSP Bridge: Stop Server**                  | Stop the running bridge server                                                            |
| **LSP Bridge: Select Languages**             | Pick which languages to include in the generated Claude plugin configuration              |
| **LSP Bridge: Generate Local Claude Plugin** | Generate or regenerate the Claude plugin directory (`.claude/plugins/vscode-lsp-bridge/`) |

### Options

To start the bridge automatically when VS Code opens, enable the setting:

```json
{
  "lspBridge.autoStart": true
}
```

## How It Works

The extension listens on a Unix domain socket with a deterministic path derived from the workspace folder. A proxy script connects Claude Code to the socket using the `socket` transport mode. The extension generates a Claude Code plugin directory (`.claude/plugins/vscode-lsp-bridge/`) containing the proxy and `.lsp.json` configuration, which is then loaded via `--plugin-dir`.

## License

MIT
