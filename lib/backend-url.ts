/** FastAPI origin only (no /restaurants path). */

const DEFAULT = "https://nonvertebral-winter-pronunciative.ngrok-free.dev";

export function getBackendOrigin(): string {
  let raw = (process.env.RESTAURANTS_API_URL ?? DEFAULT).trim();
  if (!raw.includes("://")) raw = `http://${raw}`;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return DEFAULT;
  }
}

export function backendUpstreamHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
  };
}
