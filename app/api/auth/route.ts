import { cookies } from "next/headers";
import { createHash } from "crypto";
import { AccountConflictError, allowLoginAttempt, createCodeSession, createSession, removeSession, userForToken } from "@/lib/db";
import { accessCodesConfigured, normalizeIdentifier, productionAuth, validEmail, validUsername, verifiedCodeHash } from "@/lib/auth";
import { sameOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

const cookieName = "clipnote_session";
const sessionSeconds = productionAuth ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 365;

export async function GET() {
  const token = (await cookies()).get(cookieName)?.value;
  try {
    return Response.json({ user: userForToken(token), authMode: productionAuth ? "code" : "local" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Authentication storage unavailable", error);
    return Response.json({ error: "Sign-in service is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const email = typeof body.email === "string" ? normalizeIdentifier(body.email) : "";
  let session: ReturnType<typeof createSession>;
  if (productionAuth) {
    try {
      if (!accessCodesConfigured()) return Response.json({ error: "Sign in is not configured. Contact the site administrator." }, { status: 503 });
    } catch (error) {
      console.error("Access-code configuration invalid", error);
      return Response.json({ error: "Sign in is not configured. Contact the site administrator." }, { status: 503 });
    }
    const clientAddress = request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || request.headers.get("x-real-ip") || "unknown";
    const clientScope = `ip:${createHash("sha256").update(clientAddress).digest("hex")}`;
    try {
      if (!allowLoginAttempt(clientScope, 5) || !allowLoginAttempt("global", 50)) {
        return Response.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429, headers: { "Retry-After": "900" } });
      }
    } catch (error) {
      console.error("Authentication storage unavailable", error);
      return Response.json({ error: "Sign-in service is temporarily unavailable." }, { status: 503 });
    }
    const username = typeof body.username === "string" ? normalizeIdentifier(body.username) : "";
    const codeHash = typeof body.accessCode === "string" && /^\d{5}$/.test(body.accessCode) ? verifiedCodeHash(body.accessCode) : null;
    if (!validUsername(username) || !validEmail(email) || !codeHash) return Response.json({ error: "Enter a valid username, email, and access code." }, { status: 401 });
    try { session = createCodeSession(username, email, codeHash); }
    catch (error) {
      if (error instanceof AccountConflictError) return Response.json({ error: "This code or account details cannot be used. Check the details you used before." }, { status: 409 });
      console.error("Authentication storage unavailable", error);
      return Response.json({ error: "Sign-in service is temporarily unavailable." }, { status: 503 });
    }
  } else if (!validEmail(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  } else {
    session = createSession(email, typeof body.name === "string" ? body.name : undefined);
  }
  const { token, user } = session;
  const response = Response.json({ user });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.set("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionSeconds}${secure}`);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const store = await cookies();
  removeSession(store.get(cookieName)?.value);
  const response = Response.json({ ok: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.set("Set-Cookie", `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  return response;
}
