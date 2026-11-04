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
