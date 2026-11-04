import { randomUUID } from "crypto";
import { existsSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";
import { isActiveCodeHash, normalizeIdentifier, productionAuth } from "@/lib/auth";

let database: DatabaseSync | undefined;

function migrateLegacyDatabase(dataDirectory: string) {
  const legacyPath = join(dataDirectory, "lecscan.sqlite");
  const clipNotePath = join(dataDirectory, "clipnote.sqlite");
  if (existsSync(clipNotePath) || !existsSync(legacyPath)) return;

  for (const suffix of ["", "-wal", "-shm"]) {
    const source = `${legacyPath}${suffix}`;
    if (existsSync(source)) renameSync(source, `${clipNotePath}${suffix}`);
  }
}

function db() {
  if (database) return database;
  // Railway mounts the persistent volume at /data. Locally this deliberately
  // remains .data, so existing developer databases continue to work.
  const dataDirectory = process.env.DATA_DIR?.trim() || join(process.cwd(), ".data");
  mkdirSync(dataDirectory, { recursive: true });
  migrateLegacyDatabase(dataDirectory);
  database = new DatabaseSync(join(dataDirectory, "clipnote.sqlite"));
  database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS login_attempts (
    scope TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS studies (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL,
    source TEXT NOT NULL, title TEXT NOT NULL, payload TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS studies_user_created ON studies(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS catalog_courses (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, title TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '', institution TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL, credit_name TEXT NOT NULL DEFAULT '',
    license_url TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS catalog_search ON catalog_courses(provider, subject, title);
  CREATE TABLE IF NOT EXISTS catalog_lectures (
    id TEXT PRIMARY KEY, course_id TEXT NOT NULL, title TEXT NOT NULL,
    ordinal INTEGER NOT NULL, page_url TEXT NOT NULL, media_url TEXT,
    FOREIGN KEY(course_id) REFERENCES catalog_courses(id)
  );
  CREATE INDEX IF NOT EXISTS catalog_lecture_order ON catalog_lectures(course_id, ordinal);
  CREATE TABLE IF NOT EXISTS lecture_jobs (
    lecture_id TEXT PRIMARY KEY, status TEXT NOT NULL, analysis TEXT,
    error TEXT, updated_at TEXT NOT NULL,
    FOREIGN KEY(lecture_id) REFERENCES catalog_lectures(id)
  );
  CREATE TABLE IF NOT EXISTS youtube_transcripts (
    video_id TEXT PRIMARY KEY, source_url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
    transcript TEXT, segments TEXT, status TEXT NOT NULL, error TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS youtube_transcripts_status ON youtube_transcripts(status, updated_at);
  CREATE TABLE IF NOT EXISTS study_artifacts (
    study_id TEXT NOT NULL, user_id TEXT NOT NULL, lecture_key TEXT NOT NULL,
    kind TEXT NOT NULL, language TEXT NOT NULL, content TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(study_id, user_id, lecture_key, kind, language)
  );
  CREATE TABLE IF NOT EXISTS quiz_attempts (
    id TEXT PRIMARY KEY, study_id TEXT NOT NULL, user_id TEXT NOT NULL,
    lecture_key TEXT NOT NULL, language TEXT NOT NULL, answers TEXT NOT NULL,
    score INTEGER NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS catalog_meta (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS course_progress (
    user_id TEXT NOT NULL, course_id TEXT NOT NULL, lecture_id TEXT NOT NULL,
    position_seconds REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id, course_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(course_id) REFERENCES catalog_courses(id) ON DELETE CASCADE,
    FOREIGN KEY(lecture_id) REFERENCES catalog_lectures(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS course_progress_user_updated ON course_progress(user_id, updated_at DESC);
`);
  const courseColumns = database.prepare("PRAGMA table_info(catalog_courses)").all() as { name: string }[];
  const sessionColumns = database.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  if (!sessionColumns.some((column) => column.name === "auth_mode")) database.exec("ALTER TABLE sessions ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'local'");
  const userColumns = database.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userColumns.some((column) => column.name === "username")) database.exec("ALTER TABLE users ADD COLUMN username TEXT");
  if (!userColumns.some((column) => column.name === "access_code_hash")) database.exec("ALTER TABLE users ADD COLUMN access_code_hash TEXT");
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(username); CREATE UNIQUE INDEX IF NOT EXISTS users_access_code_hash ON users(access_code_hash)");
  if (!courseColumns.some((column) => column.name === "credit_name")) database.exec("ALTER TABLE catalog_courses ADD COLUMN credit_name TEXT NOT NULL DEFAULT ''");
  if (!courseColumns.some((column) => column.name === "license_url")) database.exec("ALTER TABLE catalog_courses ADD COLUMN license_url TEXT NOT NULL DEFAULT ''");
  // MIT OCW is intentionally not part of the video-course catalogue: many
  // courses do not offer a complete lecture-video sequence. Older databases
  // can still contain those courses and their dependent rows, so remove the
  // dependants before the parent courses. This also makes startup safe when
  // SQLite foreign-key enforcement is enabled.
  database.exec(`
    DELETE FROM course_progress
    WHERE course_id IN (SELECT id FROM catalog_courses WHERE provider = 'mit_ocw');
    DELETE FROM lecture_jobs
    WHERE lecture_id IN (
      SELECT id FROM catalog_lectures
      WHERE course_id IN (SELECT id FROM catalog_courses WHERE provider = 'mit_ocw')
    );
    DELETE FROM catalog_lectures
    WHERE course_id IN (SELECT id FROM catalog_courses WHERE provider = 'mit_ocw');
    DELETE FROM catalog_courses WHERE provider = 'mit_ocw';
  `);
  database.exec("UPDATE catalog_courses SET credit_name = 'NPTEL' WHERE provider = 'nptel' AND credit_name = ''");
  return database;
}

/** Used by the deployment health check to confirm the persistent store is writable. */
export function databaseHealthcheck() {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE; ROLLBACK");
}

export type DbUser = { id: string; email: string; name: string };
export class AccountConflictError extends Error {}

export function allowLoginAttempt(scope: string, limit: number) {
  const connection = db();
  const now = Date.now();
  connection.prepare(`INSERT INTO login_attempts (scope, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(scope) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
    expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END`)
    .run(scope, now + 15 * 60 * 1000, now, now);
  const row = connection.prepare("SELECT attempts FROM login_attempts WHERE scope = ?").get(scope) as { attempts: number };
  return row.attempts <= limit;
}

export function createSession(email: string, name?: string) {
  const normalized = email.trim().toLowerCase();
  const existing = db().prepare("SELECT id, email, name FROM users WHERE email = ?").get(normalized) as DbUser | undefined;
  const user = existing || { id: randomUUID(), email: normalized, name: name?.trim() || normalized.split("@")[0] || "Learner" };
  if (!existing) db().prepare("INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)").run(user.id, user.email, user.name, new Date().toISOString());
  const token = randomUUID();
  db().prepare("INSERT INTO sessions (token, user_id, created_at, auth_mode) VALUES (?, ?, ?, 'local')").run(token, user.id, new Date().toISOString());
  return { token, user };
}

export function createCodeSession(username: string, email: string, codeHash: string) {
  const connection = db();
  const normalizedUsername = normalizeIdentifier(username);
  const normalizedEmail = normalizeIdentifier(email);
  connection.exec("BEGIN IMMEDIATE");
  try {
    let user = connection.prepare("SELECT id, email, name, username FROM users WHERE access_code_hash = ?").get(codeHash) as (DbUser & { username: string | null }) | undefined;
    if (user) {
      if (user.username !== normalizedUsername || user.email !== normalizedEmail) throw new AccountConflictError("This access code belongs to another account.");
    } else {
      const emailOwner = connection.prepare("SELECT id FROM users WHERE email = ?").get(normalizedEmail) as { id: string } | undefined;
      const usernameOwner = connection.prepare("SELECT id FROM users WHERE username = ?").get(normalizedUsername) as { id: string } | undefined;
      if (usernameOwner || emailOwner) throw new AccountConflictError("This username or email is already in use.");
      user = { id: randomUUID(), email: normalizedEmail, name: normalizedUsername, username: normalizedUsername };
      connection.prepare("INSERT INTO users (id, email, name, created_at, username, access_code_hash) VALUES (?, ?, ?, ?, ?, ?)").run(user.id, user.email, user.name, new Date().toISOString(), user.username, codeHash);
    }
    const token = randomUUID();
    connection.prepare("INSERT INTO sessions (token, user_id, created_at, auth_mode) VALUES (?, ?, ?, 'code_v2')").run(token, user.id, new Date().toISOString());
    connection.exec("COMMIT");
    return { token, user: { id: user.id, email: user.email, name: user.name } };
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}

export function userForToken(token?: string) {
  if (!token) return null;
  const row = db().prepare("SELECT u.id, u.email, u.name, u.access_code_hash AS codeHash, s.auth_mode AS authMode, s.created_at AS createdAt FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?").get(token) as (DbUser & { codeHash: string | null; authMode: string; createdAt: string }) | undefined;
  if (!row) return null;
  if (productionAuth && (row.authMode !== "code_v2" || !isActiveCodeHash(row.codeHash) || !Number.isFinite(Date.parse(row.createdAt)) || Date.now() - Date.parse(row.createdAt) > 30 * 24 * 60 * 60 * 1000)) return null;
  return { id: row.id, email: row.email, name: row.name };
}

export function removeSession(token?: string) {
  if (token) db().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function listStudies(userId: string) {
  // Course lectures are resumed from Course History. Their saved study data is
  // retained for notes, quizzes, and concept maps, but they do not belong in
  // the separate upload/link Study History list.
  return db().prepare("SELECT id, created_at as createdAt, source, payload FROM studies WHERE user_id = ? AND source != 'nptel' ORDER BY created_at DESC LIMIT 40").all(userId).map((row: any) => {
    const payload = JSON.parse(row.payload);
    return { id: row.id, createdAt: row.createdAt, source: row.source, ...(Array.isArray(payload) ? { analyses: payload } : payload) };
  });
}

export function saveStudy(userId: string, study: { id: string; createdAt: string; source: string; analyses: unknown[]; summaries?: unknown; studyLanguage?: string }) {
  const title = (study.analyses[0] as { title?: string } | undefined)?.title || "Untitled study";
  db().prepare("INSERT INTO studies (id, user_id, created_at, source, title, payload) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source = excluded.source, title = excluded.title, payload = excluded.payload").run(study.id, userId, study.createdAt, study.source, title, JSON.stringify(study));
}
export function getStudy(userId: string, studyId: string) {
  const row = db().prepare("SELECT payload FROM studies WHERE user_id=? AND id=?").get(userId, studyId) as { payload: string } | undefined;
  if (!row) return null;
  const payload = JSON.parse(row.payload);
  return (Array.isArray(payload) ? { analyses: payload } : payload) as { analyses: { transcript: string; segments: { start: number; end: number; text: string }[]; lectureId?: string; sourceUrl?: string }[] };
}

export function deleteStudy(userId: string, studyId?: string) {
  if (studyId) db().prepare("DELETE FROM studies WHERE user_id = ? AND id = ?").run(userId, studyId);
  else db().prepare("DELETE FROM studies WHERE user_id = ?").run(userId);
  if (studyId) db().prepare("DELETE FROM study_artifacts WHERE user_id = ? AND study_id = ?").run(userId, studyId);
  else db().prepare("DELETE FROM study_artifacts WHERE user_id = ?").run(userId);
  if (studyId) db().prepare("DELETE FROM quiz_attempts WHERE user_id = ? AND study_id = ?").run(userId, studyId);
  else db().prepare("DELETE FROM quiz_attempts WHERE user_id = ?").run(userId);
}

export type CatalogCourse = { id: string; provider: "nptel"; title: string; subject: string; institution: string; url: string; description: string; creditName?: string; licenseUrl?: string };
export type CatalogLecture = { id: string; courseId: string; title: string; ordinal: number; pageUrl: string; mediaUrl: string | null };
export function upsertCourse(course: CatalogCourse) {
  const creditName = course.creditName || "NPTEL";
  const licenseUrl = course.licenseUrl || "";
  db().prepare("INSERT INTO catalog_courses (id, provider, title, subject, institution, url, description, updated_at, credit_name, license_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, subject=excluded.subject, institution=excluded.institution, url=excluded.url, description=excluded.description, updated_at=excluded.updated_at, credit_name=excluded.credit_name, license_url=excluded.license_url")
    .run(course.id, course.provider, course.title, course.subject, course.institution, course.url, course.description, new Date().toISOString(), creditName, licenseUrl);
}
export function upsertLecture(lecture: CatalogLecture) {
  const previous = db().prepare("SELECT media_url as mediaUrl FROM catalog_lectures WHERE id=?").get(lecture.id) as { mediaUrl: string | null } | undefined;
  db().prepare("INSERT INTO catalog_lectures VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, ordinal=excluded.ordinal, page_url=excluded.page_url, media_url=excluded.media_url")
    .run(lecture.id, lecture.courseId, lecture.title, lecture.ordinal, lecture.pageUrl, lecture.mediaUrl);
  if (previous && previous.mediaUrl !== lecture.mediaUrl) db().prepare("DELETE FROM lecture_jobs WHERE lecture_id=?").run(lecture.id);
}
export function deleteStaleLectures(courseId: string, keepIds: string[]) {
  if (!keepIds.length) return;
  db().prepare(`DELETE FROM catalog_lectures WHERE course_id = ? AND id NOT IN (${keepIds.map(() => "?").join(",")})`).run(courseId, ...keepIds);
}
export function courseCount() { return (db().prepare("SELECT count(*) as count FROM catalog_courses").get() as { count: number }).count; }
export function catalogRefreshDue() {
  const row = db().prepare("SELECT value FROM catalog_meta WHERE key='next_refresh_at'").get() as { value: string } | undefined;
  return !row || row.value < new Date().toISOString();
}
export function scheduleCatalogRefresh(success: boolean) {
  const next = new Date(Date.now() + (success ? 24 * 60 : 15) * 60_000).toISOString();
  db().prepare("INSERT INTO catalog_meta VALUES ('next_refresh_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(next);
}
export function searchCourses(query: string, provider: string, subject: string, page: number) {
  const where = "WHERE (? = '' OR provider = ?) AND (? = '' OR subject = ?) AND (? = '' OR title LIKE ? OR description LIKE ? OR institution LIKE ? OR subject LIKE ?)";
  const pattern = `%${query}%`;
  const params = [provider, provider, subject, subject, query, pattern, pattern, pattern, pattern];
  const count = (db().prepare(`SELECT count(*) as count FROM catalog_courses ${where}`).get(...params) as { count: number }).count;
  const courses = db().prepare(`SELECT id, provider, title, subject, institution, url, description, credit_name as creditName, license_url as licenseUrl, (SELECT count(*) FROM catalog_lectures l WHERE l.course_id = c.id) as lectureCount FROM catalog_courses c ${where} ORDER BY title LIMIT 24 OFFSET ?`).all(...params, (page - 1) * 24);
  const subjects = db().prepare("SELECT DISTINCT subject FROM catalog_courses WHERE subject != '' ORDER BY subject").all() as { subject: string }[];
  return { courses, count, subjects: subjects.map((row) => row.subject), page, pageSize: 24 };
}
export function getCourse(id: string) {
  const course = db().prepare("SELECT id, provider, title, subject, institution, url, description, credit_name as creditName, license_url as licenseUrl FROM catalog_courses WHERE id = ?").get(id) as CatalogCourse | undefined;
  if (!course) return null;
  const lectures = db().prepare("SELECT id, course_id as courseId, title, ordinal, page_url as pageUrl, media_url as mediaUrl FROM catalog_lectures WHERE course_id = ? ORDER BY ordinal").all(id) as CatalogLecture[];
  return { ...course, lectures };
}
export type CourseProgress = { courseId: string; lectureId: string; positionSeconds: number; completed: boolean; updatedAt: string };
export function getCourseProgress(userId: string, courseId: string) {
  const row = db().prepare("SELECT course_id as courseId, lecture_id as lectureId, position_seconds as positionSeconds, completed, updated_at as updatedAt FROM course_progress WHERE user_id=? AND course_id=?")
    .get(userId, courseId) as Omit<CourseProgress, "completed"> & { completed: number } | undefined;
  return row ? { ...row, completed: Boolean(row.completed) } : null;
}
export function listCourseHistory(userId: string) {
  return db().prepare("SELECT p.course_id as courseId, p.lecture_id as lectureId, p.position_seconds as positionSeconds, p.completed, p.updated_at as updatedAt, c.title as courseTitle, l.title as lectureTitle, l.ordinal as lectureOrdinal FROM course_progress p JOIN catalog_courses c ON c.id=p.course_id JOIN catalog_lectures l ON l.id=p.lecture_id WHERE p.user_id=? ORDER BY p.updated_at DESC LIMIT 40")
    .all(userId) as { courseId: string; lectureId: string; positionSeconds: number; completed: number; updatedAt: string; courseTitle: string; lectureTitle: string; lectureOrdinal: number }[];
}
export function saveCourseProgress(userId: string, courseId: string, lectureId: string, positionSeconds: number, completed = false) {
  const lecture = db().prepare("SELECT 1 FROM catalog_lectures WHERE id=? AND course_id=?").get(lectureId, courseId);
  if (!lecture) return false;
  db().prepare("INSERT INTO course_progress (user_id, course_id, lecture_id, position_seconds, completed, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, course_id) DO UPDATE SET lecture_id=excluded.lecture_id, position_seconds=excluded.position_seconds, completed=excluded.completed, updated_at=excluded.updated_at")
    .run(userId, courseId, lectureId, Math.max(0, positionSeconds), completed ? 1 : 0, new Date().toISOString());
  return true;
}
// Record a library lecture as soon as a learner chooses Study. Keeping an
// existing position for the same lecture means Resume never jumps back to 0.
export function startCourseLecture(userId: string, courseId: string, lectureId: string) {
  const lecture = db().prepare("SELECT 1 FROM catalog_lectures WHERE id=? AND course_id=?").get(lectureId, courseId);
  if (!lecture) return false;
  db().prepare(`INSERT INTO course_progress (user_id, course_id, lecture_id, position_seconds, completed, updated_at)
    VALUES (?, ?, ?, 0, 0, ?)
    ON CONFLICT(user_id, course_id) DO UPDATE SET
      lecture_id=excluded.lecture_id,
      position_seconds=CASE WHEN course_progress.lecture_id=excluded.lecture_id THEN course_progress.position_seconds ELSE 0 END,
      completed=CASE WHEN course_progress.lecture_id=excluded.lecture_id THEN course_progress.completed ELSE 0 END,
      updated_at=excluded.updated_at`)
    .run(userId, courseId, lectureId, new Date().toISOString());
  return true;
}
export function getLecture(id: string) {
  const lecture = db().prepare("SELECT id, course_id as courseId, title, ordinal, page_url as pageUrl, media_url as mediaUrl FROM catalog_lectures WHERE id = ?").get(id) as CatalogLecture | undefined;
  return lecture ? { ...lecture, course: getCourse(lecture.courseId) } : null;
}
export function getLectureJob(id: string) {
  return db().prepare("SELECT status, analysis, error, updated_at as updatedAt FROM lecture_jobs WHERE lecture_id = ?").get(id) as { status: string; analysis: string | null; error: string | null; updatedAt: string } | undefined;
}
export function setLectureJob(id: string, status: string, analysis?: unknown, error?: string) {
  db().prepare("INSERT INTO lecture_jobs VALUES (?, ?, ?, ?, ?) ON CONFLICT(lecture_id) DO UPDATE SET status=excluded.status, analysis=excluded.analysis, error=excluded.error, updated_at=excluded.updated_at")
    .run(id, status, analysis ? JSON.stringify(analysis) : null, error || null, new Date().toISOString());
}
export function claimLectureJob(id: string) {
  const now = new Date().toISOString();
  db().prepare("INSERT OR IGNORE INTO lecture_jobs (lecture_id, status, updated_at) VALUES (?, 'pending', ?)").run(id, now);
  return db().prepare("UPDATE lecture_jobs SET status='processing', error=NULL, updated_at=? WHERE lecture_id=? AND (status IN ('pending','error') OR (status='processing' AND updated_at < ?))")
    .run(now, id, new Date(Date.now() - 15 * 60_000).toISOString()).changes > 0;
}

export type YoutubeTranscriptJob = {
  videoId: string; sourceUrl: string; title: string; transcript: string | null;
  segments: { start: number; end: number; text: string }[] | null;
  status: "pending" | "processing" | "ready" | "error"; error: string | null; updatedAt: string;
};
export function getYoutubeTranscriptJob(videoId: string): YoutubeTranscriptJob | null {
  const row = db().prepare("SELECT video_id as videoId, source_url as sourceUrl, title, transcript, segments, status, error, updated_at as updatedAt FROM youtube_transcripts WHERE video_id=?").get(videoId) as Omit<YoutubeTranscriptJob, "segments"> & { segments: string | null } | undefined;
  return row ? { ...row, segments: row.segments ? JSON.parse(row.segments) : null } : null;
}
export function claimYoutubeTranscriptJob(videoId: string, sourceUrl: string) {
  const now = new Date().toISOString();
  const connection = db();
  connection.prepare("INSERT OR IGNORE INTO youtube_transcripts (video_id, source_url, status, updated_at) VALUES (?, ?, 'pending', ?)").run(videoId, sourceUrl, now);
  return connection.prepare("UPDATE youtube_transcripts SET source_url=?, status='processing', error=NULL, updated_at=? WHERE video_id=? AND (status IN ('pending', 'error') OR (status='processing' AND updated_at < ?))")
    .run(sourceUrl, now, videoId, new Date(Date.now() - 15 * 60_000).toISOString()).changes > 0;
}
export function saveYoutubeTranscriptJob(videoId: string, result: { sourceUrl: string; title: string; transcript: string; segments: { start: number; end: number; text: string }[] }) {
  db().prepare("UPDATE youtube_transcripts SET source_url=?, title=?, transcript=?, segments=?, status='ready', error=NULL, updated_at=? WHERE video_id=?")
    .run(result.sourceUrl, result.title, result.transcript, JSON.stringify(result.segments), new Date().toISOString(), videoId);
}
export function failYoutubeTranscriptJob(videoId: string, error: string) {
  db().prepare("UPDATE youtube_transcripts SET status='error', error=?, updated_at=? WHERE video_id=?")
    .run(error, new Date().toISOString(), videoId);
}
export function getArtifact(userId: string, studyId: string, lectureKey: string, kind: string, language: string) {
  const row = db().prepare("SELECT content FROM study_artifacts WHERE user_id=? AND study_id=? AND lecture_key=? AND kind=? AND language=?").get(userId, studyId, lectureKey, kind, language) as { content: string } | undefined;
  return row ? JSON.parse(row.content) : null;
}
export function saveArtifact(userId: string, studyId: string, lectureKey: string, kind: string, language: string, content: unknown) {
  db().prepare("INSERT INTO study_artifacts VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(study_id,user_id,lecture_key,kind,language) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at")
    .run(studyId, userId, lectureKey, kind, language, JSON.stringify(content), new Date().toISOString());
}
export function saveQuizAttempt(userId: string, studyId: string, lectureKey: string, language: string, answers: number[], score: number, total: number) {
  db().prepare("INSERT INTO quiz_attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), studyId, userId, lectureKey, language, JSON.stringify(answers), score, total, new Date().toISOString());
}
export function getLatestQuizAttempt(userId: string, studyId: string, lectureKey: string, language: string) {
  const row = db().prepare("SELECT answers, score, total, created_at as createdAt FROM quiz_attempts WHERE user_id=? AND study_id=? AND lecture_key=? AND language=? ORDER BY created_at DESC LIMIT 1")
    .get(userId, studyId, lectureKey, language) as { answers: string; score: number; total: number; createdAt: string } | undefined;
  return row ? { answers: JSON.parse(row.answers) as number[], score: row.score, total: row.total, createdAt: row.createdAt } : null;
}
