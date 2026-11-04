import { ConfigurationError, aiClient } from "@/lib/openai";
import type OpenAI from "openai";
import { currentUser, unauthorized } from "@/lib/current-user";
export const runtime = "nodejs";
type Segment = { start: number; end: number; text: string };
export async function POST(request: Request) {
  if (!await currentUser()) return unauthorized();
  try {
    const { question, segments, history = [], start, end, pauseTime, language = "English" } = await request.json();
    if (typeof question !== "string" || !question.trim() || question.length > 4000 || !Array.isArray(segments) || !segments.length) return Response.json({ error: "A question and transcript are required." }, { status: 400 });
    const clean = segments.filter((s: Segment) => s && typeof s.text === "string" && typeof s.start === "number" && typeof s.end === "number") as Segment[];
    const hasRange = typeof start === "number" && typeof end === "number" && start >= 0 && start <= end;
    const hasPauseTime = typeof pauseTime === "number" && Number.isFinite(pauseTime) && pauseTime >= 0;
    const selected = hasRange ? clean.filter((s) => s.end >= start && s.start <= end) : clean;
    const context = selected.map((s) => `[${Math.floor(s.start)}s] ${s.text}`).join("\n");
    if (!context) return Response.json({ error: "No transcript is available for this interval. Try a wider selection." }, { status: 400 });
    if (context.length > 100_000) return Response.json({ error: "This transcript selection is too long. Select a shorter video range." }, { status: 400 });
    const { client, model } = aiClient("chat");
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "system", content: `You are a helpful video tutor. Answer using the provided transcript in ${typeof language === "string" && language.length < 60 ? language : "English"}. Cite timestamps when useful, acknowledge missing context and never pretend to have seen video frames. ${hasPauseTime ? `The learner paused at ${Math.floor(pauseTime)} seconds; answer their immediate question first and connect it to the nearby transcript.` : ""} Format answers in Markdown. For mathematics, always write inline LaTeX as $...$ and display equations as $$...$$; never use \\(...\\), \\[...\\], or code spans for mathematical expressions.` }, { role: "user", content: `${hasRange ? `Selected interval ${start}–${end} seconds.` : "Whole video transcript."}\nTranscript:\n${context}` }];
    if (Array.isArray(history)) messages.push(...history.slice(-10).filter((m) => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })));
    messages.push({ role: "user", content: question });
    const answer = (await client.chat.completions.create({ model, messages })).choices[0].message.content || "";
    return Response.json({ answer });
  } catch (error) { return Response.json({ error: error instanceof ConfigurationError ? error.message : "Could not answer the question. Check your API configuration." }, { status: error instanceof ConfigurationError ? 503 : 502 }); }
}
