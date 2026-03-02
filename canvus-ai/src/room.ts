/**
 * room.ts — CanvusRoom Durable Object
 *
 * Holds the WebSocket connections for one design session ("room").
 * Receives two internal fetch requests from the Worker:
 *
 *   GET  /ws        — upgrade a client to WebSocket and track it
 *   POST /broadcast — send ops JSON to every connected client
 *
 * One room per session (keyed by ?room= query param, default "default").
 * Multiple browser tabs or collaborators can share a room.
 */
export class CanvusRoom implements DurableObject {
  private sessions = new Set<WebSocket>();

  async fetch(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url);

    // ── WebSocket upgrade ────────────────────────────────────────────────────
    if (pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      const { 0: client, 1: server } = new WebSocketPair();
      server.accept();
      this.sessions.add(server);

      server.addEventListener("close", () => this.sessions.delete(server));
      server.addEventListener("error", () => this.sessions.delete(server));

      // Echo pings to keep the connection alive through CF's 100s idle limit
      server.addEventListener("message", (ev) => {
        if (ev.data === "ping") server.send("pong");
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // ── Broadcast ops to all connected clients ────────────────────────────────
    if (pathname === "/broadcast") {
      const { ops } = await req.json() as { ops: unknown[] };
      const payload = JSON.stringify({ type: "ai:ops", ops });

      const dead: WebSocket[] = [];
      this.sessions.forEach((ws) => {
        try {
          ws.send(payload);
        } catch {
          dead.push(ws); // stale connection
        }
      });
      dead.forEach((ws) => this.sessions.delete(ws));

      return new Response(
        JSON.stringify({ broadcast: this.sessions.size }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response("Not found", { status: 404 });
  }
}
