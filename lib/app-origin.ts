import { headers } from "next/headers";

// The app's own address (http://localhost:3000, the Vercel preview, or the main site), from the request.
// Used for links that leave the browser: sign-in links, preview links, QR codes.
export async function appOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}
