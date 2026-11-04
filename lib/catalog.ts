import { createHash } from "crypto";
import { CatalogLecture, courseCount, deleteStaleLectures, getCourse, scheduleCatalogRefresh, upsertCourse, upsertLecture } from "@/lib/db";

const NPTEL = "https://nptel.ac.in";
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const idFor = (prefix: string, url: string) => `${prefix}:${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
const textFromMeta = (html: string, key: string) => {
  const tag = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i"))?.[0];
  return decode(tag?.match(/content=["']([^"']*)["']/i)?.[1] || "");
};
async function fetchText(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "ClipNoteCourseCatalog/1.0 (educational catalogue index)" }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Catalogue source returned ${response.status}: ${url}`);
  return response.text();
}

export async function refreshCatalog() {
  const errors: string[] = [];
  let imported = 0;
  try {
    const html = await fetchText(`${NPTEL}/courses`);
    const disciplineBlock = html.match(/disciplines:\[([\s\S]*?)\],institutes:\[/)?.[1] || "";
    const subjects = new Map([...disciplineBlock.matchAll(/\{id:"(\d+)",name:"([^"}]*)"\}/g)].map((match) => [match[1], decode(match[2])]));
    const courses = [...html.matchAll(/\{id:(\d+),title:"((?:\\.|[^"])*)",instituteName:"((?:\\.|[^"])*)",[^{}]*?disciplineId:(\d+)/g)];
    for (const match of courses) {
      const [, number, title, institution, discipline] = match;
      upsertCourse({ id: `nptel:${number}`, provider: "nptel", title: decode(title), subject: subjects.get(discipline) || "", institution: decode(institution) || "NPTEL", url: `${NPTEL}/courses/${number}`, description: "" });
      imported++;
    }
    if (!courses.length) errors.push("NPTEL: no course data found in the published catalogue");
  } catch (error) { errors.push(`NPTEL: ${error instanceof Error ? error.message : "refresh failed"}`); }
  scheduleCatalogRefresh(errors.length === 0);
  return { imported, total: courseCount(), errors };
}

export function ensureStarterCatalog() {
  if (courseCount()) return;
  upsertCourse({ id: "nptel:106106127", provider: "nptel", title: "Programming, Data Structures and Algorithms using C", subject: "Computer Science and Engineering", institution: "IIT Madras", url: "https://nptel.ac.in/courses/106106127", description: "NPTEL course on programming, data structures, and algorithms." });
}

export async function hydrateCourse(id: string) {
  const current = getCourse(id);
  if (!current) return null;
  try {
    const html = await fetchText(current.url);
    const title = current.title;
    const description = textFromMeta(html, "description") || current.description;
    const subject = html.match(/"discipline"\s*:\s*"([^"]+)"/)?.[1] || current.subject;
    upsertCourse({ ...current, title, description, subject });
    const lectureLinks = [...html.matchAll(/name:"((?:\\.|[^"])*)",youtube_id:"([\w-]{11})"/g)].map((match) => ({ text: decode(match[1]), url: `https://www.youtube.com/watch?v=${match[2]}`, mediaUrl: `https://www.youtube.com/watch?v=${match[2]}` }));
    const seen = new Set<string>();
    lectureLinks.forEach((item, ordinal) => {
      if (seen.has(item.url)) return;
      seen.add(item.url);
      const lecture: CatalogLecture = { id: idFor(id, item.url), courseId: id, title: item.text || `Lecture ${ordinal + 1}`, ordinal: ordinal + 1, pageUrl: item.url, mediaUrl: item.mediaUrl };
      upsertLecture(lecture);
    });
    deleteStaleLectures(id, [...seen].map((url) => idFor(id, url)));
    return getCourse(id);
  } catch { return current; }
}
