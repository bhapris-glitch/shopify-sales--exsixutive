const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

Deno.serve((request) => {
  const url = new URL(request.url);
  const route = url.pathname.split("/functions/v1/api")[1] || "/";

  if (request.method === "GET" && route === "/health") {
    return json({ ok: true, service: "zavoka-api", backend: "supabase-edge-functions" });
  }

  if (request.method === "GET" && route === "/plans") {
    return json({
      starter: { name: "Starter", price: 25, chatLimit: 500 },
      growth: { name: "Growth", price: 59, chatLimit: 1200 },
      premium: { name: "Premium", price: 149, chatLimit: 2300 },
    });
  }

  return json({ error: "This API route has not yet been migrated to Supabase." }, 501);
});
