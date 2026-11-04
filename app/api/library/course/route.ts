import { cookies } from "next/headers";
import { getCourse, getCourseProgress, userForToken } from "@/lib/db";
import { hydrateCourse } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = userForToken((await cookies()).get("clipnote_session")?.value);
  if (!user) return Response.json({ error: "Sign in to view course progress." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^nptel:[\w-]+$/.test(id)) return Response.json({ error: "Invalid course." }, { status: 400 });
  const course = getCourse(id);
  if (!course) return Response.json({ error: "Course not found." }, { status: 404 });
  return Response.json({ course: await hydrateCourse(id), progress: getCourseProgress(user.id, id) });
}
