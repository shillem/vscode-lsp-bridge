import * as vscode from "vscode";

type Handler = (params: any) => Promise<unknown>;

interface HandlerRegistration {
  capability: { key: string; value: unknown };
  handle: Handler;
}

const registrations: Record<string, HandlerRegistration> = {
  "textDocument/completion": {
    capability: { key: "completionProvider", value: {} },
    handle: async params => {
      const { textDocument, position } = params;
      const list = await vscode.commands.executeCommand<vscode.CompletionList>(
        "vscode.executeCompletionItemProvider",
        toUri(textDocument.uri),
        toPosition(position)
      );
      if (!list) return { isIncomplete: false, items: [] };
      return {
        isIncomplete: list.isIncomplete,
        items: list.items.map(serializeCompletionItem)
      };
    }
  },

  "textDocument/definition": {
    capability: { key: "definitionProvider", value: true },
    handle: async params => {
      const { textDocument, position } = params;
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeDefinitionProvider",
        toUri(textDocument.uri),
        toPosition(position)
      );
      if (!locations || locations.length === 0) return null;
      return locations.map(serializeLocation);
    }
  },

  "textDocument/documentSymbol": {
    capability: { key: "documentSymbolProvider", value: true },
    handle: async params => {
      const { textDocument } = params;
      const symbols = await vscode.commands.executeCommand<
        (vscode.DocumentSymbol | vscode.SymbolInformation)[]
      >("vscode.executeDocumentSymbolProvider", toUri(textDocument.uri));
      if (!symbols) return [];
      return symbols.map(serializeSymbol);
    }
  },

  "textDocument/hover": {
    capability: { key: "hoverProvider", value: true },
    handle: async params => {
      const { textDocument, position } = params;
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        toUri(textDocument.uri),
        toPosition(position)
      );
      if (!hovers || hovers.length === 0) return null;
      return serializeHover(hovers[0]);
    }
  },

  "textDocument/implementation": {
    capability: { key: "implementationProvider", value: true },
    handle: async params => {
      const { textDocument, position } = params;
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeImplementationProvider",
        toUri(textDocument.uri),
        toPosition(position)
      );
      if (!locations || locations.length === 0) return null;
      return locations.map(serializeLocation);
    }
  },

  "textDocument/references": {
    capability: { key: "referencesProvider", value: true },
    handle: async params => {
      const { textDocument, position } = params;
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        toUri(textDocument.uri),
        toPosition(position)
      );
      if (!locations) return [];
      return locations.map(serializeLocation);
    }
  },

  "textDocument/rename": {
    capability: { key: "renameProvider", value: true },
    handle: async params => {
      const { textDocument, position, newName } = params;
      const edit = await vscode.commands.executeCommand<vscode.WorkspaceEdit>(
        "vscode.executeDocumentRenameProvider",
        toUri(textDocument.uri),
        toPosition(position),
        newName
      );
      if (!edit) return null;
      const changes: Record<string, Array<{ range: unknown; newText: string }>> = {};
      for (const [uri, edits] of edit.entries()) {
        changes[uri.toString()] = edits.map(e => ({
          range: serializeRange(e.range),
          newText: e.newText
        }));
      }
      return { changes };
    }
  },

  "workspace/symbol": {
    capability: { key: "workspaceSymbolProvider", value: true },
    handle: async params => {
      const query = params?.query ?? "";
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        query
      );
      if (!symbols) return [];
      return symbols.map(serializeSymbol);
    }
  },

  "textDocument/typeDefinition": {
    capability: { key: "typeDefinitionProvider", value: true },
    handle: async params => {
      const { textDocument, position } = params;
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeTypeDefinitionProvider",
        toUri(textDocument.uri),
        toPosition(position)
      );
      if (!locations || locations.length === 0) return null;
      return locations.map(serializeLocation);
    }
  }
};

export function getCapabilities(): Record<string, unknown> {
  const caps: Record<string, unknown> = {};
  for (const reg of Object.values(registrations)) {
    caps[reg.capability.key] = reg.capability.value;
  }
  return caps;
}

export function getHandler(method: string): Handler | undefined {
  return registrations[method]?.handle;
}

export function serializeDiagnostic(diag: vscode.Diagnostic) {
  return {
    range: serializeRange(diag.range),
    message: diag.message,
    severity: diag.severity,
    code: diag.code,
    source: diag.source
  };
}

function serializeCompletionItem(item: vscode.CompletionItem) {
  const isSnippet = item.insertText instanceof vscode.SnippetString;
  const label = typeof item.label === "string" ? item.label : item.label.label;
  const labelDetails =
    typeof item.label === "string"
      ? undefined
      : { detail: item.label.detail, description: item.label.description };
  return {
    label,
    labelDetails,
    kind: item.kind,
    detail: item.detail,
    documentation:
      item.documentation instanceof vscode.MarkdownString
        ? { kind: "markdown" as const, value: item.documentation.value }
        : item.documentation
          ? { kind: "plaintext" as const, value: item.documentation as string }
          : undefined,
    sortText: item.sortText,
    filterText: item.filterText,
    insertText: isSnippet
      ? (item.insertText as vscode.SnippetString).value
      : (item.insertText as string | undefined),
    insertTextFormat: isSnippet ? 2 : 1
  };
}

function serializeHover(hover: vscode.Hover) {
  const parts: string[] = [];
  for (const c of hover.contents) {
    if (typeof c === "string") {
      parts.push(c);
    } else if (c instanceof vscode.MarkdownString) {
      parts.push(c.value);
    } else if (typeof c === "object" && c !== null && "language" in c) {
      const { language, value } = c as { language: string; value: string };
      parts.push(`\`\`\`${language}\n${value}\n\`\`\``);
    }
  }
  return {
    contents: { kind: "markdown" as const, value: parts.join("\n\n") },
    range: hover.range ? serializeRange(hover.range) : undefined
  };
}

function serializeLocation(loc: vscode.Location) {
  return {
    uri: loc.uri.toString(),
    range: serializeRange(loc.range)
  };
}

function serializeRange(range: vscode.Range) {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character }
  };
}

function serializeSymbol(sym: vscode.DocumentSymbol | vscode.SymbolInformation): unknown {
  if (sym instanceof vscode.DocumentSymbol) {
    return {
      name: sym.name,
      detail: sym.detail,
      kind: sym.kind,
      range: serializeRange(sym.range),
      selectionRange: serializeRange(sym.selectionRange),
      children: sym.children.map(serializeSymbol)
    };
  }
  return {
    name: sym.name,
    kind: sym.kind,
    location: serializeLocation(sym.location),
    containerName: sym.containerName
  };
}

function toUri(uri: string): vscode.Uri {
  return vscode.Uri.parse(uri);
}

function toPosition(pos: { line: number; character: number }): vscode.Position {
  return new vscode.Position(pos.line, pos.character);
}
