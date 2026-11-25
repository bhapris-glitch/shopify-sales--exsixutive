function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        return json({ error: "The Supabase API is not configured." }, 503);
      }

      const functionUrl = new URL(
        `/functions/v1/api${url.pathname.slice("/api".length)}${url.search}`,
        env.SUPABASE_URL,
      );
      const headers = new Headers(request.headers);
      headers.set("apikey", env.SUPABASE_ANON_KEY);
      headers.set("authorization", `Bearer ${env.SUPABASE_ANON_KEY}`);

      return fetch(functionUrl, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });
    }

    return env.ASSETS.fetch(request);
  },
};
