import { execFile } from "child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { ConfigurationError } from "@/lib/openai";
import { isYoutubeBotError, mediaTools, ytDlpArgs } from "@/lib/media-tools";
import { transcribeSource, type Analysis } from "@/lib/analysis";
import { currentUser, unauthorized } from "@/lib/current-user";

export const runtime = "nodejs";
export const maxDuration = 300;
const exec = promisify(execFile);
const youtubeUrl = /^https?:\/(?:\/(?:www\.|m\.)?youtube\.com\/(?:watch\?[^\s]*v=[\w-]{11}[^\s]*|shorts\/[\w-]{11}(?:\?[^\s]*)?|playlist\?[^\s]*list=[\w-]+[^\s]*)|youtu\.be\/[\w-]{11}(?:\?[^\s]*)?)$/;

const isPlaylist = (url: string) => /youtube\.com\/playlist\?/i.test(url);

async function expandPlaylist(url: string): Promise<string[]> {
  const { ytDlp } = mediaTools();
  const { stdout } = await exec(ytDlp, [...ytDlpArgs(), "--flat-playlist", "--no-warnings", "--print", "%(webpage_url)s", url], { timeout: 60_000 });
  const items = [...new Set(stdout.split("\n").map((item) => item.trim()).filter((item) => /^https?:\/\//.test(item)))].slice(0, 20);
  if (!items.length) throw new Error("Could not find videos in this playlist.");
  return items;
}

async function analyzeYoutube(url: string, parentDirectory: string, index: number, language: string): Promise<Analysis> {
  const directory = join(parentDirectory, `video-${index}`);
  const tools = mediaTools(), template = join(directory, "source.%(ext)s");
  await mkdir(directory);
  const { stdout } = await exec(tools.ytDlp, [...ytDlpArgs(), "--no-playlist", "--no-progress", "--print", "after_move:%(title)s", "-f", "bestaudio/best", "-o", template, url], { timeout: 180_000 });
  const files = await readdir(directory);
  const source = join(directory, files.find((file) => file.startsWith("source.")) || "");
  if (!source || source.endsWith(directory)) throw new Error("Could not download audio from this video.");
  return transcribeSource(source, stdout.trim().split("\n").at(-1) || "YouTube video", directory, language, url);
}

export async function POST(request: Request) {
  if (!await currentUser()) return unauthorized();
  let directory: string | undefined;
  try {
    const form = await request.formData();
    const kind = form.get("kind"), url = String(form.get("url") || "").trim(), video = form.get("video"), language = String(form.get("language") || "English").trim();
    if (kind !== "youtube" && kind !== "upload") return Response.json({ error: "Choose a source." }, { status: 400 });
    const submittedUrls = [...new Set([url, ...String(form.get("urls") || "").split(/\r?\n/)].map((item) => item.trim()).filter(Boolean))];
    if (kind === "youtube" && (!submittedUrls.length || submittedUrls.length > 20 || submittedUrls.some((item) => !youtubeUrl.test(item)))) return Response.json({ error: "Enter up to 20 valid YouTube video or playlist URLs." }, { status: 400 });
    if (language.length > 60) return Response.json({ error: "Choose a valid output language." }, { status: 400 });
    const uploaded = video instanceof File ? video : null;
    if (kind === "upload" && (!uploaded || !uploaded.size)) return Response.json({ error: "Choose a video file to analyze." }, { status: 400 });
    if (uploaded && uploaded.size > 500 * 1024 * 1024) return Response.json({ error: "File is too large. The maximum upload size is 500 MB." }, { status: 413 });
    directory = await mkdtemp(join(tmpdir(), "clipnote-"));
    if (kind === "youtube") {
      const urls = (await Promise.all(submittedUrls.map((item) => isPlaylist(item) ? expandPlaylist(item) : [item]))).flat();
      if (urls.length > 20) return Response.json({ error: "Choose a playlist or list with no more than 20 videos." }, { status: 400 });
      const analyses = [] as Analysis[];
      for (const [index, item] of urls.entries()) analyses.push(await analyzeYoutube(item, directory, index, language));
      return Response.json(analyses.length === 1 ? analyses[0] : { analyses });
    } else {
      const source = join(directory, `upload-${uploaded!.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      await writeFile(source, Buffer.from(await uploaded!.arrayBuffer()));
      return Response.json(await transcribeSource(source, uploaded!.name, directory, language));
    }
  } catch (error) {
    const missingTool = error instanceof Error && "code" in error && error.code === "ENOENT";
    const youtubeBlocked = isYoutubeBotError(error);
    const status = error instanceof ConfigurationError || missingTool ? 503 : youtubeBlocked ? 502 : 422;
    const message = youtubeBlocked
      ? "YouTube blocked this server's request and requires verification. Try uploading the video file, or ask the server administrator to configure YouTube authentication."
      : missingTool
      ? "Media processing is unavailable on this server. Install yt-dlp and ffmpeg, then redeploy."
      : error instanceof Error ? error.message : "Analysis failed. Check your server configuration.";
    return Response.json({ error: message }, { status });
  } finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}
