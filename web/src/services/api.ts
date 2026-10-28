import { readApiResponse } from "@/lib/api-response";

/** Browser requests use the Node server, avoiding CORS and public backend URLs. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return (await readApiResponse(response)) as T;
}

export const getHealth = () => api<{ status: string }>("health");
