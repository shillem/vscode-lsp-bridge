export interface Transport {
  onMessage(callback: (data: string) => void): void;
  onClose(callback: () => void): void;
  onError(callback: (err: Error) => void): void;
  send(data: string): void;
  close(): void;
}
