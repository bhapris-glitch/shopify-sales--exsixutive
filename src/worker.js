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
      const supabaseUrl = String(env.SUPABASE_URL || "").trim();
      const supabaseKey = String(env.SUPABASE_ANON_KEY || "").trim();
      if (!supabaseUrl || supabaseUrl.includes("YOUR_PROJECT_REF") || !supabaseKey) {
        return json({ error: "The Supabase API is not configured.", code: "SUPABASE_NOT_CONFIGURED" }, 503);
      }

      const functionUrl = new URL(
        `/functions/v1/api${url.pathname.slice("/api".length)}${url.search}`,
        supabaseUrl,
      );
      const headers = new Headers(request.headers);
      headers.set("apikey", supabaseKey);
      headers.set("authorization", `Bearer ${supabaseKey}`);

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
