/** Browser requests use the Node server, avoiding CORS and public backend URLs. */
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "The request failed. Please check your input.",
    );
  return data as T;
}

export const getHealth = () => api<{ status: string }>("health");
