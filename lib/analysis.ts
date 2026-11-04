import { execFile } from "child_process";
import { createReadStream } from "fs";
import { mkdir, readdir } from "fs/promises";
import { join } from "path";
import { promisify } from "util";
import { mediaTools, ytDlpArgs } from "@/lib/media-tools";
import { aiClient, summarize } from "@/lib/openai";

const exec = promisify(execFile);
export type Analysis = { title: string; transcript: string; segments: { start: number; end: number; text: string }[]; summary: string; sourceUrl?: string; playbackUrl?: string; provider?: "nptel"; courseId?: string; lectureId?: string; attribution?: { name: string; url: string; lectureUrl?: string; licenseUrl?: string } };

export async function transcribeSource(source: string, title: string, directory: string, language: string, sourceUrl?: string): Promise<Analysis> {
  const tools = mediaTools();
  const pattern = join(directory, "chunk%04d.mp3");
  await exec(tools.ffmpeg, ["-v", "error", "-i", source, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-f", "segment", "-segment_time", "600", "-reset_timestamps", "1", pattern], { timeout: 1_800_000 });
  const chunks = (await readdir(directory)).filter((file) => /^chunk\d+\.mp3$/.test(file)).sort();
  if (!chunks.length) throw new Error("No audio track was found in this video.");
  const { client, model } = aiClient("transcribe");
  const transcripts: string[] = [], segments: { start: number; end: number; text: string }[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const response: any = await client.audio.transcriptions.create({ model, file: createReadStream(join(directory, chunk)), response_format: "verbose_json", timestamp_granularities: ["segment"] });
    transcripts.push(response.text || "");
    for (const segment of response.segments || []) segments.push({ start: segment.start + index * 600, end: segment.end + index * 600, text: segment.text.trim() });
  }
  const transcript = transcripts.join("\n");
  if (!transcript.trim()) throw new Error("No speech was detected in this video.");
  return { title, transcript, segments, summary: await summarize(transcript, "brief", language), sourceUrl };
}

export async function analyzeRemote(url: string, title: string, directory: string, language: string): Promise<Analysis> {
  const tools = mediaTools();
  await mkdir(directory, { recursive: true });
  const template = join(directory, "source.%(ext)s");
  await exec(tools.ytDlp, [...ytDlpArgs(), "--no-playlist", "--no-progress", "-f", "bestaudio/best", "-o", template, url], { timeout: 300_000 });
  const file = (await readdir(directory)).find((name) => name.startsWith("source."));
  if (!file) throw new Error("Could not access a playable video for this lecture.");
  return transcribeSource(join(directory, file), title, directory, language, url);
}
