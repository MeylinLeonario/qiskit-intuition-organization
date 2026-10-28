import { readApiResponse } from "@/lib/api-response";

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
    // Browser requests still go through this proxy using the deployed backend URL.
    const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
    if (!configured && process.env.VERCEL === "1") {
      return Response.json(
        {
          detail: "The quantum service is not configured for this deployment.",
        },
        { status: 503 },
      );
    }
    const base = (configured || "http://127.0.0.1:8000").replace(/\/$/, "");
    const target = new URL(base);
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.origin === new URL(request.url).origin
    ) {
      return Response.json(
        { detail: "The quantum service configuration is invalid." },
        { status: 503 },
      );
    }
    const upstream = await fetch(`${base}/${route}`, {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    });
    try {
      const data = await readApiResponse(upstream);
      return Response.json(data, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json(
        {
          detail:
            error instanceof Error
              ? error.message
              : "The quantum service request failed.",
        },
        {
          status: upstream.ok ? 502 : upstream.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
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
