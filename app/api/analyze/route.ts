import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { ConfigurationError } from "@/lib/openai";
import { transcribeSource } from "@/lib/analysis";
import { currentUser, unauthorized } from "@/lib/current-user";
import { getYoutubeTranscriptJob } from "@/lib/db";
import { queueYoutubeTranscript, youtubeAnalysis, youtubeVideoId } from "@/lib/youtube-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;
const youtubeUrl = /^https?:\/(?:\/(?:www\.|m\.)?youtube\.com\/(?:watch\?[^\s]*v=[\w-]{11}[^\s]*|shorts\/[\w-]{11}(?:\?[^\s]*)?)|youtu\.be\/[\w-]{11}(?:\?[^\s]*)?)$/;

function failure(error: unknown) {
  const missingTool = error instanceof Error && "code" in error && error.code === "ENOENT";
  const status = error instanceof ConfigurationError || missingTool ? 503 : 422;
  const message = missingTool
    ? "Media processing is unavailable on this server. Install yt-dlp and ffmpeg, then redeploy."
    : error instanceof Error ? error.message : "Analysis failed. Check your server configuration.";
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  if (!await currentUser()) return unauthorized();
  const url = new URL(request.url);
  const videoIds = [...new Set((url.searchParams.get("videoIds") || "").split(",").filter(Boolean))];
  const language = (url.searchParams.get("language") || "English").trim();
  if (!videoIds.length || videoIds.length > 20 || videoIds.some((videoId) => !/^[\w-]{11}$/.test(videoId)) || language.length > 60) return Response.json({ error: "Invalid transcript job." }, { status: 400 });
  const jobs = videoIds.map((videoId) => ({ videoId, job: getYoutubeTranscriptJob(videoId) }));
  const failed = jobs.find(({ job }) => !job || job.status === "error");
  if (failed) return Response.json({ error: failed.job?.error || "Could not retrieve this YouTube transcript." }, { status: 422 });
  if (jobs.some(({ job }) => job?.status !== "ready")) return Response.json({ jobs: jobs.map(({ videoId, job }) => ({ videoId, status: job?.status || "pending" })) }, { status: 202, headers: { "Cache-Control": "no-store" } });
  try {
    const analyses = await Promise.all(videoIds.map((videoId) => youtubeAnalysis(videoId, language)));
    return Response.json(analyses.length === 1 ? analyses[0] : { analyses });
  }
  catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  if (!await currentUser()) return unauthorized();
  let directory: string | undefined;
  try {
    const form = await request.formData();
    const kind = form.get("kind"), url = String(form.get("url") || "").trim(), video = form.get("video"), language = String(form.get("language") || "English").trim();
    if (kind !== "youtube" && kind !== "upload") return Response.json({ error: "Choose a source." }, { status: 400 });
    if (language.length > 60) return Response.json({ error: "Choose a valid output language." }, { status: 400 });
    const uploaded = video instanceof File ? video : null;
    if (kind === "upload" && (!uploaded || !uploaded.size)) return Response.json({ error: "Choose a video file to analyze." }, { status: 400 });
    if (uploaded && uploaded.size > 500 * 1024 * 1024) return Response.json({ error: "File is too large. The maximum upload size is 500 MB." }, { status: 413 });
    if (kind === "youtube") {
      const submittedUrls = [...new Set([url, ...String(form.get("urls") || "").split(/\r?\n/)].map((item) => item.trim()).filter(Boolean))];
      if (!submittedUrls.length || submittedUrls.length > 20 || submittedUrls.some((item) => !youtubeUrl.test(item) || !youtubeVideoId(item))) return Response.json({ error: "Enter up to 20 valid YouTube video URLs. Playlists are not available while videos are queued." }, { status: 400 });
      const jobs = submittedUrls.map(queueYoutubeTranscript);
      if (jobs.some((job) => job.status !== "ready")) return Response.json({ jobs }, { status: 202, headers: { "Cache-Control": "no-store" } });
      const analyses = await Promise.all(jobs.map((job) => youtubeAnalysis(job.videoId, language)));
      return Response.json(analyses.length === 1 ? analyses[0] : { analyses });
    }
    directory = await mkdtemp(join(tmpdir(), "clipnote-upload-"));
    const source = join(directory, `upload-${uploaded!.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    await writeFile(source, Buffer.from(await uploaded!.arrayBuffer()));
    return Response.json(await transcribeSource(source, uploaded!.name, directory, language));
  } catch (error) { return failure(error); }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}
