/** Handle proxy/platform failures without exposing raw HTML or parser errors. */
export async function readApiResponse(response) {
  let data;
  try {
    data = JSON.parse(await response.text());
  } catch {
    throw new Error(
      response.ok
        ? "The quantum service returned an unreadable response. Please try again."
        : `The quantum service could not complete this request (HTTP ${response.status}). Please try again shortly.`,
    );
  }
  if (!response.ok) {
    throw new Error(
      typeof data?.detail === "string"
        ? data.detail
        : `The quantum service could not complete this request (HTTP ${response.status}). Please try again shortly.`,
    );
  }
  return data;
}
