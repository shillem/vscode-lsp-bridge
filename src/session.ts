import * as vscode from "vscode";
import type { Transport } from "./transport/types";
import {
  type JsonRpcMessage,
  ErrorCodes,
  isRequest,
  isNotification,
  makeResponse,
  makeError,
  makeNotification
} from "./protocol";
import { getHandler, getCapabilities, serializeDiagnostic } from "./handlers";

export interface ServerInfo {
  name: string;
  version: string;
}

type SessionState = "uninitialized" | "initializing" | "ready" | "shuttingDown";

interface OpenDocument {
  uri: string;
  languageId: string;
  version: number;
}

export class Session {
  private state: SessionState = "uninitialized";
  private openDocuments = new Map<string, OpenDocument>();
  private diagnosticSub: vscode.Disposable | null = null;
  private disposed = false;

  constructor(
    private transport: Transport,
    private serverInfo: ServerInfo
  ) {
    transport.onMessage(data => this.handleRaw(data));
    transport.onClose(() => this.dispose());
    transport.onError(() => this.dispose());
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.diagnosticSub?.dispose();
    this.diagnosticSub = null;
    this.openDocuments.clear();
    this.transport.close();
  }

  private handleDidChange(params: {
    textDocument: { uri: string; version: number };
    contentChanges: Array<{ text: string }>;
  }) {
    const { uri, version } = params.textDocument;
    const doc = this.openDocuments.get(uri);
    if (doc) {
      doc.version = version;
    }
  }

  private handleDidClose(params: { textDocument: { uri: string } }) {
    this.openDocuments.delete(params.textDocument.uri);
  }

  private async handleDidOpen(params: {
    textDocument: {
      uri: string;
      languageId: string;
      version: number;
      text: string;
    };
  }) {
    const { uri, languageId, version } = params.textDocument;
    this.openDocuments.set(uri, { uri, languageId, version });

    try {
      await vscode.workspace.openTextDocument(vscode.Uri.parse(uri));
    } catch {
      // File may not exist or be inaccessible
    }

    const diags = vscode.languages.getDiagnostics(vscode.Uri.parse(uri));

    if (diags.length > 0) {
      this.send(
        makeNotification("textDocument/publishDiagnostics", {
          uri,
          diagnostics: diags.map(serializeDiagnostic)
        })
      );
    }
  }

  private handleNotification(method: string, params: unknown) {
    switch (method) {
      case "initialized":
        if (this.state === "initializing") {
          this.state = "ready";
          this.startDiagnosticsListener();
        }
        break;

      case "exit":
        this.dispose();
        break;

      case "textDocument/didOpen":
        this.handleDidOpen(params as any);
        break;

      case "textDocument/didChange":
        this.handleDidChange(params as any);
        break;

      case "textDocument/didClose":
        this.handleDidClose(params as any);
        break;
    }
  }

  private handleRaw(raw: string) {
    let msg: JsonRpcMessage;

    try {
      msg = JSON.parse(raw);
    } catch {
      this.send(makeError(null, ErrorCodes.ParseError, "Invalid JSON"));
      return;
    }

    if (isRequest(msg)) {
      this.handleRequest(msg.id, msg.method, msg.params);
    } else if (isNotification(msg)) {
      this.handleNotification(msg.method, msg.params);
    }
  }

  private async handleRequest(id: number | string, method: string, params: unknown) {
    if (method === "initialize") {
      if (this.state !== "uninitialized") {
        this.send(makeError(id, ErrorCodes.InvalidRequest, "Already initialized"));
        return;
      }
      this.state = "initializing";
      this.send(
        makeResponse(id, {
          capabilities: {
            textDocumentSync: 1,
            ...getCapabilities()
          },
          serverInfo: this.serverInfo
        })
      );
      return;
    }

    if (method === "shutdown") {
      if (this.state !== "ready" && this.state !== "initializing") {
        this.send(makeError(id, ErrorCodes.InvalidRequest, "Not initialized"));
        return;
      }
      this.state = "shuttingDown";
      this.send(makeResponse(id, null));
      return;
    }

    // All other requests require ready state
    if (this.state !== "ready") {
      this.send(makeError(id, ErrorCodes.ServerNotInitialized, "Server not initialized"));
      return;
    }

    const handler = getHandler(method);
    if (!handler) {
      this.send(makeError(id, ErrorCodes.MethodNotFound, `Unknown method: ${method}`));
      return;
    }

    try {
      const result = await handler(params);
      this.send(makeResponse(id, result));
    } catch (err: any) {
      this.send(makeError(id, ErrorCodes.InternalError, err.message ?? String(err)));
    }
  }

  private send(msg: object) {
    if (!this.disposed) {
      this.transport.send(JSON.stringify(msg));
    }
  }

  private startDiagnosticsListener() {
    this.diagnosticSub = vscode.languages.onDidChangeDiagnostics(e => {
      for (const changedUri of e.uris) {
        const uriStr = changedUri.toString();

        if (!this.openDocuments.has(uriStr)) continue;

        const diags = vscode.languages.getDiagnostics(changedUri);
        this.send(
          makeNotification("textDocument/publishDiagnostics", {
            uri: uriStr,
            diagnostics: diags.map(serializeDiagnostic)
          })
        );
      }
    });
  }
}
