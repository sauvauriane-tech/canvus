/**
 * Canvus app Worker
 *
 * Proxies /ai requests to the AI Worker (server-to-server, no CORS needed)
 * and falls through to static assets for everything else.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ai') {
      return fetch('https://canvus-ai.sauvauriane.workers.dev/', request);
    }

    return env.ASSETS.fetch(request);
  },
};
