### Requirement: Server lifecycle messages use temporary status bar messages

The extension SHALL display successful server lifecycle feedback ("server started", "server stopped") using `vscode.window.setStatusBarMessage` with a 3-second timeout instead of `vscode.window.showInformationMessage`.

#### Scenario: Server starts successfully

- **WHEN** the server starts without error
- **THEN** a status bar message "LSP Bridge: server started" SHALL appear and auto-dismiss after 3 seconds

#### Scenario: Server stops

- **WHEN** the user stops the server
- **THEN** a status bar message "LSP Bridge: server stopped" SHALL appear and auto-dismiss after 3 seconds

### Requirement: Redundant start/stop attempts use toast notifications

The extension SHALL display "server is already running" and "server is not running" messages using `vscode.window.showInformationMessage` to ensure the user notices that their action had no effect.

#### Scenario: Server is already running

- **WHEN** the user attempts to start the server while it is already running
- **THEN** an information toast "LSP Bridge: server is already running" SHALL appear

#### Scenario: Server is not running

- **WHEN** the user attempts to stop the server while it is not running
- **THEN** an information toast "LSP Bridge: server is not running" SHALL appear

### Requirement: Errors and actionable messages remain as toast notifications

The extension SHALL continue using `showErrorMessage` for server start failures and `showWarningMessage` for missing workspace or language configuration. The extension SHALL continue using `showInformationMessage` for plugin generation confirmation and language update prompts.

#### Scenario: Server fails to start

- **WHEN** the server fails to start
- **THEN** an error toast notification SHALL appear with the error message

#### Scenario: No workspace folder open

- **WHEN** the user triggers a command with no workspace folder open
- **THEN** a warning toast notification SHALL appear
