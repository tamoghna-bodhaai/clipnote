import { cookies } from "next/headers";
import { saveCourseProgress, userForToken } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = userForToken((await cookies()).get("clipnote_session")?.value);
  if (!user) return Response.json({ error: "Sign in to save course progress." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const { courseId, lectureId, positionSeconds, completed } = body || {};
  if (typeof courseId !== "string" || typeof lectureId !== "string" || typeof positionSeconds !== "number" || !Number.isFinite(positionSeconds) || typeof completed !== "boolean") {
    return Response.json({ error: "Invalid course progress." }, { status: 400 });
  }
  if (!saveCourseProgress(user.id, courseId, lectureId, positionSeconds, completed)) return Response.json({ error: "Lecture does not belong to this course." }, { status: 400 });
  return Response.json({ ok: true });
}
