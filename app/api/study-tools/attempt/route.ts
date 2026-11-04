import { cookies } from "next/headers";
import { getArtifact, getStudy, saveQuizAttempt, userForToken } from "@/lib/db";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const user = userForToken((await cookies()).get("clipnote_session")?.value);
  if (!user) return Response.json({ error: "Sign in to save your quiz." }, { status: 401 });
  const { studyId, lectureKey, language, answers } = await request.json().catch(() => ({}));
  if (typeof studyId !== "string" || typeof lectureKey !== "string" || typeof language !== "string" || !Array.isArray(answers)) return Response.json({ error: "Invalid quiz attempt." }, { status: 400 });
  if (!getStudy(user.id, studyId)) return Response.json({ error: "Study not found." }, { status: 404 });
  const quiz = getArtifact(user.id, studyId, lectureKey, "quiz", language) as { questions: { answerIndex: number }[] } | null;
  if (!quiz || answers.length !== quiz.questions.length || answers.some((a) => !Number.isInteger(a) || a < 0 || a > 3)) return Response.json({ error: "Quiz or answers are invalid." }, { status: 400 });
  const score = quiz.questions.reduce((total, question, index) => total + Number(question.answerIndex === answers[index]), 0);
  saveQuizAttempt(user.id, studyId, lectureKey, language, answers, score, quiz.questions.length);
  return Response.json({ score, total: quiz.questions.length });
}
