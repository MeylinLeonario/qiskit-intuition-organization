// Only these backend operations are exposed; the upstream URL stays server-side.
const paths = new Set([
  "health",
  "execute",
  "simulate",
  "export",
  "agent/tutor",
  "course",
  "course/exercise",
  "course/reflect",
  "course/routing",
]);
export const runtime = "nodejs";

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const route = path.join("/");
  if (!paths.has(route))
    return Response.json({ detail: "Not found" }, { status: 404 });
  const readOnly = route === "health" || route === "course";
  if (request.method !== (readOnly ? "GET" : "POST")) {
    return Response.json({ detail: "Method not allowed" }, { status: 405 });
  }
  const body = request.method === "POST" ? await request.text() : undefined;
  if (body && new TextEncoder().encode(body).length > 100000) {
    return Response.json({ detail: "Request too large" }, { status: 413 });
  }
  try {
    const base = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(
      /\/$/,
      "",
    );
    const upstream = await fetch(`${base}/${route}`, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      {
        detail: "The Qiskit service is unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  }
}

export { proxy as GET, proxy as POST };
