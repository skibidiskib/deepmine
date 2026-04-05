export const dynamic = 'force-dynamic';

import { sseEmitter } from '@/lib/db';

export async function GET() {
  const encoder = new TextEncoder();

  let heartbeatInterval: ReturnType<typeof setInterval>;
  let clientFn: ((event: string, data: string) => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      controller.enqueue(
        encoder.encode(
          `event: connected\ndata: ${JSON.stringify({ status: 'connected', timestamp: new Date().toISOString() })}\n\n`
        )
      );

      // Register SSE client
      clientFn = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // Stream closed
          cleanup();
        }
      };

      sseEmitter.addClient(clientFn);

      // 30-second heartbeat
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(
              `event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`
            )
          );
        } catch {
          cleanup();
        }
      }, 30_000);

      function cleanup() {
        clearInterval(heartbeatInterval);
        if (clientFn) {
          sseEmitter.removeClient(clientFn);
          clientFn = null;
        }
      }
    },

    cancel() {
      // Called when the client disconnects
      clearInterval(heartbeatInterval);
      if (clientFn) {
        sseEmitter.removeClient(clientFn);
        clientFn = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
