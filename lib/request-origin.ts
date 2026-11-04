/** Match the browser's origin against the public host when behind a reverse proxy. */
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let browserOrigin: URL;
  try { browserOrigin = new URL(origin); } catch { return false; }
  if (!['http:', 'https:'].includes(browserOrigin.protocol)) return false;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const hosts = [forwardedHost, request.headers.get("host"), new URL(request.url).host];
  return hosts.some((host) => host?.toLowerCase() === browserOrigin.host.toLowerCase());
}
