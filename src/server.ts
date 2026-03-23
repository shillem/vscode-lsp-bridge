import { unlinkSync } from "node:fs";
import type { Transport } from "./transport/types";
import { UdsTransportServer } from "./transport/uds-server";
import { Session, type ServerInfo } from "./session";
import { socketPath } from "./socket-path";

export class BridgeServer {
  private udsServer: UdsTransportServer | null = null;
  private sessions = new Set<Session>();
  private _socketPath: string | null = null;

  constructor(private serverInfo: ServerInfo) {}

  getSocketPath(): string | null {
    return this._socketPath;
  }

  isRunning(): boolean {
    return this.udsServer !== null;
  }

  async start(workspaceFolderPath: string): Promise<string> {
    if (this.isRunning()) {
      throw new Error("Server already running");
    }

    this._socketPath = socketPath(workspaceFolderPath);

    const wireSession = (transport: Transport) => {
      const session = new Session(transport, this.serverInfo);
      this.sessions.add(session);
      transport.onClose(() => {
        session.dispose();
        this.sessions.delete(session);
      });
    };

    this.udsServer = new UdsTransportServer();
    this.udsServer.onConnection(wireSession);
    await this.udsServer.listen(this._socketPath);

    return this._socketPath;
  }

  stop() {
    for (const session of this.sessions) {
      session.dispose();
    }
    this.sessions.clear();

    this.udsServer?.close();
    this.udsServer = null;

    // Clean up socket file
    if (this._socketPath) {
      try {
        unlinkSync(this._socketPath);
      } catch {
        // Ignore — may already be removed
      }
    }
    this._socketPath = null;
  }
}
