import { CANVUS_TOOLS } from "./tools.js";
export { CanvusRoom } from "./room.js";

interface Env {
  MISTRAL_API_KEY: string;
  CANVUS_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    // ── POST /ai/chat — proxy prompt to Mistral ───────────────────────────────
    if (pathname === "/ai/chat") {
      const { prompt, context } = await req.json() as { prompt: string; context?: unknown };

      const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify({
          model: "mistral-large-2402",
          messages: [{ role: "user", content: prompt, context }],
          tools: CANVUS_TOOLS,
          tool_choice: "auto",
        }),
      });

      return new Response(await resp.text(), { status: resp.status });
    }

    // ── GET /ai/ws — upgrade client to WebSocket (via Durable Object) ─────────
    if (pathname === "/ai/ws") {
      const roomId = url.searchParams.get("room") ?? "default";
      return getRoom(env, roomId).fetch(new Request("https://internal/ws", req));
    }

    // ── POST /ai/apply — broadcast ops to connected Canvus clients ────────────
    if (pathname === "/ai/apply") {
      const { ops, room: roomId = "default" } = await req.json() as { ops: unknown[]; room?: string };
      return getRoom(env, roomId).fetch(
        new Request("https://internal/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ops }),
        }),
      );
    }

    return new Response("Not found", { status: 404 });
  },
};

function getRoom(env: Env, name: string): DurableObjectStub {
  return env.CANVUS_ROOM.get(env.CANVUS_ROOM.idFromName(name));
}
