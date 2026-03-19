import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type Socket } from "node:net";

export function uniqueSocketPath(testName: string): string {
  const hash = createHash("sha256")
    .update(`${testName}-${Date.now()}-${Math.random()}`)
    .digest("hex")
    .slice(0, 12);
  return join(tmpdir(), `lsp-bridge-test-${hash}.sock`);
}

export function frameLsp(json: string): string {
  const bytes = Buffer.byteLength(json, "utf8");
  return `Content-Length: ${bytes}\r\n\r\n${json}`;
}

export function makeInitialize(id: number | string = 1) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: { capabilities: {} }
  });
}

export function makeRequest(id: number | string, method: string, params?: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

export function makeNotify(method: string, params?: unknown) {
  return JSON.stringify({ jsonrpc: "2.0", method, params });
}

export function connectUds(socketPath: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    socket.setEncoding("utf8");
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

export function readResponse(socket: Socket): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: string) => {
      buffer += chunk;
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx !== -1) {
        const line = buffer.slice(0, newlineIdx);
        socket.removeListener("data", onData);
        resolve(JSON.parse(line));
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
    setTimeout(() => {
      socket.removeListener("data", onData);
      reject(new Error("Timeout waiting for response"));
    }, 5000);
  });
}

export function sendAndReceive(socket: Socket, json: string): Promise<any> {
  socket.write(json + "\n");
  return readResponse(socket);
}

export async function initializeSession(socket: Socket): Promise<any> {
  const initResult = await sendAndReceive(socket, makeInitialize());
  socket.write(makeNotify("initialized") + "\n");
  // Small delay to allow state transition
  await new Promise(r => setTimeout(r, 10));
  return initResult;
}

export function parseLspOutput(data: Buffer): string[] {
  const messages: string[] = [];
  let buf = data;

  while (buf.length > 0) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;

    const header = buf.subarray(0, headerEnd).toString("ascii");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) break;

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const messageEnd = bodyStart + contentLength;

    if (buf.length < messageEnd) break;

    messages.push(buf.subarray(bodyStart, messageEnd).toString("utf8"));
    buf = buf.subarray(messageEnd);
  }

  return messages;
}
