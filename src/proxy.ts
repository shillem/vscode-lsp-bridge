import { connect } from "node:net";
import { socketPath } from "./socket-path";

// Compute socket path from cwd
const sockPath = socketPath(process.cwd());

const socket = connect(sockPath);

socket.setEncoding("utf8");

socket.on("connect", () => {
  // Parse Content-Length framed messages from stdin
  let stdinBuf = Buffer.alloc(0);

  process.stdin.on("data", (chunk: Buffer) => {
    stdinBuf = Buffer.concat([stdinBuf, chunk]);
    drainStdin();
  });

  function drainStdin() {
    while (true) {
      const headerEnd = stdinBuf.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = stdinBuf.subarray(0, headerEnd).toString("ascii");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        process.stderr.write("Invalid LSP header on stdin\n");
        process.exit(1);
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const messageEnd = bodyStart + contentLength;

      if (stdinBuf.length < messageEnd) break;

      const body = stdinBuf.subarray(bodyStart, messageEnd).toString("utf8");
      stdinBuf = stdinBuf.subarray(messageEnd);

      // Forward raw JSON to UDS (newline-delimited)
      socket.write(body + "\n");
    }
  }

  // Read newline-delimited JSON from UDS, wrap with Content-Length for stdout
  let socketBuf = "";

  socket.on("data", (chunk: string) => {
    socketBuf += chunk;
    drainSocket();
  });

  function drainSocket() {
    let newlineIdx: number;
    while ((newlineIdx = socketBuf.indexOf("\n")) !== -1) {
      const line = socketBuf.slice(0, newlineIdx);
      socketBuf = socketBuf.slice(newlineIdx + 1);
      if (line.length > 0) {
        const bytes = Buffer.byteLength(line, "utf8");
        process.stdout.write(`Content-Length: ${bytes}\r\n\r\n${line}`);
      }
    }
  }
});

socket.on("error", err => {
  process.stderr.write(`Failed to connect to LSP bridge socket at ${sockPath}: ${err.message}\n`);
  process.exit(1);
});

socket.on("close", () => {
  process.stderr.write("LSP bridge socket closed unexpectedly\n");
  process.exit(1);
});

process.stdin.on("end", () => {
  socket.end();
  process.exit(0);
});
