import * as vscode from "vscode";

export interface LanguageInfo {
  id: string;
  extensions: string[];
}

export function discoverLanguages(): LanguageInfo[] {
  const map = new Map<string, Set<string>>();

  for (const ext of vscode.extensions.all) {
    const languages = ext.packageJSON?.contributes?.languages;
    if (!Array.isArray(languages)) continue;

    for (const lang of languages) {
      const id = lang?.id;
      const extensions = lang?.extensions;
      if (typeof id !== "string" || !Array.isArray(extensions)) continue;

      let fileExts = map.get(id);
      if (!fileExts) {
        fileExts = new Set();
        map.set(id, fileExts);
      }

      for (const fileExt of extensions) {
        if (typeof fileExt === "string") {
          fileExts.add(fileExt);
        }
      }
    }
  }

  return Array.from(map.entries())
    .map(([id, exts]) => ({ id, extensions: Array.from(exts).sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function buildExtensionToLanguageMap(selectedLanguages: string[]): Record<string, string> {
  const allLanguages = discoverLanguages();
  const available = new Map(allLanguages.map(l => [l.id, l.extensions]));
  const result: Record<string, string> = {};

  for (const langId of selectedLanguages) {
    const extensions = available.get(langId);
    if (!extensions) continue;

    for (const fileExt of extensions) {
      if (fileExt.startsWith(".") && !(fileExt in result)) {
        result[fileExt] = langId;
      }
    }
  }

  return result;
}
