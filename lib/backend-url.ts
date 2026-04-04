/** FastAPI origin only (no /restaurants path). */

const DEFAULT = "http://127.0.0.1:8000";

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
