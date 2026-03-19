import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "bun";
import { unlinkSync, realpathSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { createServer, type Server, type Socket as NetSocket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { frameLsp, makeInitialize, makeRequest, makeNotify, parseLspOutput } from "./helpers";

const PROXY_PATH = join(import.meta.dir, "..", "out", "bundle", "proxy.cjs");

// The proxy computes the socket path from process.cwd() which resolves symlinks on macOS.
// We must hash the resolved path to match what the proxy will compute.
function socketPathForCwd(cwd: string): string {
  const resolved = realpathSync(cwd);
  const hash = createHash("sha256").update(resolved).digest("hex").slice(0, 8);
  return join(tmpdir(), `vscode-lsp-bridge-${hash}.sock`);
}

// A minimal echo server that responds to JSON-RPC over newline-delimited UDS
function createEchoServer(sockPath: string, handler: (msg: any) => any): Promise<Server> {
  return new Promise((resolve, reject) => {
    try {
      unlinkSync(sockPath);
    } catch {}

    const server = createServer((socket: NetSocket) => {
      socket.setEncoding("utf8");
      let buffer = "";

      socket.on("data", (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.length > 0) {
            const msg = JSON.parse(line);
            const response = handler(msg);
            if (response) {
              socket.write(JSON.stringify(response) + "\n");
            }
          }
        }
      });
    });

    server.on("error", reject);
    server.listen(sockPath, () => {
      chmodSync(sockPath, 0o600);
      resolve(server);
    });
  });
}

function spawnProxy(cwd: string) {
  return spawn({
    cmd: ["node", PROXY_PATH],
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });
}

function makeInitResult() {
  return {
    jsonrpc: "2.0" as const,
    id: 1,
    result: {
      capabilities: { textDocumentSync: 1 },
      serverInfo: { name: "echo", version: "0.0.1" }
    }
  };
}

describe("Proxy Round-Trip", () => {
  // Use a unique temp dir as the "workspace" so socket path is predictable
  let workDir: string;
  let sockPath: string;
  let echoServer: Server | null = null;

  beforeEach(() => {
    workDir = join(
      tmpdir(),
      `lsp-bridge-proxy-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    mkdirSync(workDir, { recursive: true });
    sockPath = socketPathForCwd(workDir);
  });

  afterEach(() => {
    echoServer?.close();
    echoServer = null;
    try {
      unlinkSync(sockPath);
    } catch {}
    try {
      rmSync(workDir, { recursive: true });
    } catch {}
  });

  test("forwards single message from stdin to UDS", async () => {
    const received: any[] = [];
    echoServer = await createEchoServer(sockPath, msg => {
      received.push(msg);
      if (msg.method === "initialize") return makeInitResult();
      return null;
    });

    const proc = spawnProxy(workDir);
    const initMsg = makeInitialize();
    proc.stdin!.write(frameLsp(initMsg));
    proc.stdin!.flush();

    // Wait for the echo server to receive the message
    await new Promise(r => setTimeout(r, 200));

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].method).toBe("initialize");

    proc.stdin!.end();
    await proc.exited;
  });

  test("forwards multiple sequential messages from stdin to UDS", async () => {
    const received: any[] = [];
    echoServer = await createEchoServer(sockPath, msg => {
      received.push(msg);
      if (msg.method === "initialize") return makeInitResult();
      if (msg.method === "shutdown") return { jsonrpc: "2.0", id: msg.id, result: null };
      return null;
    });

    const proc = spawnProxy(workDir);
    proc.stdin!.write(frameLsp(makeInitialize()));
    proc.stdin!.write(frameLsp(makeNotify("initialized")));
    proc.stdin!.write(frameLsp(makeRequest(2, "shutdown")));
    proc.stdin!.flush();

    await new Promise(r => setTimeout(r, 300));

    expect(received.length).toBeGreaterThanOrEqual(3);
    expect(received[0].method).toBe("initialize");
    expect(received[1].method).toBe("initialized");
    expect(received[2].method).toBe("shutdown");

    proc.stdin!.end();
    await proc.exited;
  });

  test("response on stdout has correct Content-Length framing", async () => {
    echoServer = await createEchoServer(sockPath, msg => {
      if (msg.method === "initialize") return makeInitResult();
      return null;
    });

    const proc = spawnProxy(workDir);
    proc.stdin!.write(frameLsp(makeInitialize()));
    proc.stdin!.flush();

    const reader = proc.stdout!.getReader();

    const readWithTimeout = async (ms: number): Promise<Buffer> => {
      const timeout = new Promise<null>(r => setTimeout(() => r(null), ms));
      const read = reader.read().then(({ value }: { value?: Uint8Array }) => value ?? null);
      const result = await Promise.race([read, timeout]);
      return result ? Buffer.from(result) : Buffer.alloc(0);
    };

    const data = await readWithTimeout(500);
    reader.releaseLock();

    const messages = parseLspOutput(data);
    expect(messages.length).toBeGreaterThanOrEqual(1);

    const parsed = JSON.parse(messages[0]);
    expect(parsed.id).toBe(1);
    expect(parsed.result.capabilities).toBeDefined();

    // Verify Content-Length matches actual byte length
    const headerMatch = data.toString().match(/Content-Length:\s*(\d+)/);
    expect(headerMatch).toBeTruthy();
    const declaredLength = parseInt(headerMatch![1], 10);
    expect(declaredLength).toBe(Buffer.byteLength(messages[0], "utf8"));

    proc.stdin!.end();
    await proc.exited;
  });

  test("full initialize/shutdown lifecycle through proxy", async () => {
    echoServer = await createEchoServer(sockPath, msg => {
      if (msg.method === "initialize") return makeInitResult();
      if (msg.method === "shutdown") return { jsonrpc: "2.0", id: msg.id, result: null };
      return null;
    });

    const proc = spawnProxy(workDir);

    proc.stdin!.write(frameLsp(makeInitialize()));
    proc.stdin!.write(frameLsp(makeNotify("initialized")));
    proc.stdin!.write(frameLsp(makeRequest(2, "shutdown")));
    proc.stdin!.write(frameLsp(makeNotify("exit")));
    proc.stdin!.flush();

    await new Promise(r => setTimeout(r, 300));

    const reader = proc.stdout!.getReader();
    const data = await reader
      .read()
      .then(({ value }: { value?: Uint8Array }) => (value ? Buffer.from(value) : Buffer.alloc(0)));
    reader.releaseLock();

    const messages = parseLspOutput(data);
    // Should have at least initialize response and shutdown response
    expect(messages.length).toBeGreaterThanOrEqual(2);

    const initRes = JSON.parse(messages[0]);
    expect(initRes.result.serverInfo.name).toBe("echo");

    const shutdownRes = JSON.parse(messages[1]);
    expect(shutdownRes.result).toBeNull();

    proc.stdin!.end();
    await proc.exited;
  });

  test("exits with code 0 on stdin close", async () => {
    echoServer = await createEchoServer(sockPath, () => null);

    const proc = spawnProxy(workDir);

    // Wait for connection to establish
    await new Promise(r => setTimeout(r, 100));

    proc.stdin!.end();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
  });

  test("exits with non-zero code when no server is listening", async () => {
    // No echo server started — socket doesn't exist
    const proc = spawnProxy(workDir);

    const exitCode = await proc.exited;
    expect(exitCode).not.toBe(0);

    // Check stderr for error message
    const stderr = await new Response(proc.stderr!).text();
    expect(stderr).toContain("Failed to connect");
  });
});
