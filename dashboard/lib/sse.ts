export type SSEClient = {
  controller: ReadableStreamDefaultController;
  id: string;
};

class SSEEmitter {
  private clients: Map<string, SSEClient> = new Map();

  addClient(id: string, controller: ReadableStreamDefaultController): void {
    this.clients.set(id, { controller, id });
  }

  removeClient(id: string): void {
    this.clients.delete(id);
  }

  emit(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(payload);

    for (const [id, client] of this.clients) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        // Client disconnected, clean up
        this.clients.delete(id);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

// Survive HMR by storing on globalThis
(globalThis as any).__sseEmitter ??= new SSEEmitter();

export function getSSEEmitter(): SSEEmitter {
  return (globalThis as any).__sseEmitter;
}
