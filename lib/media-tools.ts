import { existsSync, readdirSync } from "fs";
import { join } from "path";

const root = process.cwd();
function executable(...candidates: string[]) {
  const value = candidates.find((candidate) => candidate && existsSync(candidate));
  return value;
}

/**
 * Prefer explicit paths, then use the pre-existing local media toolchain.
 * The bare command names remain a final fallback for system installations.
 */
export function mediaTools() {
  const virtualEnv = process.env.VIRTUAL_ENV || join(root, ".venv");
  const libraryDirectory = join(virtualEnv, "lib");
  const pythonDirectory = existsSync(libraryDirectory) ? readdirSync(libraryDirectory).find((entry) => entry.startsWith("python")) : undefined;
  const ffmpegDirectory = pythonDirectory ? join(libraryDirectory, pythonDirectory, "site-packages", "imageio_ffmpeg", "binaries") : "";
  const bundledFfmpeg = existsSync(ffmpegDirectory)
    ? readdirSync(ffmpegDirectory).find((entry) => entry.startsWith("ffmpeg-"))
    : undefined;
  return {
    ytDlp: executable(process.env.YTDLP_PATH || "", join(virtualEnv, "bin", "yt-dlp")) || "yt-dlp",
    ffmpeg: executable(process.env.FFMPEG_PATH || "", bundledFfmpeg ? join(ffmpegDirectory, bundledFfmpeg) : "") || "ffmpeg",
  };
}

/** Shared yt-dlp options for YouTube downloads and playlist expansion. */
export function ytDlpArgs() {
  const args = ["--js-runtimes", "node"];
  const cookiesFile = process.env.YTDLP_COOKIES_FILE;
  if (cookiesFile) args.push("--cookies", cookiesFile);
  const proxy = process.env.YTDLP_PROXY?.trim();
  if (proxy) args.push("--proxy", proxy);
  return args;
}

export function isYoutubeBotError(error: unknown) {
  const details = error instanceof Error && "stderr" in error
    ? String(error.stderr)
    : error instanceof Error ? error.message : "";
  return /sign in to confirm|confirm you.re not a bot/i.test(details);
}

export function isYoutubeAccessError(error: unknown) {
  const details = error instanceof Error && "stderr" in error
    ? String(error.stderr)
    : error instanceof Error ? error.message : "";
  return isYoutubeBotError(error) || /HTTP Error 403|requested format is not available|This video is unavailable\. Error code: 152\b/i.test(details);
}
