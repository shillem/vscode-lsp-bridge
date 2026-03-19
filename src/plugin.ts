import { mkdirSync, rmSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { EXTENSION_NAME } from "./constants";

const PLUGIN_DIR_NAME = `.claude/plugins/${EXTENSION_NAME}`;

export function writePluginDirectory(
  workspaceFolderPath: string,
  extensionToLanguage: Record<string, string>,
  proxyJsPath: string,
  version: string
): string {
  const pluginDir = join(workspaceFolderPath, PLUGIN_DIR_NAME);
  const claudePluginDir = join(pluginDir, ".claude-plugin");

  rmSync(pluginDir, { recursive: true, force: true });
  mkdirSync(claudePluginDir, { recursive: true });

  writeFileSync(
    join(claudePluginDir, "plugin.json"),
    JSON.stringify(
      {
        name: EXTENSION_NAME,
        description: "VS Code LSP bridge for enhanced code intelligence",
        owner: {
          name: "VS Code LSP Bridge"
        },
        version,
        category: "development"
      },
      null,
      2
    )
  );

  writeLspJson(workspaceFolderPath, extensionToLanguage);

  copyFileSync(proxyJsPath, join(pluginDir, "proxy.cjs"));

  return pluginDir;
}

export function pluginDirectoryExists(workspaceFolderPath: string): boolean {
  return existsSync(join(workspaceFolderPath, PLUGIN_DIR_NAME));
}

export function writeLspJson(
  workspaceFolderPath: string,
  extensionToLanguage: Record<string, string>
): void {
  const pluginDir = join(workspaceFolderPath, PLUGIN_DIR_NAME);

  const lspConfig = {
    vscode: {
      command: "node",
      args: [join(PLUGIN_DIR_NAME, "proxy.cjs")],
      extensionToLanguage,
      transport: "socket"
    }
  };

  writeFileSync(join(pluginDir, ".lsp.json"), JSON.stringify(lspConfig, null, 2));
}
