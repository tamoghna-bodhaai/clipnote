import { cookies } from "next/headers";
import { aiClient, ConfigurationError } from "@/lib/openai";
import { getArtifact, getLatestQuizAttempt, getStudy, saveArtifact, userForToken } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Segment = { start: number; end: number; text: string };
type QuizQuestion = { question: string; options: string[]; answerIndex: number; explanation: string; timestamp: number };
type MapNode = { id: string; label: string; explanation: string; timestamp: number };
type MapEdge = { from: string; to: string; label: string };

function contextFromSegments(segments: Segment[]) {
  const valid = segments.filter((s) => Number.isFinite(s.start) && typeof s.text === "string" && s.text.trim());
  const stride = Math.max(1, Math.ceil(valid.length / 180));
  return valid.filter((_, i) => i % stride === 0).map((s) => `[${Math.floor(s.start)}s] ${s.text}`).join("\n").slice(0, 70_000);
}
function parseObject(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}
function validQuiz(value: any): value is { questions: QuizQuestion[] } {
  return Array.isArray(value?.questions) && value.questions.length >= 3 && value.questions.every((q: any) => typeof q.question === "string" && Array.isArray(q.options) && q.options.length === 4 && q.options.every((o: any) => typeof o === "string") && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < 4 && typeof q.explanation === "string" && Number.isFinite(q.timestamp));
}
function validMap(value: any): value is { nodes: MapNode[]; edges: MapEdge[] } {
  return Array.isArray(value?.nodes) && value.nodes.length >= 3 && Array.isArray(value.edges) && value.nodes.every((n: any) => typeof n.id === "string" && typeof n.label === "string" && typeof n.explanation === "string" && Number.isFinite(n.timestamp)) && value.edges.every((e: any) => typeof e.from === "string" && typeof e.to === "string" && typeof e.label === "string");
}
export async function GET(request: Request) {
  const user = userForToken((await cookies()).get("clipnote_session")?.value);
  if (!user) return Response.json({ error: "Sign in to view study tools." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const studyId = params.get("studyId") || "", lectureKey = params.get("lectureKey") || "", kind = params.get("kind") || "", language = params.get("language") || "English";
  if (!studyId || !lectureKey || !["quiz", "concept_map"].includes(kind) || language.length > 60) return Response.json({ error: "Invalid study tool request." }, { status: 400 });
  if (!getStudy(user.id, studyId)) return Response.json({ error: "Study not found." }, { status: 404 });
  return Response.json({ content: getArtifact(user.id, studyId, lectureKey, kind, language), attempt: kind === "quiz" ? getLatestQuizAttempt(user.id, studyId, lectureKey, language) : null });
}
export async function POST(request: Request) {
  const user = userForToken((await cookies()).get("clipnote_session")?.value);
  if (!user) return Response.json({ error: "Sign in to use study tools." }, { status: 401 });
  try {
    const { studyId, lectureKey, kind, language = "English" } = await request.json();
    if (typeof studyId !== "string" || typeof lectureKey !== "string" || !["quiz", "concept_map"].includes(kind) || typeof language !== "string" || language.length > 60) return Response.json({ error: "Invalid study tool request." }, { status: 400 });
    const study = getStudy(user.id, studyId);
    const analysis = study?.analyses.find((a) => (a.lectureId || a.sourceUrl || a.transcript.slice(0, 50)) === lectureKey);
    if (!analysis?.segments?.length) return Response.json({ error: "This study has no transcript to assess." }, { status: 404 });
    const cached = getArtifact(user.id, studyId, lectureKey, kind, language);
    if (cached) return Response.json({ content: cached, cached: true });
    const context = contextFromSegments(analysis.segments);
    if (!context) return Response.json({ error: "No usable transcript segments were found." }, { status: 422 });
    const { client, model } = aiClient("assessment");
    const instruction = kind === "quiz"
      ? "Create exactly 6 multiple-choice questions. Return JSON only: {\"questions\":[{\"question\":string,\"options\":[string,string,string,string],\"answerIndex\":0-3,\"explanation\":string,\"timestamp\":number}]}. Include plausible distractors and explain the correct choice."
      : "Create an interactive concept map with 6-10 concise nodes and meaningful directed links. Return JSON only: {\"nodes\":[{\"id\":string,\"label\":string,\"explanation\":string,\"timestamp\":number}],\"edges\":[{\"from\":nodeId,\"to\":nodeId,\"label\":string}]}.";
    const result = await client.chat.completions.create({ model, temperature: 0.3, messages: [
      { role: "system", content: `${instruction} Write all learner-facing text in ${language}. Use only supported facts from the transcript. Timestamps must be seconds corresponding to cited transcript lines. Do not add Markdown fences.` },
      { role: "user", content: context },
    ] });
    const content = parseObject(result.choices[0].message.content || "");
    if (kind === "quiz" ? !validQuiz(content) : !validMap(content)) return Response.json({ error: "The generated material was incomplete. Please retry." }, { status: 502 });
    saveArtifact(user.id, studyId, lectureKey, kind, language, content);
    return Response.json({ content, cached: false });
  } catch (error) {
    return Response.json({ error: error instanceof ConfigurationError ? error.message : "Could not generate this study tool." }, { status: error instanceof ConfigurationError ? 503 : 502 });
  }
}
