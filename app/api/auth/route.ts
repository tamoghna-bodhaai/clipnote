import { cookies } from "next/headers";
import { createSession, removeSession, userForToken } from "@/lib/db";

export const dynamic = "force-dynamic";

const cookieName = "clipnote_session";
const localSessionSeconds = 60 * 60 * 24 * 365;

export async function GET() {
  const token = (await cookies()).get(cookieName)?.value;
  return Response.json({ user: userForToken(token) });
}

export async function POST(request: Request) {
  const { email, name } = await request.json();
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  const { token, user } = createSession(email, typeof name === "string" ? name : undefined);
  const response = Response.json({ user });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.set("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${localSessionSeconds}${secure}`);
  return response;
}

export async function DELETE() {
  const store = await cookies();
  removeSession(store.get(cookieName)?.value);
  const response = Response.json({ ok: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.set("Set-Cookie", `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  return response;
}
