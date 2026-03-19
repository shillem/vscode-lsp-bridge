import * as vscode from "vscode";
import { join } from "node:path";
import { BridgeServer } from "./server";
import { writePluginDirectory, writeLspJson, pluginDirectoryExists } from "./plugin";
import { discoverLanguages, buildExtensionToLanguageMap } from "./languages";
import { EXTENSION_NAME } from "./constants";

const MSG_PREFIX = "LSP Bridge:";

let server: BridgeServer | null = null;
let extensionVersion: string;

export function activate(context: vscode.ExtensionContext) {
  extensionVersion = context.extension.packageJSON.version;

  context.subscriptions.push(
    vscode.commands.registerCommand("lspBridge.start", startServer),
    vscode.commands.registerCommand("lspBridge.stop", stopServer),
    vscode.commands.registerCommand(
      "lspBridge.selectLanguages",
      selectLanguages.bind(null, context)
    ),
    vscode.commands.registerCommand(
      "lspBridge.generateClaudePlugin",
      generateClaudePlugin.bind(null, context)
    ),
    vscode.extensions.onDidChange(() => regenerateIfRunning()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration("lspBridge.languages")) {
        regenerateIfRunning();
      }
    })
  );

  const config = vscode.workspace.getConfiguration("lspBridge");
  if (config.get<boolean>("autoStart")) {
    startServer();
  }
}

export function deactivate() {
  server?.stop();
  server = null;
}

async function generateClaudePlugin(context: vscode.ExtensionContext) {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showWarningMessage(`${MSG_PREFIX} no workspace folder open`);
    return;
  }

  const languages = getSelectedLanguages();
  if (languages.length === 0) {
    const action = await vscode.window.showWarningMessage(
      `${MSG_PREFIX} no languages configured.`,
      "Select Languages"
    );
    if (action === "Select Languages") {
      await vscode.commands.executeCommand("lspBridge.selectLanguages");
    }
    return;
  }

  const extToLang = buildExtensionToLanguageMap(languages);
  const proxyJsPath = join(context.extensionPath, "out", "bundle", "proxy.cjs");
  writePluginDirectory(workspaceFolder.uri.fsPath, extToLang, proxyJsPath, extensionVersion);

  vscode.window.showInformationMessage(`${MSG_PREFIX} Claude plugin generated successfully`);
}

function getSelectedLanguages(): string[] {
  return vscode.workspace.getConfiguration("lspBridge").get<string[]>("languages") ?? [];
}

async function resolveConfigTarget(): Promise<vscode.ConfigurationTarget | undefined> {
  const inspection = vscode.workspace.getConfiguration("lspBridge").inspect<string[]>("languages");
  const hasGlobal = inspection?.globalValue !== undefined;
  const hasWorkspace = inspection?.workspaceValue !== undefined;

  if (hasWorkspace || (hasGlobal && hasWorkspace)) return vscode.ConfigurationTarget.Workspace;
  if (hasGlobal) return vscode.ConfigurationTarget.Global;

  const choice = await vscode.window.showQuickPick(
    [
      { label: "Workspace", target: vscode.ConfigurationTarget.Workspace },
      { label: "Global", target: vscode.ConfigurationTarget.Global }
    ],
    { title: `${MSG_PREFIX} Where should language settings be stored?` }
  );

  return choice?.target;
}

async function selectLanguages(context: vscode.ExtensionContext) {
  const discovered = discoverLanguages();
  const selected = new Set(getSelectedLanguages());

  const items: vscode.QuickPickItem[] = discovered.map(lang => ({
    label: lang.id,
    description: lang.extensions.join(", "),
    picked: selected.has(lang.id)
  }));

  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `${MSG_PREFIX} Select Languages`,
    placeHolder: "Select languages to expose through the bridge"
  });

  if (!picked) return;

  const target = await resolveConfigTarget();

  if (!target) return;

  const languageIds = picked.map(item => item.label);

  await vscode.workspace.getConfiguration("lspBridge").update("languages", languageIds, target);

  if (
    languageIds.length > 0 &&
    (languageIds.length !== selected.size || languageIds.some(id => !selected.has(id)))
  ) {
    const action = await vscode.window.showInformationMessage(
      `${MSG_PREFIX} languages updated. Regenerate Claude plugin?`,
      "Generate Plugin"
    );

    if (action === "Generate Plugin") {
      await generateClaudePlugin(context);
    }
  }
}

function regenerateIfRunning() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder && server?.isRunning() && pluginDirectoryExists(workspaceFolder.uri.fsPath)) {
    const extToLang = buildExtensionToLanguageMap(getSelectedLanguages());
    writeLspJson(workspaceFolder.uri.fsPath, extToLang);
  }
}

async function startServer() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    vscode.window.showWarningMessage(`${MSG_PREFIX} no workspace folder open`);
    return;
  }

  const languages = getSelectedLanguages();

  if (languages.length === 0) {
    const action = await vscode.window.showWarningMessage(
      `${MSG_PREFIX} no languages configured.`,
      "Select Languages"
    );
    if (action === "Select Languages") {
      await vscode.commands.executeCommand("lspBridge.selectLanguages");
    }
    return;
  }

  if (server?.isRunning()) {
    vscode.window.showInformationMessage(`${MSG_PREFIX} server is already running`);
    return;
  }

  server = new BridgeServer({ name: EXTENSION_NAME, version: extensionVersion });

  try {
    await server.start(workspaceFolder.uri.fsPath);
    vscode.window.showInformationMessage(`${MSG_PREFIX} server started`);
  } catch (err: any) {
    vscode.window.showErrorMessage(
      `${MSG_PREFIX} server failed to start with error '${err.message}'`
    );
    server = null;
  }
}

function stopServer() {
  if (!server?.isRunning()) {
    vscode.window.showInformationMessage(`${MSG_PREFIX} server is not running`);
    return;
  }

  server.stop();
  server = null;
  vscode.window.showInformationMessage(`${MSG_PREFIX} server stopped`);
}
