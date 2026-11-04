import { ConfigurationError } from "@/lib/openai";
import { currentUser, unauthorized } from "@/lib/current-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const audioFormats: Record<string, string> = {
  "audio/webm": "webm", "audio/wav": "wav", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg",
};

export async function POST(request: Request) {
  if (!await currentUser()) return unauthorized();
  try {
    const form = await request.formData();
    const audio = form.get("audio");
    const language = form.get("language");
    if (!(audio instanceof File) || !audio.size) return Response.json({ error: "An audio recording is required." }, { status: 400 });
    if (audio.size > 10 * 1024 * 1024) return Response.json({ error: "Keep voice questions under 10 MB." }, { status: 413 });
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) throw new ConfigurationError("Set OPENROUTER_API_KEY in .env.local to transcribe voice questions.");
    const format = audioFormats[audio.type] || "webm";
    const body = {
      model: process.env.STT_MODEL?.trim() || "openai/whisper-large-v3-turbo",
      input_audio: { data: Buffer.from(await audio.arrayBuffer()).toString("base64"), format },
      ...(typeof language === "string" && /^[a-z]{2,3}$/i.test(language) ? { language } : {}),
    };
    const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || typeof result.text !== "string") {
      return Response.json({ error: typeof result.error?.message === "string" ? result.error.message : "Could not transcribe your question." }, { status: response.status || 502 });
    }
    return Response.json({ text: result.text });
  } catch (error) {
    return Response.json({ error: error instanceof ConfigurationError ? error.message : "Could not transcribe your question." }, { status: error instanceof ConfigurationError ? 503 : 502 });
  }
}
