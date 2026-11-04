import { cookies } from "next/headers";
import { listCourseHistory, userForToken } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = userForToken((await cookies()).get("clipnote_session")?.value);
  if (!user) return Response.json({ error: "Sign in to view course history." }, { status: 401 });
  return Response.json({ courses: listCourseHistory(user.id) });
}
