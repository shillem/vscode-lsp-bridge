import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { unlinkSync } from "node:fs";
import { UdsTransportServer } from "../src/transport/uds-server";
import {
  uniqueSocketPath,
  connectUds,
  sendAndReceive,
  makeInitialize,
  makeRequest,
  makeNotify,
  readResponse,
  initializeSession
} from "./helpers";

mock.module("vscode", () => ({
  languages: {
    getDiagnostics: () => [],
    onDidChangeDiagnostics: () => ({ dispose: () => {} })
  },
  workspace: {
    openTextDocument: () => Promise.resolve()
  },
  Uri: {
    parse: (s: string) => ({ toString: () => s })
  }
}));

const STUB_CAPABILITIES = { completionProvider: {}, hoverProvider: true };
const STUB_HANDLER_RESULT = { items: [] };

mock.module("../src/handlers", () => ({
  getCapabilities: () => STUB_CAPABILITIES,
  getHandler: (method: string) => {
    if (method === "textDocument/completion") {
      return async (params: unknown) => STUB_HANDLER_RESULT;
    }
    if (method === "textDocument/error") {
      return async () => {
        throw new Error("handler failed");
      };
    }
    return undefined;
  },
  serializeDiagnostic: (d: any) => d
}));

const { Session } = await import("../src/session");

const SERVER_INFO = { name: "test-server", version: "0.0.1" };

describe("Session Integration", () => {
  let server: UdsTransportServer;
  let sockPath: string;

  beforeEach(async () => {
    sockPath = uniqueSocketPath("session");
    server = new UdsTransportServer();
    server.onConnection(transport => {
      new Session(transport, SERVER_INFO);
    });
    await server.listen(sockPath);
  });

  afterEach(() => {
    server.close();
    try {
      unlinkSync(sockPath);
    } catch {}
  });

  describe("initialization handshake", () => {
    test("initialize returns capabilities and serverInfo", async () => {
      const socket = await connectUds(sockPath);
      const res = await sendAndReceive(socket, makeInitialize());

      expect(res.jsonrpc).toBe("2.0");
      expect(res.id).toBe(1);
      expect(res.result.capabilities.textDocumentSync).toBe(1);
      expect(res.result.capabilities.completionProvider).toEqual({});
      expect(res.result.capabilities.hoverProvider).toBe(true);
      expect(res.result.serverInfo).toEqual(SERVER_INFO);

      socket.destroy();
    });
  });

  describe("state enforcement", () => {
    test("double initialize rejected", async () => {
      const socket = await connectUds(sockPath);
      await sendAndReceive(socket, makeInitialize());
      const res = await sendAndReceive(socket, makeInitialize(2));

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32600);

      socket.destroy();
    });

    test("request before initialize rejected", async () => {
      const socket = await connectUds(sockPath);
      const res = await sendAndReceive(socket, makeRequest(1, "textDocument/completion", {}));

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32002);

      socket.destroy();
    });

    test("request after shutdown rejected", async () => {
      const socket = await connectUds(sockPath);
      await initializeSession(socket);

      await sendAndReceive(socket, makeRequest(2, "shutdown"));
      const res = await sendAndReceive(socket, makeRequest(3, "textDocument/completion", {}));

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32002);

      socket.destroy();
    });
  });

  describe("shutdown flow", () => {
    test("shutdown then exit lifecycle", async () => {
      const socket = await connectUds(sockPath);
      await initializeSession(socket);

      const shutdownRes = await sendAndReceive(socket, makeRequest(2, "shutdown"));
      expect(shutdownRes.result).toBeNull();

      const closed = new Promise<void>(resolve => {
        socket.once("close", () => resolve());
      });
      socket.write(makeNotify("exit") + "\n");
      await closed;
    });

    test("shutdown before initialize rejected", async () => {
      const socket = await connectUds(sockPath);
      const res = await sendAndReceive(socket, makeRequest(1, "shutdown"));

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32600);

      socket.destroy();
    });
  });

  describe("method dispatch", () => {
    test("known method returns handler result", async () => {
      const socket = await connectUds(sockPath);
      await initializeSession(socket);

      const res = await sendAndReceive(
        socket,
        makeRequest(2, "textDocument/completion", {
          textDocument: { uri: "file:///test.ts" },
          position: { line: 0, character: 0 }
        })
      );

      expect(res.result).toEqual(STUB_HANDLER_RESULT);

      socket.destroy();
    });

    test("unknown method returns MethodNotFound", async () => {
      const socket = await connectUds(sockPath);
      await initializeSession(socket);

      const res = await sendAndReceive(socket, makeRequest(2, "textDocument/unknown", {}));

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32601);

      socket.destroy();
    });

    test("handler error returns InternalError", async () => {
      const socket = await connectUds(sockPath);
      await initializeSession(socket);

      const res = await sendAndReceive(socket, makeRequest(2, "textDocument/error", {}));

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32603);
      expect(res.error.message).toBe("handler failed");

      socket.destroy();
    });
  });

  describe("JSON parse error", () => {
    test("malformed JSON returns ParseError", async () => {
      const socket = await connectUds(sockPath);
      const res = await sendAndReceive(socket, "not valid json {{{");

      expect(res.error).toBeDefined();
      expect(res.error.code).toBe(-32700);

      socket.destroy();
    });
  });

  describe("notification routing", () => {
    test("initialized transitions to ready state", async () => {
      const socket = await connectUds(sockPath);
      await initializeSession(socket);

      // Verify ready state by making a successful request
      const res = await sendAndReceive(
        socket,
        makeRequest(2, "textDocument/completion", {
          textDocument: { uri: "file:///test.ts" },
          position: { line: 0, character: 0 }
        })
      );
      expect(res.result).toBeDefined();
      expect(res.error).toBeUndefined();

      socket.destroy();
    });

    test("exit notification disposes session", async () => {
      const socket = await connectUds(sockPath);
      await initializeSession(socket);

      const closed = new Promise<void>(resolve => {
        socket.once("close", () => resolve());
      });

      socket.write(makeNotify("exit") + "\n");
      await closed;
    });
  });

  describe("concurrent sessions", () => {
    test("two clients operate independently", async () => {
      const socket1 = await connectUds(sockPath);
      const socket2 = await connectUds(sockPath);

      const res1 = await sendAndReceive(socket1, makeInitialize(1));
      const res2 = await sendAndReceive(socket2, makeInitialize(1));

      expect(res1.result.serverInfo).toEqual(SERVER_INFO);
      expect(res2.result.serverInfo).toEqual(SERVER_INFO);

      // Each session has independent state — initialize one, the other remains uninitialized
      socket1.write(makeNotify("initialized") + "\n");
      await new Promise(r => setTimeout(r, 10));

      const req1 = await sendAndReceive(
        socket1,
        makeRequest(2, "textDocument/completion", {
          textDocument: { uri: "file:///test.ts" },
          position: { line: 0, character: 0 }
        })
      );
      expect(req1.result).toBeDefined();

      // socket2 hasn't sent initialized yet — but it has sent initialize,
      // so it's in "initializing" state. Requests should fail with ServerNotInitialized.
      const req2 = await sendAndReceive(socket2, makeRequest(2, "textDocument/completion", {}));
      expect(req2.error).toBeDefined();
      expect(req2.error.code).toBe(-32002);

      socket1.destroy();
      socket2.destroy();
    });
  });

  describe("transport close cleanup", () => {
    test("client disconnect disposes session without error", async () => {
      const socket = await connectUds(sockPath);
      await initializeSession(socket);

      // Abruptly destroy the socket
      socket.destroy();

      // Give time for cleanup
      await new Promise(r => setTimeout(r, 50));

      // Server should still accept new connections
      const socket2 = await connectUds(sockPath);
      const res = await sendAndReceive(socket2, makeInitialize());
      expect(res.result).toBeDefined();

      socket2.destroy();
    });
  });
});
