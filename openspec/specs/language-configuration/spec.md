# Language Configuration

## Purpose

Discover available languages from installed VS Code extensions, let the user select which to expose through the bridge, and map them to file extensions for the Claude Code `.lsp.json` plugin config.

## Requirements

### Requirement: Discover language mappings from VS Code extension registry

The extension SHALL build the language ID → file extension mapping by reading `contributes.languages` from all installed VS Code extensions via `vscode.extensions.all`. This SHALL include both built-in extensions and third-party extensions.

#### Scenario: Built-in language is discovered

- **WHEN** VS Code has a built-in extension contributing `{ "id": "typescript", "extensions": [".ts"] }`
- **THEN** the discovery includes `typescript` with extension `".ts"`

#### Scenario: Third-party language is discovered

- **WHEN** a third-party extension contributes `{ "id": "prisma", "extensions": [".prisma"] }`
- **THEN** the discovery includes `prisma` with extension `".prisma"`

#### Scenario: Extension with no language contributions

- **WHEN** an extension has no `contributes.languages` in its `package.json`
- **THEN** it is skipped without error

#### Scenario: Malformed language contribution

- **WHEN** an extension has a language entry missing `id` or `extensions`
- **THEN** that entry is skipped without error

### Requirement: Merge file extensions per language ID

When multiple extensions contribute file extensions for the same language ID, the discovery SHALL merge all file extensions into a single set for that language.

#### Scenario: Two extensions contribute to the same language

- **WHEN** extension A contributes `{ "id": "typescript", "extensions": [".ts"] }` and extension B contributes `{ "id": "typescript", "extensions": [".mts"] }`
- **THEN** the discovery includes `typescript` with extensions `[".ts", ".mts"]`

### Requirement: Discovery returns sorted results

The discovery SHALL return languages sorted alphabetically by language ID, with file extensions sorted within each language.

### Requirement: User selects languages via a setting

The extension SHALL provide a `lspBridge.languages` setting of type `string[]` (default: `[]`) that lists the language IDs to expose through the bridge. Only languages present in this setting SHALL appear in the generated `.lsp.json`.

#### Scenario: Setting contains valid language IDs

- **WHEN** `lspBridge.languages` is `["typescript", "python"]`
- **AND** VS Code has extensions contributing those languages
- **THEN** `.lsp.json` includes only mappings for TypeScript and Python file extensions

#### Scenario: Setting is empty

- **WHEN** `lspBridge.languages` is `[]`
- **THEN** the server SHALL NOT start and a warning is shown with an action to open the language picker

### Requirement: QuickPick command for language selection

The extension SHALL provide a `lspBridge.selectLanguages` command that opens a multi-select QuickPick showing all discovered languages. Each item SHALL display the language ID as the label and its file extensions as the description. Currently selected languages SHALL be pre-checked.

#### Scenario: User opens the language picker

- **WHEN** the user runs `LSP Bridge: Select Languages`
- **THEN** a QuickPick appears with all languages discovered from `vscode.extensions.all`
- **AND** languages in the current `lspBridge.languages` setting are pre-selected

#### Scenario: User confirms selection

- **WHEN** the user confirms the QuickPick
- **THEN** the selected language IDs are written to `lspBridge.languages` in workspace settings (or global if no workspace is open)

#### Scenario: User cancels the picker

- **WHEN** the user dismisses the QuickPick without confirming
- **THEN** the setting is unchanged

### Requirement: Mapping produces valid extensionToLanguage entries

The mapping SHALL produce entries in the format expected by Claude Code's `.lsp.json`: an object where keys are dot-prefixed file extensions (e.g., `".ts"`) and values are language IDs (e.g., `"typescript"`). The mapping source SHALL be VS Code's extension registry, filtered by the user's `lspBridge.languages` setting.

#### Scenario: Generating extensionToLanguage from selected languages

- **WHEN** `lspBridge.languages` is `["typescript", "python"]` and VS Code has extensions contributing those languages with extensions `[".ts", ".tsx"]` and `[".py"]`
- **THEN** the generated `extensionToLanguage` includes `{ ".ts": "typescript", ".tsx": "typescript", ".py": "python" }`

### Requirement: Handle duplicate file extensions by setting order

When multiple selected languages register the same file extension, the language appearing first in the `lspBridge.languages` array SHALL win.

#### Scenario: Duplicate extension registered by selected languages

- **WHEN** `lspBridge.languages` is `["typescript", "typescriptreact"]` and both claim `".tsx"`
- **THEN** the mapping for `".tsx"` uses `"typescript"` (appears first in the array)

### Requirement: Only include dot-prefixed extensions

The mapping SHALL only include file extensions that start with a dot. Bare filenames (e.g., `"Dockerfile"`) are excluded.

#### Scenario: Non-dot extension is excluded

- **WHEN** a language contributes `{ "id": "dockerfile", "extensions": ["Dockerfile", ".dockerfile"] }`
- **THEN** the mapping includes `".dockerfile"` but not `"Dockerfile"`

### Requirement: Unresolvable language IDs are excluded

If a language ID in the setting does not match any installed extension, it SHALL be silently excluded from the mapping but remain in the setting.

#### Scenario: Language ID has no matching extension

- **WHEN** `lspBridge.languages` contains `"terraform"` but no extension contributes that language
- **THEN** no entries for `"terraform"` appear in the mapping

### Requirement: Auto-regeneration on setting change

The extension SHALL regenerate `.lsp.json` when `lspBridge.languages` changes while the server is running.

#### Scenario: User changes languages while server is running

- **WHEN** the server is running and the user adds `"go"` to `lspBridge.languages`
- **THEN** `.lsp.json` is regenerated to include Go file extensions
