"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

type QuizQuestion = { question: string; options: string[]; answerIndex: number; explanation: string; timestamp: number };
type Quiz = { questions: QuizQuestion[] };
type MapNode = { id: string; label: string; explanation: string; timestamp: number };
type ConceptMap = { nodes: MapNode[]; edges: { from: string; to: string; label: string }[] };
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function StudyTools({ kind, studyId, lectureKey, language, seekTo }: { kind: "quiz" | "concept_map"; studyId: string | null; lectureKey: string; language: string; seekTo: (time: number) => void }) {
  const [content, setContent] = useState<Quiz | ConceptMap | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [score, setScore] = useState<number | null>(null);
  const [selectedNode, setSelectedNode] = useState("");
  useEffect(() => {
    setContent(null); setAnswers({}); setScore(null); setSelectedNode(""); setError("");
    if (!studyId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ studyId, lectureKey, kind, language });
    fetch(`/api/study-tools?${params}`, { signal: controller.signal }).then((r) => r.json()).then((result) => {
      if (result.content) setContent(result.content);
      if (result.attempt) { setAnswers(Object.fromEntries(result.attempt.answers.map((answer: number, index: number) => [index, answer]))); setScore(result.attempt.score); }
    }).catch(() => undefined);
    return () => controller.abort();
  }, [kind, studyId, lectureKey, language]);
  async function generate() {
    if (!studyId) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/study-tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studyId, lectureKey, kind, language }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not generate this material.");
      setContent(result.content);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate this material."); }
    finally { setLoading(false); }
  }
  async function submitQuiz(quiz: Quiz) {
    if (!studyId || Object.keys(answers).length !== quiz.questions.length) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/study-tools/attempt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studyId, lectureKey, language, answers: quiz.questions.map((_, i) => answers[i]) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save your answers.");
      setScore(result.score);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your answers."); }
    finally { setLoading(false); }
  }
  const map = kind === "concept_map" ? content as ConceptMap | null : null;
  const chosen = useMemo(() => map?.nodes.find((node) => node.id === selectedNode) || map?.nodes[0], [map, selectedNode]);
  return <div className="study-tool-shell rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="text-xl font-bold">{kind === "quiz" ? "Quiz" : "Concept map"}</h2>
    <p className="mt-1 text-sm text-slate-500">Based on this lecture’s transcript · {language}</p>
    {!content && <div className="mt-8 rounded-xl bg-slate-50 p-7 text-center"><p className="text-sm text-slate-600">{kind === "quiz" ? "Test your understanding with six questions and explanations." : "Explore the key ideas and how they connect."}</p><button className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={loading || !studyId} onClick={generate}>{loading ? <><Loader2 size={14} className="mr-1 inline animate-spin" /> Generating…</> : `Generate ${kind === "quiz" ? "quiz" : "map"}`}</button></div>}
    {kind === "quiz" && content && <div className="mt-6 space-y-6">{(content as Quiz).questions.map((q, index) => <fieldset key={index} className="rounded-xl border border-slate-200 p-4"><legend className="px-1 text-sm font-bold">{index + 1}. {q.question}</legend><div className="mt-2 grid gap-2">{q.options.map((option, optionIndex) => <label key={optionIndex} className={`flex cursor-pointer gap-2 rounded-lg border p-3 text-sm ${score !== null && q.answerIndex === optionIndex ? "border-green-400 bg-green-50" : "border-slate-200"}`}><input type="radio" name={`question-${index}`} checked={answers[index] === optionIndex} disabled={score !== null} onChange={() => setAnswers((current) => ({ ...current, [index]: optionIndex }))} />{option}</label>)}</div>{score !== null && <div className="mt-3 text-sm"><p>{q.explanation}</p><button className="mt-2 font-semibold text-blue-700 underline" onClick={() => seekTo(q.timestamp)}>View lecture at {clock(q.timestamp)}</button></div>}</fieldset>)}{score === null ? <button disabled={loading || Object.keys(answers).length !== (content as Quiz).questions.length} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => submitQuiz(content as Quiz)}>Submit answers</button> : <div className="rounded-xl bg-blue-50 p-4 text-lg font-bold text-blue-900">Score: {score}/{(content as Quiz).questions.length}</div>}</div>}
    {map && <div className="mt-6"><div className="grid gap-3 sm:grid-cols-2">{map.nodes.map((node) => <button key={node.id} onClick={() => setSelectedNode(node.id)} className={`rounded-xl border p-4 text-left transition ${chosen?.id === node.id ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-blue-300"}`}><strong className="block text-sm">{node.label}</strong><span className="mt-2 block text-xs text-slate-500">{clock(node.timestamp)} <ArrowRight size={12} className="inline" /></span></button>)}</div>{chosen && <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-5"><h3 className="font-bold">{chosen.label}</h3><p className="mt-2 text-sm leading-6">{chosen.explanation}</p><div className="mt-3 flex flex-wrap gap-2">{map.edges.filter((edge) => edge.from === chosen.id || edge.to === chosen.id).map((edge, index) => { const other = map.nodes.find((node) => node.id === (edge.from === chosen.id ? edge.to : edge.from)); return other && <button key={index} onClick={() => setSelectedNode(other.id)} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs">{edge.label} → {other.label}</button>; })}</div><button className="mt-4 text-sm font-semibold text-blue-700 underline" onClick={() => seekTo(chosen.timestamp)}>Jump to {clock(chosen.timestamp)} in lecture</button></div>}</div>}
    {error && <p role="alert" className="mt-4 text-sm text-rose-600">{error}</p>}
  </div>;
}
