"use client";

import { ChangeEvent, CSSProperties, FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Bot,
  BrainCircuit,
  Captions,
  Check,
  Clipboard,
  Download,
  FileText,
  FileUp,
  History,
  Link as LinkIcon,
  ListVideo,
  Loader2,
  MessageCircle,
  Mic,
  LogOut,
  Plus,
  Play,
  Pencil,
  ScanLine,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { LibraryBrowser } from "@/components/library-browser";
import { StudyTools } from "@/components/study-tools";

type Segment = { start: number; end: number; text: string };
type Source = "youtube" | "upload" | "nptel";
type Analysis = {
  title: string;
  summary: string;
  transcript: string;
  segments: Segment[];
  sourceUrl?: string;
  playbackUrl?: string;
  provider?: "nptel";
  courseId?: string;
  lectureId?: string;
  attribution?: { name: string; url: string; lectureUrl?: string; licenseUrl?: string };
};
type ChatMessage = { role: "user" | "assistant"; content: string };
type NoteMode = "brief" | "detailed" | "deep";
type SavedSummaries = Record<string, string>;
type HistoryEntry = {
  id: string;
  createdAt: string;
  source: Source;
  analyses: Analysis[];
  summaries?: SavedSummaries;
  studyLanguage?: string;
};
type CourseHistoryEntry = { courseId: string; lectureId: string; positionSeconds: number; updatedAt: string; courseTitle: string; lectureTitle: string; lectureOrdinal: number };
type User = { id: string; email: string; name: string };
type ProcessingState = {
  title: string;
  progress: number;
  stage: string;
  transcript: Segment[];
  notes: string[];
};
const activeAnalysisKey = "clipnote-active-analysis";
type YouTubePlayer = {
  getCurrentTime: () => number;
  seekTo: (time: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  destroy: () => void;
};
type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: Record<string, unknown>,
  ) => YouTubePlayer;
};
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
const speechLanguages: Record<string, string> = {
  English: "en", Spanish: "es", French: "fr", German: "de", Hindi: "hi",
  Japanese: "ja", Korean: "ko", Portuguese: "pt", "Chinese (Simplified)": "zh",
};
const suggestions = [
  "Explain the main ideas in simple language.",
  "What are the most important concepts?",
  "Explain this part step by step.",
];
const formatTime = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
const historyTitle = (entry: HistoryEntry) =>
  entry.analyses.length > 1
    ? `${entry.analyses.length} videos`
    : entry.analyses[0]?.title || "Untitled study";
const formatVttTime = (time: number) => {
  const hours = Math.floor(time / 3600),
    minutes = Math.floor((time % 3600) / 60),
    seconds = Math.floor(time % 60),
    milliseconds = Math.round((time % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
};

/**
 * The tutor is asked to use `$...$` and `$$...$$`, but normalizing the two
 * common LaTeX alternatives also keeps answers from older conversations (or
 * models that prefer `\\(...\\)`) readable.
 */
function readLatexGroup(content: string, start: number) {
  if (content[start] !== "{") return null;
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === "\\") {
      index += 1;
      continue;
    }
    if (content[index] === "{") depth += 1;
    if (content[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return { content: content.slice(start + 1, index), end: index + 1 };
      }
    }
  }
  return null;
}

/** Replace visually noisy stacked fractions with grouped slash notation. */
function flattenNestedFractions(content: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < content.length) {
    const fractionStart = content.indexOf("\\frac", cursor);
    if (fractionStart < 0) return result + content.slice(cursor);
    result += content.slice(cursor, fractionStart);
    const numerator = readLatexGroup(content, fractionStart + 5);
    const denominator = numerator && readLatexGroup(content, numerator.end);
    if (!numerator || !denominator) {
      result += "\\frac";
      cursor = fractionStart + 5;
      continue;
    }
    const nextNumerator = flattenNestedFractions(numerator.content);
    const nextDenominator = flattenNestedFractions(denominator.content);
    result += numerator.content.includes("\\frac") || denominator.content.includes("\\frac")
      ? `\\left(${nextNumerator}\\right) / ${nextDenominator}`
      : `\\frac{${nextNumerator}}{${nextDenominator}}`;
    cursor = denominator.end;
  }
  return result;
}

function normalizeMathDelimiters(content: string) {
  const normalized = content
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, math: string) => `$${math.trim()}$`)
    // A few model responses escape dollar delimiters for Markdown. Those
    // escapes are useful in prose, but prevent remark-math from seeing math.
    .replace(/\\\$\\\$([\s\S]*?)\\\$\\\$/g, (_match, math: string) => `\n\n$$\n${math.trim()}\n$$\n\n`)
    .replace(/\\\$([^\n$]+?)\\\$/g, (_match, math: string) => `$${math.trim()}$`);
  return flattenNestedFractions(normalized);
}

function NotesGenerationLoader({ mode }: { mode: NoteMode }) {
  const label =
    mode === "brief"
      ? "summary"
      : mode === "detailed"
        ? "study guide"
        : "deep dive";
  return (
    <div className="notes-generation" role="status" aria-live="polite">
      <div className="generation-orbit" aria-hidden="true">
        <Loader2 size={25} />
        <Sparkles className="generation-spark generation-spark-one" size={13} />
        <Sparkles className="generation-spark generation-spark-two" size={10} />
      </div>
      <div>
        <p className="generation-eyebrow">AI IS WORKING</p>
        <h2>Building your {label}.</h2>
        <p className="generation-copy">
          Reading the transcript, connecting the key ideas, and formatting the notes.
        </p>
      </div>
      <div className="generation-skeleton" aria-hidden="true">
        <span /><span /><span /><span />
      </div>
    </div>
  );
}
type Chapter = { start: number; end: number; title: string; detail: string };
function chaptersFromSegments(segments: Segment[]): Chapter[] {
  if (!segments.length) return [];
  const finalEnd = segments.at(-1)?.end || 0;
  const targetCount = Math.max(1, Math.min(8, Math.ceil(finalEnd / 240)));
  const chunkSize = Math.max(1, Math.ceil(segments.length / targetCount));
  return Array.from(
    { length: Math.ceil(segments.length / chunkSize) },
    (_, index) => {
      const group = segments.slice(index * chunkSize, (index + 1) * chunkSize);
      const detail = group
        .map((segment) => segment.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        start: group[0].start,
        end: group.at(-1)?.end || group[0].end,
        title: `Chapter ${index + 1}`,
        detail:
          detail.length > 105 ? `${detail.slice(0, 102).trimEnd()}…` : detail,
      };
    },
  );
}
/**
 * Transcript entries should describe a learnable moment, not mirror the
 * word-level timing used for captions. Keep the original segments intact for
 * subtitles and range-aware chat, then combine them into readable passages.
 */
function transcriptMoments(segments: Segment[]): Segment[] {
  const moments: Segment[] = [];
  let current: Segment | null = null;

  const commit = () => {
    if (!current) return;
    current.text = current.text.replace(/\s+/g, " ").trim();
    if (current.text) moments.push(current);
    current = null;
  };

  for (const segment of segments) {
    const text = segment.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (!current) {
      current = { start: segment.start, end: segment.end, text };
    } else {
      current.end = segment.end;
      current.text += ` ${text}`;
    }

    const duration = current.end - current.start;
    const completeThought = /[.!?](?:[””'\])}]*)$/.test(current.text);
    if (
      (duration >= 12 && completeThought) ||
      duration >= 26 ||
      current.text.length >= 420
    ) {
      commit();
    }
  }
  commit();
  return moments;
}
function videoId(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "youtu.be"
      ? parsed.pathname.slice(1)
      : parsed.pathname.startsWith("/shorts/")
        ? parsed.pathname.split("/")[2]
        : parsed.searchParams.get("v");
  } catch {
    return null;
  }
}
let youTubeApiPromise: Promise<YouTubeApi> | null = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youTubeApiPromise) return youTubeApiPromise;
  youTubeApiPromise = new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!);
    document.head.appendChild(script);
  });
  return youTubeApiPromise;
}
function YouTubePlayerFrame({
  id,
  playerRef,
  resumeAt = 0,
}: {
  id: string;
  playerRef: React.MutableRefObject<YouTubePlayer | null>;
  resumeAt?: number;
}) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true,
      player: YouTubePlayer | null = null;
    loadYouTubeApi().then((YT) => {
      if (!active || !element.current) return;
      player = new YT.Player(element.current, {
        videoId: id,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            if (active && player) {
              playerRef.current = player;
              if (resumeAt > 0) player.seekTo(resumeAt, true);
            }
          },
        },
      });
    });
    return () => {
      active = false;
      if (playerRef.current === player) playerRef.current = null;
      player?.destroy();
    };
  }, [id, playerRef, resumeAt]);
  return <div ref={element} className="h-full w-full" />;
}

export function ClipNoteApp() {
  const [source, setSource] = useState<Source>("youtube"),
    [url, setUrl] = useState(""),
    [extraUrls, setExtraUrls] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null),
    [batch, setBatch] = useState<Analysis[]>([]),
    [summaryMode, setSummaryMode] = useState<NoteMode>("brief"),
    [summaries, setSummaries] = useState<Record<string, string>>({}),
    [noteStatus, setNoteStatus] = useState(""),
    [noteLoading, setNoteLoading] = useState(false),
    [language, setLanguage] = useState("English");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [courseHistory, setCourseHistory] = useState<CourseHistoryEntry[]>([]);
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [resumeAt, setResumeAt] = useState(0);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [authMode, setAuthMode] = useState<"local" | "code">("code");
  const [authOpen, setAuthOpen] = useState(false);
  const [homeView, setHomeView] = useState<"study" | "courses">("study");
  const [courseToOpen, setCourseToOpen] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]),
    [question, setQuestion] = useState(""),
    [chatStatus, setChatStatus] = useState(""),
    [chatLoading, setChatLoading] = useState(false),
    [range, setRange] = useState<[number, number] | null>(null),
    [rangeStart, setRangeStart] = useState<number | null>(null),
    [pauseTime, setPauseTime] = useState<number | null>(null);
  const localPlayer = useRef<HTMLVideoElement>(null);
  const youtubePlayer = useRef<YouTubePlayer | null>(null);
  const [playerUrl, setPlayerUrl] = useState("");
  useEffect(() => {
    if (!file) {
      setPlayerUrl("");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setPlayerUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  useEffect(() => {
    if (!processing) return;
    const liveTranscript = [
      "The lecture opens by framing the central question and why it matters.",
      "A first principle is introduced, along with the intuition behind it.",
      "The speaker works through an example to connect the idea to practice.",
      "Key terms are compared so the important distinction is easy to remember.",
      "The section closes by linking the concept to the next topic.",
    ];
    const liveNotes = [
      "## Live notes", "- **Core idea:** identifying the main question and its context.",
      "- **Key concept:** the underlying principle is introduced step by step.",
      "- **Example:** a practical case makes the abstract idea concrete.",
      "- **Takeaway:** connect the concept back to the larger lecture.",
    ];
    const timer = window.setInterval(() => {
      setProcessing((current) => {
        if (!current) return null;
        const transcriptIndex = current.transcript.length;
        const notesIndex = current.notes.length;
        const nextProgress = Math.min(92, current.progress + 8);
        return {
          ...current,
          progress: nextProgress,
          stage: nextProgress < 45 ? "Transcribing the lecture" : nextProgress < 75 ? "Finding the key ideas" : "Writing your study notes",
          transcript: transcriptIndex < liveTranscript.length
            ? [...current.transcript, { start: transcriptIndex * 42, end: transcriptIndex * 42 + 38, text: liveTranscript[transcriptIndex] }]
            : current.transcript,
          notes: notesIndex < liveNotes.length ? [...current.notes, liveNotes[notesIndex]] : current.notes,
        };
      });
    }, 1150);
    return () => window.clearInterval(timer);
  }, [processing?.title]);
  useEffect(() => {
    fetch("/api/auth")
      .then((response) => response.json())
      .then((result) => { setAuthMode(result.authMode === "local" ? "local" : "code"); setUser(result.user || null); })
      .catch(() => setUser(null));
  }, []);
  // Keep the workspace visible across a browser refresh. The analysis request is
  // server-side, so it may finish while the page is reloading; this snapshot
  // prevents the learner from being dropped back onto the source form meanwhile.
  useEffect(() => {
    if (!user || analysis || processing) return;
    try {
      const saved = sessionStorage.getItem(activeAnalysisKey);
      if (!saved) return;
      const snapshot = JSON.parse(saved) as {
        source?: Source;
        url?: string;
        extraUrls?: string;
        language?: string;
        processing?: ProcessingState;
      };
      if (!snapshot.processing || (snapshot.source !== "youtube" && snapshot.source !== "upload")) return;
      setSource(snapshot.source);
      setUrl(snapshot.url || "");
      setExtraUrls(snapshot.extraUrls || "");
      setLanguage(snapshot.language || "English");
      setProcessing(snapshot.processing);
    } catch {
      sessionStorage.removeItem(activeAnalysisKey);
    }
  }, [user, analysis, processing]);
  useEffect(() => {
    if (!processing) return;
    sessionStorage.setItem(activeAnalysisKey, JSON.stringify({ source, url, extraUrls, language, processing }));
  }, [processing, source, url, extraUrls, language]);
  useEffect(() => {
    if (!user) return;
    fetch("/api/history")
      .then((response) => response.json())
      .then((result) => {
        if (Array.isArray(result.studies)) setHistory(result.studies.filter((study: HistoryEntry) => study.source !== "nptel"));
      })
      .catch(() => setError("Could not load your saved studies."));
  }, [user]);
  useEffect(() => {
    if (!user) return;
    fetch("/api/library/history")
      .then((response) => response.json())
      .then((result) => { if (Array.isArray(result.courses)) setCourseHistory(result.courses); })
      .catch(() => undefined);
  }, [user, analysis]);
  const currentTime = () =>
    source === "upload" || !!analysis?.playbackUrl
      ? localPlayer.current?.currentTime || 0
      : youtubePlayer.current?.getCurrentTime() || 0;
  const seekTo = (time: number) => {
    if ((source === "upload" || !!analysis?.playbackUrl) && localPlayer.current) {
      localPlayer.current.currentTime = time;
      void localPlayer.current.play();
    } else if (youtubePlayer.current) {
      youtubePlayer.current.seekTo(time, true);
      youtubePlayer.current.playVideo();
    }
  };
  const pause = () => {
    if (source === "upload" || !!analysis?.playbackUrl) localPlayer.current?.pause();
    else youtubePlayer.current?.pauseVideo();
  };
  useEffect(() => {
    if (!analysis?.courseId || !analysis.lectureId) return;
    const saveProgress = () => {
      const positionSeconds = source === "upload" || !!analysis.playbackUrl
        ? localPlayer.current?.currentTime || 0
        : youtubePlayer.current?.getCurrentTime() || 0;
      void fetch("/api/library/progress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId: analysis.courseId, lectureId: analysis.lectureId, positionSeconds, completed: false }) });
    };
    const timer = window.setInterval(saveProgress, 15_000);
    return () => { window.clearInterval(timer); saveProgress(); };
  }, [analysis?.courseId, analysis?.lectureId, analysis?.playbackUrl, source]);
  const selectedLabel = range
    ? `Selected ${formatTime(range[0])} – ${formatTime(range[1])}. Chat will use this transcript range.`
    : rangeStart !== null
      ? `Start marked at ${formatTime(rangeStart)}. Mark an end to select a range.`
      : "Chat is using the whole video transcript.";
  const persistHistory = (next: HistoryEntry[]) => {
    setHistory(next);
    if (user) {
      const newest = next[0];
      if (newest) void fetch("/api/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newest) });
    }
  };
  const removeHistory = (id?: string) => {
    setHistory((current) => (id ? current.filter((entry) => entry.id !== id) : []));
    if (user) void fetch(`/api/history${id ? `?id=${encodeURIComponent(id)}` : ""}`, { method: "DELETE" });
  };
  const signOut = async () => {
    await fetch("/api/auth", { method: "DELETE" });
    setAnalysis(null); setBatch([]); setHistory([]); setCourseHistory([]); setUser(null);
  };
  const openHistory = (entry: HistoryEntry) => {
    setActiveHistoryId(entry.id);
    setResumeAt(0);
    setSource(entry.source);
    setUrl(entry.analyses[0]?.sourceUrl || "");
    setFile(null);
    setBatch(entry.analyses);
    setAnalysis(entry.analyses[0] || null);
    const savedLanguage = entry.studyLanguage || "English";
    setLanguage(savedLanguage);
    setSummaries(entry.summaries && Object.keys(entry.summaries).some((key) => key.includes(":")) ? entry.summaries : { [`${savedLanguage}:brief`]: entry.analyses[0]?.summary || "" });
    setSummaryMode("brief");
    setMessages([]);
    setRange(null);
    setRangeStart(null);
    setPauseTime(null);
  };

  const openLibraryAnalysis = (next: Analysis, savedPosition = 0) => {
    if (!next.provider) return;
    const existing = history.find((entry) => entry.analyses[0]?.lectureId === next.lectureId);
    const entry: HistoryEntry = existing || { id: crypto.randomUUID(), createdAt: new Date().toISOString(), source: next.provider, analyses: [next], studyLanguage: language, summaries: { "English:brief": next.summary } };
    if (!existing) persistHistory([entry, ...history].slice(0, 20));
    setActiveHistoryId(entry.id);
    setResumeAt(savedPosition);
    setSource(next.provider);
    setUrl(next.sourceUrl || "");
    setFile(null);
    setBatch([next]);
    setAnalysis(next);
    setSummaries({ "English:brief": next.summary });
    setSummaryMode("brief");
    setMessages([]);
    setRange(null);
    setRangeStart(null);
    setPauseTime(null);
  };

  async function analyze(event?: FormEvent, selectedFile?: File) {
    event?.preventDefault();
    setError("");
    setLoading(true);
    const upload = selectedFile || file;
    const processingTitle = source === "upload"
      ? upload?.name.replace(/\.[^/.]+$/, "") || "Untitled lecture"
      : "Preparing your video notes";
    if ((source === "upload" && upload) || source === "youtube") {
      setProcessing({
        title: processingTitle,
        progress: 7,
        stage: "Preparing your video",
        transcript: [],
        notes: [],
      });
    }
    try {
      const body = new FormData();
      body.set("kind", source);
      body.set("url", url);
      body.set("urls", extraUrls);
      body.set("language", language);
      if (upload) body.set("video", upload);
      let response = await fetch("/api/analyze", { method: "POST", body });
      let result = await response.json();
      const jobIds = () => (result.jobs || (result.job ? [result.job] : [])).map((job: { videoId?: string }) => job.videoId).filter(Boolean);
      if (response.status === 202 && jobIds().length) {
        for (let attempt = 0; attempt < 120 && response.status === 202; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          response = await fetch(`/api/analyze?videoIds=${encodeURIComponent(jobIds().join(","))}&language=${encodeURIComponent(language)}`, { cache: "no-store" });
          result = await response.json();
        }
        if (response.status === 202) throw new Error("Your video is still being prepared. Please try again in a moment.");
      }
      if (!response.ok)
        throw new Error(result.error || "Something went wrong.");
      const analyses = result.analyses || [result];
      const entry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        source,
        analyses,
        studyLanguage: language,
        summaries: { [`${language}:brief`]: analyses[0].summary },
      };
      persistHistory([entry, ...history].slice(0, 20));
      setActiveHistoryId(entry.id);
      setResumeAt(0);
      setBatch(analyses);
      setAnalysis(analyses[0]);
      setSummaries({ [`${language}:brief`]: analyses[0].summary });
      setSummaryMode("brief");
      setNoteStatus("notes generated");
      setMessages([]);
      setRange(null);
      setRangeStart(null);
      setPauseTime(null);
      setProcessing(null);
      sessionStorage.removeItem(activeAnalysisKey);
    } catch (reason) {
      setProcessing(null);
      sessionStorage.removeItem(activeAnalysisKey);
      setError(
        reason instanceof Error ? reason.message : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function loadSummary(mode: NoteMode) {
    setSummaryMode(mode);
    const key = `${language}:${mode}`;
    if (!analysis || summaries[key]) return;
    setNoteStatus(
      mode === "detailed" ? "Preparing detailed notes…" : mode === "deep" ? "Preparing a deep dive…" : "Preparing a summary…",
    );
    setNoteLoading(true);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: analysis.transcript,
          mode,
          language,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const nextSummaries = { ...summaries, [key]: result.summary };
      setSummaries(nextSummaries);
      setHistory((current) => {
        const next = current.map((entry) =>
          entry.id === activeHistoryId ? { ...entry, summaries: nextSummaries } : entry,
        );
        const updatedEntry = next.find((entry) => entry.id === activeHistoryId);
        if (user && updatedEntry) {
          void fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(updatedEntry),
          });
        }
        return next;
      });
    } catch (reason) {
      setNoteStatus(
        reason instanceof Error ? reason.message : "Could not generate notes.",
      );
      return;
    } finally {
      setNoteLoading(false);
    }
    setNoteStatus("");
  }
  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!analysis || !question.trim()) return;
    if (rangeStart !== null && !range) {
      setChatStatus("Mark an end or clear the selection first.");
      return;
    }
    const prompt = question.trim(),
      history = messages;
    setMessages((current) => [...current, { role: "user", content: prompt }]);
    setQuestion("");
    setChatStatus("Thinking…");
    setChatLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: prompt,
          segments: analysis.segments,
          history,
          start: range?.[0],
          end: range?.[1],
          pauseTime,
          language,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessages((current) => [
        ...current,
        { role: "assistant", content: result.answer },
      ]);
      setChatStatus("");
    } catch (reason) {
      setChatStatus(
        reason instanceof Error
          ? reason.message
          : "Could not answer the question.",
      );
      setQuestion(prompt);
    } finally {
      setChatLoading(false);
    }
  }
  const chooseAnalysis = (next: Analysis) => {
    setAnalysis(next);
    setSummaries({ [`${language}:brief`]: next.summary });
    setSummaryMode("brief");
    setMessages([]);
    setRange(null);
    setRangeStart(null);
    setPauseTime(null);
  };
  const renameStudyTitle = (title: string) => {
    const nextTitle = title.trim();
    if (!analysis || !nextTitle || nextTitle === analysis.title) return;
    const selectedIndex = Math.max(0, batch.findIndex((item) => item === analysis));
    const nextBatch = batch.map((item, index) =>
      index === selectedIndex ? { ...item, title: nextTitle } : item,
    );
    setBatch(nextBatch);
    setAnalysis(nextBatch[selectedIndex]);
    setHistory((current) => {
      const next = current.map((entry) =>
        entry.id === activeHistoryId ? { ...entry, analyses: nextBatch } : entry,
      );
      const renamedEntry = next.find((entry) => entry.id === activeHistoryId);
      if (user && renamedEntry) {
        void fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(renamedEntry),
        });
      }
      return next;
    });
  };
  if (user && analysis)
    return (
      <StudyWorkspace
        analysis={analysis}
        batch={batch}
        onChooseAnalysis={chooseAnalysis}
        onRenameTitle={renameStudyTitle}
        source={source}
        url={url}
        playerUrl={playerUrl}
        localPlayer={localPlayer}
        youtubePlayer={youtubePlayer}
        resumeAt={resumeAt}
        summary={summaries[`${language}:${summaryMode}`] || ""}
        summaryMode={summaryMode}
        noteStatus={noteStatus}
        noteLoading={noteLoading}
        studyId={activeHistoryId}
        onSelectSummary={(mode) => {
          setSummaryMode(mode);
          setNoteStatus("");
        }}
        onSummary={loadSummary}
        language={language}
        setLanguage={(next) => {
          setLanguage(next);
          setHistory((current) => {
            const updated = current.map((entry) => entry.id === activeHistoryId ? { ...entry, studyLanguage: next } : entry);
            const selected = updated.find((entry) => entry.id === activeHistoryId);
            if (user && selected) void fetch("/api/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selected) });
            return updated;
          });
        }}
        messages={messages}
        question={question}
        setQuestion={setQuestion}
        chatStatus={chatStatus}
        chatLoading={chatLoading}
        onAsk={ask}
        selectedLabel={selectedLabel}
        range={range}
        rangeStart={rangeStart}
        setRange={setRange}
        setRangeStart={setRangeStart}
        pauseTime={pauseTime}
        setPauseTime={setPauseTime}
        currentTime={currentTime}
        seekTo={seekTo}
        pause={pause}
        reset={() => {
          setAnalysis(null);
          setBatch([]);
          setActiveHistoryId(null);
          setResumeAt(0);
          setSource("youtube");
          sessionStorage.removeItem(activeAnalysisKey);
        }}
      />
    );
  if (user && processing)
    return <ProcessingWorkspace processing={processing} playerUrl={playerUrl} source={source as "youtube" | "upload"} url={url} youtubePlayer={youtubePlayer} />;
  if (!user) return <PublicLanding authMode={authMode} authOpen={authOpen} setAuthOpen={setAuthOpen} onAuthenticated={setUser} />;
  return (
    <main className="app-shell min-h-screen bg-[#f7f7f6] text-[#171a22]">
      <aside className="app-sidebar">
        <a className="app-brand" href="/"><span><ScanLine size={17} /></span>ClipNote</a>
        <button className={`new-study ${homeView === "study" ? "is-active" : ""}`} onClick={() => { setHomeView("study"); setAnalysis(null); setBatch([]); setProcessing(null); sessionStorage.removeItem(activeAnalysisKey); }}><Plus size={17} /> New study</button>
        <button className={`course-library-nav ${homeView === "courses" ? "is-active" : ""}`} onClick={() => { setCourseToOpen(null); setHomeView("courses"); }}><BookOpen size={17} /> Course library</button>
        <p className="sidebar-label">STUDY HISTORY</p>
        <div className="sidebar-history">
          {history.length ? history.map((entry) => {
            const title = historyTitle(entry);
            return (
              <button key={entry.id} onClick={() => openHistory(entry)} aria-label={title}>
                <History size={15} />
                <span title={title}>{title}</span>
              </button>
            );
          }) : <p className="sidebar-empty">Your completed studies will appear here.</p>}
        </div>
        <p className="sidebar-label">COURSE HISTORY</p>
        <div className="sidebar-history">
          {courseHistory.length ? courseHistory.map((entry) => {
            const title = `${entry.courseTitle} · Lecture ${entry.lectureOrdinal}`;
            return <button key={entry.courseId} onClick={() => { setCourseToOpen(entry.courseId); setHomeView("courses"); }} aria-label={`Resume ${title}`}><BookOpen size={15} /><span title={title}>{entry.courseTitle} · {formatTime(entry.positionSeconds)}</span></button>;
          }) : <p className="sidebar-empty">Your course progress will appear here.</p>}
        </div>
        <div className="sidebar-footer"><div className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><strong>{user.name}</strong><span>{user.email}</span></div><button aria-label="Sign out" onClick={signOut}><LogOut size={16} /></button></div>
      </aside>
      <div className="app-content">
      {homeView === "study" ? <section className="study-home mx-auto max-w-4xl px-5 pb-12 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
          Turn video into <span className="text-[#2367eb]">clarity.</span>
        </h1>
        <p className="mt-5 text-lg leading-8 text-[#676d78]">
          Browse a course or bring any lecture, tutorial, or conversation into focus.
          <br />
          Find the ideas that matter, then learn at your pace.
        </p>
        <div className="mt-11 flex w-full justify-center">
          <Card className="w-full max-w-2xl text-left shadow-[0_24px_65px_rgba(32,42,62,.08)]">
            <CardContent className="p-3">
              <Tabs
                value={source}
                onValueChange={(value) =>
                  setSource(value as "youtube" | "upload")
                }
              >
                <TabsList className="w-full justify-start rounded-none border-b border-[#e7e8eb] bg-transparent p-0">
                  <TabsTrigger value="youtube" className="rounded-none">
                    <Play className="mr-2 size-4 text-[#2367eb]" />
                    YouTube links
                  </TabsTrigger>
                  <TabsTrigger value="upload" className="rounded-none">
                    <Upload className="mr-2 size-4" />
                    Upload video
                  </TabsTrigger>
                </TabsList>
                <form onSubmit={analyze} className="p-4">
                  <TabsContent value="youtube">
                    <label className="mb-2 block text-sm font-bold">
                      YouTube video URL
                    </label>
                    <div className="flex gap-2">
                      <LinkIcon className="mt-3 size-5 shrink-0 text-[#9a9faa]" />
                      <Input
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                        placeholder="Paste a YouTube video link"
                      />
                    </div>
                    <label className="mb-2 mt-4 block text-sm font-bold">
                      More videos{" "}
                      <span className="font-normal text-[#8b919d]">
                        (optional)
                      </span>
                    </label>
                    <Textarea
                      value={extraUrls}
                      onChange={(event) => setExtraUrls(event.target.value)}
                      placeholder="One YouTube link per line — up to 20 videos total"
                      className="min-h-24"
                    />
                    <p className="mt-2 text-xs text-[#8b919d]">
                      Analyze up to 20 individual YouTube videos in one study session.
                      in one study session.
                    </p>
                  </TabsContent>
                  <TabsContent value="upload">
                    <label className="flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-[#b9cdf5] bg-[#f4f7ff] px-6 py-8 text-center">
                      <FileUp className="mb-2 text-[#2367eb]" />
                      <strong>
                        {file?.name || "Choose a video or drag it here"}
                      </strong>
                      <span className="mt-1 text-xs text-[#737987]">
                        MP4, MOV, WebM and more · Up to 500 MB
                      </span>
                      <input
                        className="sr-only"
                        type="file"
                        accept="video/*"
                        onChange={(event: ChangeEvent<HTMLInputElement>) => {
                          const nextFile = event.target.files?.[0] || null;
                          setFile(nextFile);
                          if (nextFile) void analyze(undefined, nextFile);
                        }}
                      />
                    </label>
                  </TabsContent>
                  <label className="mt-4 flex items-center justify-between gap-3 text-sm font-bold">
                    Notes language{" "}
                    <select
                      value={language}
                      onChange={(event) => setLanguage(event.target.value)}
                      className="rounded-lg border border-[#dfe2e7] bg-white px-3 py-2 text-sm font-medium"
                    >
                      <option>English</option>
                      <option>Spanish</option>
                      <option>French</option>
                      <option>German</option>
                      <option>Hindi</option>
                      <option>Japanese</option>
                      <option>Korean</option>
                      <option>Portuguese</option>
                      <option>Chinese (Simplified)</option>
                    </select>
                  </label>
                  <Button
                    className="mt-5 w-full"
                    type="submit"
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 animate-spin" />
                        Analyzing video…
                      </>
                    ) : (
                      <>
                        <Sparkles className="mr-2" />
                        Generate summary <ArrowRight className="ml-auto" />
                      </>
                    )}
                  </Button>
                  {loading && (
                    <p className="mt-3 text-center text-sm text-[#737987]">
                      Transcribing and preparing your notes. Longer videos can
                      take several minutes.
                    </p>
                  )}
                  {error && (
                    <p className="mt-3 text-sm text-rose-600">{error}</p>
                  )}
                </form>
              </Tabs>
            </CardContent>
          </Card>
        </div>
        <p className="mt-7 text-sm text-[#8b919d]">
          Made for curious minds · From hours to insights
        </p>
      </section> : <LibraryBrowser onReady={openLibraryAnalysis} onStarted={() => { void fetch("/api/library/history").then((response) => response.json()).then((result) => { if (Array.isArray(result.courses)) setCourseHistory(result.courses); }); }} openCourseId={courseToOpen} />}
      {homeView === "study" && history.length > 0 && (
        <section className="mx-auto max-w-4xl px-5 pb-16">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold tracking-[.14em] text-[#2367eb]">
                ON THIS DEVICE
              </p>
              <h2 className="mt-1 text-2xl font-bold">Recent generations</h2>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeHistory()}
            >
              Clear history
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {history.map((entry) => (
              <Card key={entry.id}>
                <CardContent className="flex items-start gap-3 p-4">
                  <History className="mt-1 size-4 shrink-0 text-[#2367eb]" />
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openHistory(entry)}
                  >
                    <strong className="block truncate">
                      {entry.analyses.length > 1
                        ? `${entry.analyses.length} videos`
                        : entry.analyses[0]?.title || "Untitled video"}
                    </strong>
                    <span className="mt-1 block text-xs text-[#737987]">
                      {new Date(entry.createdAt).toLocaleString()} ·{" "}
                      {entry.source === "youtube" ? "YouTube" : entry.source === "upload" ? "Uploaded video" : "NPTEL"}
                    </span>
                  </button>
                  <Button
                    aria-label="Delete history entry"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeHistory(entry.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
      <HowItWorks />
      </div>
    </main>
  );
}

function Header({ user }: { user?: User }) {
  return (
    <header className="flex h-20 items-center justify-between border-b border-[#e6e7e9] bg-[#fafafa]/90 px-[6%] backdrop-blur">
      <a
        className="flex items-center gap-2 text-xl font-bold tracking-tight"
        href="/"
      >
        <span className="grid size-8 place-items-center rounded-[10px] bg-[#10131c] text-white">
          <ScanLine size={17} />
        </span>
        ClipNote
      </a>
      <nav className="hidden gap-8 text-sm font-semibold text-[#676d78] sm:flex">
        <a className="transition-colors hover:text-[#171a22]" href="#how">
          How it works
        </a>
        <a className="transition-colors hover:text-[#171a22]" href="#features">
          Features
        </a>
      </nav>
      <span className="hidden rounded-full border border-[#e2e4e8] bg-white px-4 py-2 text-xs font-semibold text-[#676d78] sm:block">{user ? "Your study space" : "Your learning companion"}</span>
    </header>
  );
}

function PublicLanding({ authMode, authOpen, setAuthOpen, onAuthenticated }: { authMode: "local" | "code"; authOpen: boolean; setAuthOpen: (value: boolean) => void; onAuthenticated: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("local user");
  const [accessCode, setAccessCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const signIn = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(authMode === "code" ? { username, email, accessCode } : { email: email || "local@mail.com", name }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || "Sign-in service is temporarily unavailable. Please try again.");
      if (!result?.user) throw new Error("Could not sign you in. Please try again.");
      onAuthenticated(result.user); setAccessCode(""); setAuthOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sign you in."); }
    finally { setLoading(false); }
  };
  return <main className="public-landing min-h-screen">
    <Header />
    <section className="landing-hero">
      <div className="landing-copy"><div className="eyebrow"><Sparkles size={14} /> A clearer way to learn</div><h1>Turn lectures into <span>understanding.</span></h1><p>Explore NPTEL lectures, paste a YouTube link, or upload a video. Leave with clear notes and ways to test what you learned.</p><div className="landing-actions"><button className="primary-cta" onClick={() => setAuthOpen(true)}>Start learning <ArrowRight size={17} /></button><a href="#how">See how it works</a></div></div>
      <div className="landing-preview"><div className="preview-sidebar"><div className="preview-logo"><ScanLine size={15} /></div><div className="preview-plus"><Plus size={14} /> New study</div><small>RECENT</small><div className="preview-item active"><Video size={14} /> Neural networks</div><div className="preview-item"><Video size={14} /> Design thinking</div><div className="preview-user">A</div></div><div className="preview-main"><div className="preview-kicker">WELCOME BACK, ALEX</div><h2>What are we learning today?</h2><div className="preview-input"><LinkIcon size={18} /><span>Browse courses, paste a link, or upload</span><button><ArrowRight size={17} /></button></div><div className="preview-cards"><div><Sparkles size={17} /><strong>Clean notes</strong><span>Find the important ideas</span></div><div><MessageCircle size={17} /><strong>Ask anything</strong><span>Learn in your own words</span></div></div></div></div>
    </section>
    <section id="how" className="landing-steps"><p className="eyebrow">DESIGNED FOR DEEPER LEARNING</p><h2>From video to a study plan in minutes.</h2><div>{[["01", "Add a source", "Browse a course, paste a YouTube link, or upload your lecture."], ["02", "Make it clear", "Get focused notes and a searchable transcript."], ["03", "Keep learning", "Ask questions, take a quiz, and explore a concept map."]].map(([number, title, copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
    <section className="landing-sources"><p className="eyebrow">LEARNING SOURCES</p><h2>Explore more ways to learn.</h2><p>Browse course material from <a href="https://nptel.ac.in/" target="_blank" rel="noreferrer">NPTEL</a>, or bring your own lecture. ClipNote is an independent study tool; source credit and original links accompany each course.</p></section>
    {authOpen && <div className="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="login-title"><form className="auth-card" onSubmit={signIn}><button type="button" className="auth-close" onClick={() => setAuthOpen(false)} aria-label="Close sign in">×</button><span className="auth-logo"><ScanLine size={20} /></span><p className="eyebrow">{authMode === "code" ? "ACCESS CODE SIGN IN" : "LOCAL DEVELOPMENT LOGIN"}</p><h2 id="login-title">Start your study space.</h2><p className="auth-copy">{authMode === "code" ? "Choose a username and enter your email with the five-digit access code you received. Use the same details to return." : "A demo account is ready for local testing. Your login and saved studies persist on this device."}</p>{authMode === "local" && <label>Name <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="local user" required /></label>}{authMode === "code" && <label>Username <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="yourname" autoComplete="username" required /></label>}<label>Email <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder={authMode === "code" ? "you@example.com" : "local@mail.com"} type="email" autoComplete="email" required={authMode === "code"} /></label>{authMode === "code" && <label>Access code <Input value={accessCode} onChange={(event) => setAccessCode(event.target.value)} type="password" inputMode="numeric" pattern="[0-9]{5}" maxLength={5} autoComplete="current-password" required /></label>}{error && <p className="auth-error">{error}</p>}<Button type="submit" disabled={loading}>{loading ? "Signing in…" : authMode === "code" ? "Continue" : "Sign in as local user"}<ArrowRight className="ml-auto" size={17} /></Button>{authMode === "local" && <small>Local testing account: local user · local@mail.com</small>}</form></div>}
  </main>;
}
function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 pb-24 text-center">
      <p className="text-xs font-bold tracking-[.15em] text-[#2367eb]">
        A LITTLE LESS WATCHING. A LOT MORE LEARNING.
      </p>
      <h2 className="mt-3 text-3xl font-bold">
        From video to clarity in three steps.
      </h2>
      <div className="mt-10 grid gap-5 text-left md:grid-cols-3">
        {[
          [
            "01",
            "Choose a lecture",
            "Browse the course library, paste a YouTube link, or upload a video.",
          ],
          [
            "02",
            "Let AI get to work",
            "We transcribe the audio and find the ideas that matter.",
          ],
          [
            "03",
            "Learn at your pace",
            "Explore notes, ask questions, take a quiz, and connect concepts.",
          ],
        ].map(([number, title, copy]) => (
          <Card key={number}>
            <CardContent>
              <span className="text-sm font-bold text-[#2367eb]">{number}</span>
              <h3 className="mt-6 text-lg font-bold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-[#737987]">{copy}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

type WorkspaceProps = {
  analysis: Analysis;
  batch: Analysis[];
  onChooseAnalysis: (analysis: Analysis) => void;
  onRenameTitle: (title: string) => void;
  source: Source;
  url: string;
  playerUrl: string;
  localPlayer: React.RefObject<HTMLVideoElement | null>;
  youtubePlayer: React.MutableRefObject<YouTubePlayer | null>;
  resumeAt: number;
  summary: string;
  summaryMode: NoteMode;
  noteStatus: string;
  noteLoading: boolean;
  studyId: string | null;
  onSelectSummary: (mode: NoteMode) => void;
  onSummary: (mode: NoteMode) => void;
  language: string;
  setLanguage: (language: string) => void;
  messages: ChatMessage[];
  question: string;
  setQuestion: (value: string) => void;
  chatStatus: string;
  chatLoading: boolean;
  onAsk: (event: FormEvent) => void;
  selectedLabel: string;
  range: [number, number] | null;
  rangeStart: number | null;
  setRange: (value: [number, number] | null) => void;
  setRangeStart: (value: number | null) => void;
  pauseTime: number | null;
  setPauseTime: (value: number | null) => void;
  currentTime: () => number;
  seekTo: (time: number) => void;
  pause: () => void;
  reset: () => void;
};
function ProcessingWorkspace({
  processing,
  playerUrl,
  source,
  url,
  youtubePlayer,
}: {
  processing: ProcessingState;
  playerUrl: string;
  source: "youtube" | "upload";
  url: string;
  youtubePlayer: React.MutableRefObject<YouTubePlayer | null>;
}) {
  return (
    <main className="study-workspace processing-workspace min-h-screen" aria-live="polite">
      <header className="workspace-header">
        <div className="workspace-title-wrap">
          <p>GENERATING STUDY MATERIALS</p>
          <strong className="workspace-title">{processing.title}</strong>
        </div>
        <div className="workspace-actions processing-header-status">
          <Loader2 size={15} /> <span>{processing.stage}</span>
        </div>
      </header>
      <div className="workspace-grid" style={{ "--video-pane-width": "43%" } as CSSProperties}>
        <aside className="video-column processing-video-column">
          <div className="video-frame">
            {source === "upload" && playerUrl ? (
              <video src={playerUrl} controls className="h-full w-full" />
            ) : source === "youtube" && videoId(url) ? (
              <YouTubePlayerFrame id={videoId(url)!} playerRef={youtubePlayer} />
            ) : <div className="processing-video-placeholder"><Video size={28} /></div>}
          </div>
          <div className="processing-progress-card">
            <div className="processing-progress-label"><span><Loader2 size={15} /> {processing.stage}</span><strong>{processing.progress}%</strong></div>
            <div className="processing-progress"><span style={{ width: `${processing.progress}%` }} /></div>
            <p>Your transcript will appear as each section is processed.</p>
          </div>
          <div className="video-text-flow processing-transcript-flow">
            <div className="transcript-heading"><div><FileText size={16} /><strong>Live transcript</strong><span>{processing.transcript.length} moments found</span></div></div>
            <div className="transcript-scroll">
              {processing.transcript.map((segment, index) => <div className="transcript-row processing-row" key={segment.start}><time>{formatTime(segment.start)}</time><span>{segment.text}</span>{index === processing.transcript.length - 1 && <i />}</div>)}
              {!processing.transcript.length && <div className="processing-empty">Listening for the first spoken section…</div>}
            </div>
          </div>
        </aside>
        <div className="workspace-resizer"><span /></div>
        <section className="notes-column">
          <div className="notes-topbar">
            <div className="workspace-tabs"><button data-state="active"><FileText size={16} /> AI Notes</button><button disabled><Bot size={16} /> AI Chat</button></div>
            <span className="live-badge"><span /> Live generation</span>
          </div>
          <article className="notes-card processing-notes-card">
            <div className="notes-card-head"><div><p>NOTES IN PROGRESS</p><h1>Building your notes</h1></div><div className="note-badge"><Loader2 size={13} /> Updating live</div></div>
            {processing.notes.length ? <div className="study-notes processing-notes"><ReactMarkdown remarkPlugins={[remarkGfm]}>{processing.notes.join("\n\n")}</ReactMarkdown><span className="writing-cursor" /></div> : <div className="notes-empty"><BrainCircuit size={28} /><p>Reading the opening section and finding the main ideas…</p></div>}
          </article>
        </section>
      </div>
    </main>
  );
}
function StudyWorkspace(props: WorkspaceProps) {
  const {
    analysis,
    batch,
    onChooseAnalysis,
    onRenameTitle,
    source,
    url,
    playerUrl,
    localPlayer,
    youtubePlayer,
    resumeAt,
    summary,
    summaryMode,
    noteStatus,
    noteLoading,
    studyId,
    onSelectSummary,
    onSummary,
    language,
    setLanguage,
    messages,
    question,
    setQuestion,
    chatStatus,
    chatLoading,
    onAsk,
    selectedLabel,
    range,
    rangeStart,
    setRange,
    setRangeStart,
    pauseTime,
    setPauseTime,
    currentTime,
    seekTo,
    pause,
    reset,
  } = props;
  const [panel, setPanel] = useState("notes");
  const [videoTextView, setVideoTextView] = useState<
    "transcript" | "subtitles" | "chapters"
  >("transcript");
  const [videoPaneWidth, setVideoPaneWidth] = useState(43);
  const [videoPlayerHeight, setVideoPlayerHeight] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(analysis.title);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [isListening, setIsListening] = useState(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  useEffect(() => setTitleDraft(analysis.title), [analysis.title]);
  useEffect(() => {
    if (messages.at(-1)?.role !== "assistant") return;
    const frame = window.requestAnimationFrame(() => {
      chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages]);
  useEffect(() => {
    if (editingTitle) titleInput.current?.focus();
  }, [editingTitle]);
  useEffect(() => {
    if (pauseTime === null) return;
    const frame = window.requestAnimationFrame(() => questionInput.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pauseTime]);
  useEffect(() => () => recorder.current?.stop(), []);
  const workspaceGrid = useRef<HTMLDivElement>(null);
  const videoColumn = useRef<HTMLElement>(null);
  useEffect(() => {
    const saved = Number(localStorage.getItem("clipnote-video-pane-width"));
    if (Number.isFinite(saved) && saved >= 30 && saved <= 65) setVideoPaneWidth(saved);
    // A newly opened study should always begin at the natural 16:9 size.
    // Resizing remains available within the current session, but no previously
    // collapsed player is restored into a new study.
    localStorage.removeItem("clipnote-video-player-height");
  }, []);
  const resizePane = (clientX: number) => {
    const bounds = workspaceGrid.current?.getBoundingClientRect();
    if (!bounds) return;
    const next = Math.min(65, Math.max(30, ((clientX - bounds.left) / bounds.width) * 100));
    setVideoPaneWidth(next);
    localStorage.setItem("clipnote-video-pane-width", String(next));
  };
  const resizePlayer = (clientY: number) => {
    const bounds = videoColumn.current?.getBoundingClientRect();
    if (!bounds) return;
    const next = Math.min(
      Math.max(180, Math.round(clientY - bounds.top)),
      Math.max(180, Math.round(bounds.height - 260)),
    );
    setVideoPlayerHeight(next);
    localStorage.setItem("clipnote-video-player-height", String(next));
  };
  const adjustPlayerHeight = (amount: number) => {
    const maximum = Math.max(180, (videoColumn.current?.clientHeight || 540) - 260);
    setVideoPlayerHeight((current) => {
      const next = Math.min(Math.max(180, (current || 280) + amount), maximum);
      localStorage.setItem("clipnote-video-player-height", String(next));
      return next;
    });
  };
  const resetPlayerHeight = () => {
    setVideoPlayerHeight(null);
    localStorage.removeItem("clipnote-video-player-height");
  };
  const chapters = chaptersFromSegments(analysis.segments);
  const moments = transcriptMoments(analysis.segments);
  const jump = (time: number) => seekTo(time);
  const markStart = () => {
    setRangeStart(currentTime());
    setRange(null);
    setPauseTime(null);
  };
  const markEnd = () => {
    const end = currentTime();
    if (rangeStart === null || end < rangeStart) return;
    setRange([rangeStart, end]);
    setPauseTime(null);
    setPanel("chat");
  };
  const pauseAndAsk = () => {
    const now = currentTime();
    pause();
    setRange([Math.max(0, now - 45), now + 45]);
    setRangeStart(null);
    setPauseTime(now);
    setPanel("chat");
  };
  const dictateQuestion = async () => {
    if (isListening) {
      recorder.current?.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setVoiceStatus("Voice recording is not supported in this browser. Please type your question instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: BlobPart[] = [];
      const next = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : undefined });
      recorder.current = next;
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      next.onerror = () => setVoiceStatus("We could not record that. Please try again or type your question.");
      next.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        recorder.current = null;
        setIsListening(false);
        const audio = new Blob(chunks, { type: next.mimeType || "audio/webm" });
        if (!audio.size) return;
        setVoiceStatus("Transcribing your question…");
        try {
          const form = new FormData();
          form.set("audio", audio, "question.webm");
          form.set("language", speechLanguages[language] || "en");
          const response = await fetch("/api/transcribe", { method: "POST", body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Could not transcribe your question.");
          const transcript = typeof result.text === "string" ? result.text.trim() : "";
          if (!transcript) throw new Error("We could not hear any speech. Please try again.");
          setQuestion(question ? `${question} ${transcript}` : transcript);
          setVoiceStatus("");
          questionInput.current?.focus();
        } catch (error) {
          setVoiceStatus(error instanceof Error ? error.message : "Could not transcribe your question.");
        }
      };
      setVoiceStatus(`Recording in ${language}… tap again when you are done.`);
      setIsListening(true);
      next.start();
    } catch {
      setVoiceStatus("Microphone permission was not granted.");
    }
  };
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).catch(() => undefined);
  const subtitles = `WEBVTT\n\n${analysis.segments
    .map(
      (segment) =>
        `${formatVttTime(segment.start)} --> ${formatVttTime(segment.end)}\n${segment.text}`,
    )
    .join("\n\n")}`;
  const download = (extension: "txt" | "vtt", text: string) => {
    const fileName =
      analysis.title
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/(^-|-$)/g, "")
        .toLowerCase() || "video";
    const credit = analysis.attribution ? `Source: ${analysis.attribution.name} — Course: ${analysis.attribution.url}${analysis.attribution.lectureUrl ? ` — Lecture: ${analysis.attribution.lectureUrl}` : ""}${analysis.attribution.licenseUrl ? ` — License: ${analysis.attribution.licenseUrl}` : ""}` : "";
    const exported = credit ? extension === "vtt" ? `${text}\n\nNOTE ${credit}\n` : `${text}\n\n${credit}\n` : text;
    const url = URL.createObjectURL(
      new Blob([exported], { type: extension === "vtt" ? "text/vtt" : "text/plain" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}-${videoTextView}.${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const activeUrl = analysis.sourceUrl || url;
  const modeLabel = summaryMode === "brief" ? "Summary" : summaryMode === "detailed" ? "Detailed notes" : "Deep dive";
  const isGeneratingNotes = noteLoading;
  const saveTitle = () => {
    const nextTitle = titleDraft.trim();
    if (nextTitle) onRenameTitle(nextTitle);
    else setTitleDraft(analysis.title);
    setEditingTitle(false);
  };
  return (
    <main className="study-workspace min-h-screen">
      <header className="workspace-header">
        <button className="workspace-back" onClick={reset}>
          ← <span>Back</span>
        </button>
        {editingTitle ? (
          <input
            ref={titleInput}
            className="workspace-title-input"
            value={titleDraft}
            aria-label="Study title"
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setTitleDraft(analysis.title);
                setEditingTitle(false);
              }
            }}
          />
        ) : batch.length > 1 ? (
          <select
            aria-label="Choose analyzed video"
            className="workspace-title-select"
            value={analysis.title}
            onChange={(event) => {
              const next = batch.find(
                (item) => item.title === event.target.value,
              );
              if (next) onChooseAnalysis(next);
            }}
          >
            {batch.map((item, index) => (
              <option key={`${item.title}-${index}`}>{item.title}</option>
            ))}
          </select>
        ) : (
          <strong className="workspace-title">{analysis.title}</strong>
        )}
        {!editingTitle && (
          <button className="workspace-title-edit" type="button" onClick={() => setEditingTitle(true)} aria-label="Rename study title" title="Rename study">
            <Pencil size={15} />
          </button>
        )}
        <div className="workspace-actions">
          <span className="workspace-status">
            <span /> Ready to study
          </span>
          <button onClick={reset}>+ New</button>
        </div>
      </header>
      {analysis.attribution && <div className="workspace-credit"><span>Source: {analysis.attribution.name} · <a href={analysis.attribution.url} target="_blank" rel="noreferrer">Original course ↗</a>{analysis.attribution.lectureUrl && <> · <a href={analysis.attribution.lectureUrl} target="_blank" rel="noreferrer">Original lecture ↗</a></>}</span>{analysis.attribution.licenseUrl && <a href={analysis.attribution.licenseUrl} target="_blank" rel="noreferrer">License</a>}</div>}
      <div
        ref={workspaceGrid}
        className="workspace-grid"
        style={{ "--video-pane-width": `${videoPaneWidth}%` } as CSSProperties}
      >
        <aside ref={videoColumn} className="video-column">
          <div
            className="video-frame"
            style={videoPlayerHeight ? { height: `${videoPlayerHeight}px` } : undefined}
          >
            {source === "upload" || !!analysis.playbackUrl ? (
              <video
                ref={localPlayer}
                src={source === "upload" ? playerUrl : analysis.playbackUrl}
                controls
                className="h-full w-full"
                onLoadedMetadata={(event) => { if (resumeAt > 0) event.currentTarget.currentTime = resumeAt; }}
              />
            ) : videoId(activeUrl) ? (
              <YouTubePlayerFrame
                id={videoId(activeUrl)!}
                playerRef={youtubePlayer}
                resumeAt={resumeAt}
              />
            ) : (
              <div className="grid h-full place-items-center bg-slate-900 p-5 text-center text-white"><div>Play this lecture at its original source.<br /><a href={activeUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block font-semibold text-blue-300 underline">Open lecture ↗</a></div></div>
            )}
          </div>
          <div
            className="player-resizer"
            role="separator"
            aria-label="Resize video player"
            aria-orientation="horizontal"
            aria-valuetext={videoPlayerHeight ? `Video player height ${videoPlayerHeight} pixels` : "Video player uses its default size"}
            tabIndex={0}
            onDoubleClick={resetPlayerHeight}
            onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) resizePlayer(event.clientY);
            }}
            onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                adjustPlayerHeight(-20);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                adjustPlayerHeight(20);
              }
              if (event.key === "Home") resetPlayerHeight();
            }}
          >
            <span aria-hidden="true" />
          </div>
          <div className="context-actions">
            <button onClick={pauseAndAsk}>
              <MessageCircle size={15} /> Pause & ask
            </button>
            <button onClick={markStart}>Mark start</button>
            <button onClick={markEnd}>Mark end</button>
            {(range || rangeStart !== null) && (
              <button
                className="quiet"
                onClick={() => {
                  setRange(null);
                  setRangeStart(null);
                  setPauseTime(null);
                }}
              >
                Clear
              </button>
            )}
          </div>
          <p className="selection-copy">{selectedLabel}</p>
          <div className="video-text-flow">
            <div className="video-text-tabs" role="tablist" aria-label="Video text">
              <button className={videoTextView === "transcript" ? "active" : ""} role="tab" aria-selected={videoTextView === "transcript"} onClick={() => setVideoTextView("transcript")}><FileText size={15} /> Transcript</button>
              <button className={videoTextView === "subtitles" ? "active" : ""} role="tab" aria-selected={videoTextView === "subtitles"} onClick={() => setVideoTextView("subtitles")}><Captions size={15} /> Subtitles</button>
              <button className={videoTextView === "chapters" ? "active" : ""} role="tab" aria-selected={videoTextView === "chapters"} onClick={() => setVideoTextView("chapters")}><ListVideo size={15} /> Chapters</button>
              <button className="video-text-download" aria-label={`Download ${videoTextView}`} onClick={() => download(videoTextView === "subtitles" ? "vtt" : "txt", videoTextView === "transcript" ? analysis.transcript : videoTextView === "subtitles" ? subtitles : chapters.map((chapter) => `${formatTime(chapter.start)} ${chapter.title}\n${chapter.detail}`).join("\n\n"))}><Download size={15} /></button>
            </div>
            <div className="transcript-heading">
              <div>
                {videoTextView === "transcript" ? <FileText size={16} /> : videoTextView === "subtitles" ? <Captions size={16} /> : <ListVideo size={16} />}
                <strong>{videoTextView === "transcript" ? "Transcript" : videoTextView === "subtitles" ? "Subtitles" : "Chapters"}</strong>
                <span>{videoTextView === "chapters" ? `${chapters.length} chapters` : videoTextView === "transcript" ? `${moments.length} moments` : `${analysis.segments.length} captions`}</span>
              </div>
              {videoTextView === "transcript" && <button aria-label="Copy transcript" onClick={() => copy(analysis.transcript)}><Clipboard size={15} /> Copy</button>}
            </div>
            <div className="transcript-scroll">
              {videoTextView === "transcript" && moments.map((moment, index) => <button className="transcript-row" key={`${moment.start}-${index}`} onClick={() => jump(moment.start)}><time>{formatTime(moment.start)}</time><span>{moment.text}</span></button>)}
              {videoTextView === "subtitles" && analysis.segments.map((segment, index) => <button className="subtitle-row" key={`${segment.start}-${index}`} onClick={() => jump(segment.start)}><time>{formatTime(segment.start)} – {formatTime(segment.end)}</time><span>{segment.text}</span></button>)}
              {videoTextView === "chapters" && chapters.map((chapter) => <button className="chapter-row" key={chapter.start} onClick={() => jump(chapter.start)}><time>{formatTime(chapter.start)} – {formatTime(chapter.end)}</time><strong>{chapter.title}</strong><span>{chapter.detail}</span></button>)}
            </div>
          </div>
        </aside>
        <div
          className="workspace-resizer"
          role="separator"
          aria-label="Resize video and notes panes"
          aria-orientation="vertical"
          tabIndex={0}
          onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) resizePane(event.clientX);
          }}
          onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") setVideoPaneWidth((current) => Math.max(30, current - 2));
            if (event.key === "ArrowRight") setVideoPaneWidth((current) => Math.min(65, current + 2));
          }}
        >
          <span />
        </div>
        <section className="notes-column">
          <Tabs value={panel} onValueChange={setPanel}>
            <div className="notes-topbar">
              <TabsList className="workspace-tabs">
                <TabsTrigger value="notes">
                  <FileText size={16} /> AI Notes
                </TabsTrigger>
                <TabsTrigger value="chat">
                  <Bot size={16} /> AI Chat
                </TabsTrigger>
                <TabsTrigger value="quiz">Quiz</TabsTrigger>
                <TabsTrigger value="concept_map">Concept map</TabsTrigger>
              </TabsList>
              <select
                aria-label="Study language"
                value={language}
                onChange={(event) => setLanguage(event.target.value)}
              >
                <option>English</option>
                <option>Spanish</option>
                <option>French</option>
                <option>German</option>
                <option>Hindi</option>
                <option>Japanese</option>
                <option>Korean</option>
                <option>Portuguese</option>
                <option>Chinese (Simplified)</option>
              </select>
            </div>
            <TabsContent value="notes">
              <div className="note-tools">
                <button
                  className={summaryMode === "brief" ? "active" : ""}
                  onClick={() => onSelectSummary("brief")}
                  disabled={isGeneratingNotes}
                >
                  <FileText size={18} />
                  <span>
                    Summary<small>Essential ideas</small>
                  </span>
                </button>
                <button
                  className={summaryMode === "detailed" ? "active" : ""}
                  onClick={() => onSelectSummary("detailed")}
                  disabled={isGeneratingNotes}
                >
                  <FileText size={18} />
                  <span>
                    Detailed notes<small>Complete study guide</small>
                  </span>
                </button>
                <button
                  className={summaryMode === "deep" ? "active" : ""}
                  onClick={() => onSelectSummary("deep")}
                  disabled={isGeneratingNotes}
                >
                  <BrainCircuit size={18} />
                  <span>
                    Deep dive<small>Concepts & reasoning</small>
                  </span>
                </button>
                <button onClick={() => setPanel("chat")}>
                  <MessageCircle size={18} />
                  <span>
                    Ask AI<small>Discuss the video</small>
                  </span>
                </button>
                <button onClick={() => copy(analysis.attribution ? `${summary}\n\nSource: ${analysis.attribution.name}\nCourse: ${analysis.attribution.url}${analysis.attribution.lectureUrl ? `\nLecture: ${analysis.attribution.lectureUrl}` : ""}${analysis.attribution.licenseUrl ? `\nLicense: ${analysis.attribution.licenseUrl}` : ""}` : summary)}>
                  <Clipboard size={18} />
                  <span>
                    Copy notes<small>Save to clipboard</small>
                  </span>
                </button>
              </div>
              <article className="notes-card">
                <div className="notes-card-head">
                  <div>
                    <p>AI GENERATED NOTES</p>
                    <h1>{modeLabel}</h1>
                  </div>
                  <div className="note-badge">
                    <Check size={13} /> Based on transcript
                  </div>
                </div>
                {isGeneratingNotes ? (
                  <NotesGenerationLoader mode={summaryMode} />
                ) : summary ? (
                  <div className="study-notes">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                    >
                      {normalizeMathDelimiters(summary)}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="notes-empty">
                    <BrainCircuit size={28} />
                    <p>
                      {summaryMode === "detailed"
                        ? "Generate a complete study guide from this transcript."
                        : summaryMode === "deep"
                          ? "Generate a deeper explanation of the concepts and reasoning."
                          : "Generate a summary from this transcript."}
                    </p>
                    <button
                      className="generate-notes-button"
                      type="button"
                      onClick={() => onSummary(summaryMode)}
                      disabled={isGeneratingNotes}
                    >
                      {summaryMode === "detailed"
                        ? "Generate detailed notes"
                        : summaryMode === "deep"
                          ? "Generate deep dive"
                          : "Generate summary"}
                    </button>
                  </div>
                )}
                {noteStatus && (
                  <p className={isGeneratingNotes ? "sr-only" : "note-status"}>
                    {noteStatus}
                  </p>
                )}
              </article>
            </TabsContent>
            <TabsContent value="quiz"><StudyTools kind="quiz" studyId={studyId} lectureKey={analysis.lectureId || analysis.sourceUrl || analysis.transcript.slice(0, 50)} language={language} seekTo={seekTo} /></TabsContent>
            <TabsContent value="concept_map"><StudyTools kind="concept_map" studyId={studyId} lectureKey={analysis.lectureId || analysis.sourceUrl || analysis.transcript.slice(0, 50)} language={language} seekTo={seekTo} /></TabsContent>
            <TabsContent value="chat">
              <div className="chat-shell">
                <div className="chat-intro">
                  <span>
                    <Bot size={20} />
                  </span>
                  <div>
                    <p>VIDEO STUDY ASSISTANT</p>
                    <h2>Ask anything about this video.</h2>
                    <small>
                      Answers are grounded in the transcript and your selected
                      range.
                    </small>
                  </div>
                </div>
                <div className="chat-suggestions">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setQuestion(suggestion)}
                    >
                      {suggestion}
                      <ArrowRight size={15} />
                    </button>
                  ))}
                </div>
                <div className="chat-messages">
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={
                        message.role === "user"
                          ? "user-message"
                          : "assistant-message"
                      }
                    >
                      {message.role === "assistant" ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkMath]}
                          rehypePlugins={[rehypeKatex]}
                        >
                          {normalizeMathDelimiters(message.content)}
                        </ReactMarkdown>
                      ) : (
                        message.content
                      )}
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="assistant-thinking" role="status" aria-label="AI is thinking">
                      <span />
                      <span />
                      <span />
                    </div>
                  )}
                  <div ref={chatEnd} className="chat-end" aria-hidden="true" />
                </div>
                <form className="ask-form" onSubmit={onAsk}>
                  <Textarea
                    ref={questionInput}
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder={pauseTime !== null ? `Ask about what you just paused at ${formatTime(pauseTime)}…` : "Ask a follow-up question…"}
                    disabled={chatLoading}
                  />
                  <div>
                    <span>
                      {pauseTime !== null
                        ? `Paused at ${formatTime(pauseTime)} · using nearby transcript`
                        : range
                        ? `Using ${formatTime(range[0])}–${formatTime(range[1])}`
                        : "Using the full video"}
                    </span>
                    <button
                      className={`voice-question-button${isListening ? " is-listening" : ""}`}
                      type="button"
                      onClick={dictateQuestion}
                      disabled={chatLoading}
                      aria-label={isListening ? "Stop listening" : `Ask with your voice in ${language}`}
                      title={isListening ? "Stop listening" : `Ask with your voice in ${language}`}
                    >
                      <Mic size={16} />
                    </button>
                    <button type="submit" aria-label="Send question" disabled={chatLoading}>
                      <Send size={17} />
                    </button>
                  </div>
                  {(chatStatus || voiceStatus) && !chatLoading && <p role="status">{chatStatus || voiceStatus}</p>}
                </form>
              </div>
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </main>
  );
}
