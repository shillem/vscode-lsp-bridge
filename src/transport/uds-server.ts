import { createServer, type Server } from "node:net";
import { chmodSync, unlinkSync } from "node:fs";
import { UdsTransport } from "./uds";

export class UdsTransportServer {
  private server: Server | null = null;
  private connectionCallback: ((transport: UdsTransport) => void) | null = null;

  onConnection(callback: (transport: UdsTransport) => void): void {
    this.connectionCallback = callback;
  }

  listen(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Unlink stale socket if it exists
      try {
        unlinkSync(socketPath);
      } catch {
        // Ignore — file may not exist
      }

      this.server = createServer(socket => {
        const transport = new UdsTransport(socket);
        this.connectionCallback?.(transport);
      });

      this.server.on("error", reject);
      this.server.listen(socketPath, () => {
        chmodSync(socketPath, 0o600);
        resolve();
      });
    });
  }

  close(): void {
    this.server?.close();
    this.server = null;
  }

  get path(): string | null {
    const addr = this.server?.address();
    return typeof addr === "string" ? addr : null;
  }
}
