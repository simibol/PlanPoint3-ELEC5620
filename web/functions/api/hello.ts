/// <reference types="@cloudflare/workers-types" />
export const onRequestGet: PagesFunction = async () =>
  new Response(JSON.stringify({ ok: true, route: "/api/hello" }), {
    headers: { "content-type": "application/json" },
  });
