import type { Socket } from "node:net";
import type { Transport } from "./types";

export class UdsTransport implements Transport {
  private messageCallback: ((data: string) => void) | null = null;
  private closeCallback: (() => void) | null = null;
  private errorCallback: ((err: Error) => void) | null = null;
  private buffer = "";

  constructor(private socket: Socket) {
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });

    socket.on("close", () => {
      this.closeCallback?.();
    });

    socket.on("error", err => {
      this.errorCallback?.(err);
    });
  }

  private drain() {
    // Messages are newline-delimited JSON
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx);
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (line.length > 0) {
        this.messageCallback?.(line);
      }
    }
  }

  onMessage(callback: (data: string) => void): void {
    this.messageCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  onError(callback: (err: Error) => void): void {
    this.errorCallback = callback;
  }

  send(data: string): void {
    this.socket.write(data + "\n");
  }

  close(): void {
    this.socket.destroy();
  }
}
