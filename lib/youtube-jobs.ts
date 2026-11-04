import { fetchYoutubeTranscript, type Analysis } from "@/lib/analysis";
import { claimYoutubeTranscriptJob, failYoutubeTranscriptJob, getYoutubeTranscriptJob, saveYoutubeTranscriptJob } from "@/lib/db";
import { isYoutubeAccessError } from "@/lib/media-tools";
import { summarize } from "@/lib/openai";

type Segment = { start: number; end: number; text: string };

export function youtubeVideoId(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const id = host === "youtu.be" ? url.pathname.slice(1).split("/")[0]
      : host.endsWith("youtube.com") ? url.searchParams.get("v") || url.pathname.match(/^\/(?:shorts|embed)\/([\w-]{11})/)?.[1]
      : null;
    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch { return null; }
}

export const canonicalYoutubeUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

function decodeEntities(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (_match, entity: string) => {
    const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
    return entities[entity] || "";
  });
}

async function publicCaptions(videoId: string): Promise<Segment[] | null> {
  const languages = (process.env.YOUTUBE_CAPTION_LANGUAGES || "en,en-US,en-IN").split(",").map((item) => item.trim()).filter(Boolean);
  for (const lang of languages) {
    for (const automatic of [false, true]) {
      try {
        const suffix = automatic ? "&kind=asr" : "";
        const response = await fetch(`https://www.youtube.com/api/timedtext?v=${encodeURIComponent(videoId)}&lang=${encodeURIComponent(lang)}${suffix}`, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) continue;
        const xml = await response.text();
        const segments: Segment[] = [];
        for (const match of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
          const attrs = match[1], start = Number(attrs.match(/\bstart="([^"]+)"/)?.[1]), duration = Number(attrs.match(/\bdur="([^"]+)"/)?.[1]);
          const text = decodeEntities(match[2]).trim();
          if (text && Number.isFinite(start)) segments.push({ start, end: start + (Number.isFinite(duration) ? duration : 0), text });
        }
        if (segments.length) return segments;
      } catch {
        // Captions are an optimization. Network failures fall through to the
        // media extractor instead of turning a transient lookup into a failed job.
      }
    }
  }
  return null;
}

function publicFailure(error: unknown) {
  return isYoutubeAccessError(error)
    ? "YouTube blocked media access from this server. Configure YTDLP_PROXY with a network route that can access YouTube, or upload the video file."
    : error instanceof Error ? error.message : "Could not retrieve this YouTube transcript.";
}

async function processYoutubeTranscript(videoId: string, sourceUrl: string) {
  try {
    const captions = await publicCaptions(videoId);
    if (captions) {
      saveYoutubeTranscriptJob(videoId, { sourceUrl, title: `YouTube video ${videoId}`, transcript: captions.map((segment) => segment.text).join("\n"), segments: captions });
      return;
    }
    const transcript = await fetchYoutubeTranscript(sourceUrl, `YouTube video ${videoId}`);
    saveYoutubeTranscriptJob(videoId, { sourceUrl, ...transcript });
  } catch (error) { failYoutubeTranscriptJob(videoId, publicFailure(error)); }
}

export function queueYoutubeTranscript(sourceUrl: string) {
  const videoId = youtubeVideoId(sourceUrl);
  if (!videoId) throw new Error("Enter a valid YouTube video URL.");
  const canonicalUrl = canonicalYoutubeUrl(videoId);
  const job = getYoutubeTranscriptJob(videoId);
  if (job?.status === "ready") return { videoId, status: "ready" as const };
  if (claimYoutubeTranscriptJob(videoId, canonicalUrl)) void processYoutubeTranscript(videoId, canonicalUrl);
  return { videoId, status: "processing" as const };
}

export async function youtubeAnalysis(videoId: string, language: string): Promise<Analysis> {
  const job = getYoutubeTranscriptJob(videoId);
  if (!job || job.status !== "ready" || !job.transcript || !job.segments) throw new Error("This transcript is not ready yet.");
  return { title: job.title || `YouTube video ${videoId}`, transcript: job.transcript, segments: job.segments, summary: await summarize(job.transcript, "brief", language), sourceUrl: job.sourceUrl };
}
