import { cookies } from "next/headers";
import { userForToken } from "@/lib/db";

export async function currentUser() {
  return userForToken((await cookies()).get("clipnote_session")?.value);
}

export function unauthorized() {
  return Response.json({ error: "Sign in to continue." }, { status: 401 });
}
