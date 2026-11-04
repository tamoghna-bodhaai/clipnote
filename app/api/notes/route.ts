import { ConfigurationError, summarize } from "@/lib/openai";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const { transcript, mode, language = "English" } = await request.json();
    if (typeof transcript !== "string" || !transcript.trim() || !["brief", "detailed", "deep"].includes(mode)) return Response.json({ error: "A transcript and a valid note style are required." }, { status: 400 });
    if (typeof language !== "string" || language.length > 60) return Response.json({ error: "Choose a valid output language." }, { status: 400 });
    if (transcript.length > 1_000_000) return Response.json({ error: "Transcript is too long." }, { status: 400 });
    return Response.json({ summary: await summarize(transcript, mode, language) });
  } catch (error) { return Response.json({ error: error instanceof ConfigurationError ? error.message : "Could not generate notes. Check your API configuration." }, { status: error instanceof ConfigurationError ? 503 : 502 }); }
}
