import { cookies } from "next/headers";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { analyzeRemote } from "@/lib/analysis";
import { claimLectureJob, getLecture, getLectureJob, setLectureJob, startCourseLecture, userForToken } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runLecture(id: string) {
  const lecture = getLecture(id);
  if (!lecture?.mediaUrl || !lecture.course) { setLectureJob(id, "error", undefined, "This lecture has no playable media."); return; }
  const directory = await mkdtemp(join(tmpdir(), "clipnote-library-"));
  const heartbeat = setInterval(() => setLectureJob(id, "processing"), 60_000);
  try {
    const analysis = await analyzeRemote(lecture.mediaUrl, lecture.title, join(directory, "video"), "English");
    analysis.sourceUrl = lecture.pageUrl;
    if (/\.(mp4|webm)(?:\?|$)/i.test(lecture.mediaUrl)) analysis.playbackUrl = lecture.mediaUrl;
    analysis.provider = lecture.course.provider;
    analysis.courseId = lecture.courseId;
    analysis.lectureId = lecture.id;
    analysis.attribution = { name: lecture.course.creditName || lecture.course.provider, url: lecture.course.url, lectureUrl: lecture.pageUrl, licenseUrl: lecture.course.licenseUrl || undefined };
    setLectureJob(id, "ready", analysis);
  } catch (error) {
    setLectureJob(id, "error", undefined, error instanceof Error ? error.message : "Lecture processing failed.");
  } finally { clearInterval(heartbeat); await rm(directory, { recursive: true, force: true }); }
}
async function respond(id: string, start: boolean, userId?: string) {
  const lecture = getLecture(id);
  if (!lecture) return Response.json({ error: "Lecture not found." }, { status: 404 });
  if (start && !lecture.mediaUrl) return Response.json({ error: "No playable video is available for this lecture." }, { status: 422 });
  if (start && (!userId || !startCourseLecture(userId, lecture.courseId, id))) {
    return Response.json({ error: "Could not start course tracking for this lecture." }, { status: 400 });
  }
  const current = getLectureJob(id);
  const stale = current?.status === "processing" && new Date(current.updatedAt).getTime() < Date.now() - 15 * 60_000;
  if ((start || stale) && current?.status !== "ready" && claimLectureJob(id)) void runLecture(id);
  const job = getLectureJob(id);
  return Response.json({ status: job?.status || "not_started", analysis: job?.analysis ? JSON.parse(job.analysis) : null, error: job?.error || null });
}
async function authorized() { return userForToken((await cookies()).get("clipnote_session")?.value); }
export async function GET(request: Request) {
  if (!await authorized()) return Response.json({ error: "Sign in to study this lecture." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("lectureId") || "";
  return respond(id, false);
}
export async function POST(request: Request) {
  const user = await authorized();
  if (!user) return Response.json({ error: "Sign in to study this lecture." }, { status: 401 });
  const { lectureId } = await request.json().catch(() => ({}));
  if (typeof lectureId !== "string" || lectureId.length > 150) return Response.json({ error: "Invalid lecture." }, { status: 400 });
  return respond(lectureId, true, user.id);
}
