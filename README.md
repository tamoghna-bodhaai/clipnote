# ClipNote

ClipNote is a [Next.js](https://nextjs.org) App Router application for studying videos from NPTEL, YouTube, or an upload. It provides transcripts, notes, chat, quizzes, and concept maps.

## Run locally

Requires Node.js 20+, internet access, and an API key. API usage may incur charges. ClipNote automatically detects `ffmpeg` and `yt-dlp` in the project's existing `.venv`; otherwise install them on PATH, or set `FFMPEG_PATH` and `YTDLP_PATH` in `.env.local`.

```sh
npm install
cp .env.example .env.local
# Edit .env.local and add your OPENROUTER_API_KEY or OPENAI_API_KEY
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use `npm run build` to create a production build and `npm start` to serve it.

`AI_PROVIDER` sets the default provider (`openrouter` or `openai`). Set task-specific `TRANSCRIBE_PROVIDER`, `SUMMARY_PROVIDER`, `DETAILED_PROVIDER`, `DEEP_PROVIDER`, `CHAT_PROVIDER`, or `ASSESSMENT_PROVIDER` and the corresponding `*_MODEL` as needed. OpenRouter models use IDs such as `openai/whisper-1` and `openai/gpt-4o-mini`; OpenAI uses IDs such as `whisper-1` and `gpt-4o-mini`. Set `OPENROUTER_API_KEY` and/or `OPENAI_API_KEY` for the providers in use.

Voice questions are recorded in the browser and transcribed server-side through OpenRouter. Set `OPENROUTER_API_KEY`; optionally set `STT_MODEL` to an OpenRouter speech-to-text model. It defaults to `openai/whisper-large-v3-turbo` and accepts the selected study language as a transcription hint.

The transcription model must support `verbose_json` segment timestamps. OpenRouter's transcription service has an upstream processing timeout, so long or complex chunks can fail even when within the upload size limit. Model availability and prices vary. See [OpenRouter transcription documentation](https://openrouter.ai/blog/tutorials/transcription-on-openrouter/).

The Next.js route handlers extract and split audio locally, then send it to the selected transcription provider; transcript text is sent to the selected language-model providers. Temporary uploads and audio are removed after the request. Uploads are limited to 500 MB. This analyzes spoken audio, not visual scenes.

## Study workspace

After analysis, use **Summary**, **Detailed notes**, or **Deep dive** for different note depths. **Quiz** generates six multiple-choice questions with feedback and timestamp links; **Concept map** connects lecture ideas and opens explanations with timestamp links. The selected study language applies to notes, chat answers, quizzes, and concept maps. You can paste a YouTube playlist or up to 20 individual YouTube links. The transcript timestamps seek the player. Use **Ask about this moment** or mark a start and end to focus chat on a particular interval. Generated notes, quizzes, concept maps, and quiz scores are saved for the signed-in learner.

## Course catalogue

The course library indexes the public [NPTEL](https://nptel.ac.in/courses) catalogue. The first visit seeds a verified example and starts a background refresh; subsequent refreshes are due every 24 hours. A refresh can also be triggered with `POST /api/library` and an `x-catalog-sync-token` header matching `CATALOG_SYNC_TOKEN` in the server environment. Search and filters use `GET /api/library`; `GET /api/library/course?id=...` loads lecture links on demand.

Choosing a lecture creates a persisted processing record through `POST /api/library/study`; `GET /api/library/study?lectureId=...` polls its status. Completed lecture analysis is shared across learners, while study history and assessments remain private. Processing uses the existing `yt-dlp`, `ffmpeg`, and transcription stack. Run the Node server with persistent `.data` storage and keep it running while jobs execute; interrupted jobs can be reclaimed on a later poll after 15 minutes. The catalogue and library processing require outbound access to the provider sites and media hosts.

NPTEL credits and original links are shown in the interface and exports. NPTEL's [published terms](https://onlinecourses-archive.nptel.ac.in/modules/nptel/assets/html/terms.html) reserve content rights, so confirm the basis for automated transcription and generated materials before deploying NPTEL analysis publicly.

## Accounts and saved studies

The first visit presents a public landing page. In local development, a name and email create a demo account. In production, set `ACCESS_CODES` to a JSON array of distinct five-digit numeric strings, for example `["12345","67890"]`. Issue one code to each person. On first use, they choose a username and email; the code is bound to that account in the persistent SQLite database. Later sign-ins require the same username, email, and code. A claimed code cannot create or open a different account. Sign-in is limited to five attempts per client and 50 attempts overall per 15 minutes. Keep `ACCESS_CODES` in the server environment, not a `NEXT_PUBLIC_` variable or source control. Removing a code revokes that account's sessions; replacing a code requires an account recovery or migration procedure. Production sessions persist for 30 days and sign-out removes the server session. Sessions created by the earlier passwordless login are rejected in production.

Completed generations are stored in SQLite at `.data/clipnote.sqlite`, scoped to the signed-in user, and shown in the application sidebar. An existing LecScan database is migrated automatically on first startup. Existing passwordless accounts cannot be claimed by entering their email with a new code; migrate them administratively if their saved studies must be retained. Keep the issued codes in `ACCESS_CODES` across deployments to retain access to the same saved studies. The database directory is ignored by git and should be backed up or replaced with a managed database before multi-instance deployment.

## Deploying to Railway

This repository includes a production Dockerfile and `railway.toml`. The image runs Next.js in standalone mode and includes `ffmpeg` and `yt-dlp`, which are required for media analysis.

1. Create a Railway service from this repository; Railway will detect the root `Dockerfile`.
2. Attach a **Volume** mounted at `/data`. This is required to keep SQLite data across redeployments. Do not run more than one replica: SQLite and the in-process lecture jobs are single-instance components.
3. Set `RAILWAY_RUN_UID=0` so the startup script can make the root-mounted volume writable before it runs the application as the unprivileged `node` user. Set `ACCESS_CODES` with a distinct code for each invited person, `AI_PROVIDER`, and the required provider credential (`OPENROUTER_API_KEY` or `OPENAI_API_KEY`). Add `CATALOG_SYNC_TOKEN` as a long random secret if catalogue refreshes will be triggered externally. See `.env.example` for optional model overrides.
4. Generate a Railway public domain. Railway supplies `PORT`; the service health check is `GET /api/health`.

If summary generation reports `spawn yt-dlp ENOENT`, the running service cannot execute the media downloader. Check that the service builder is **Dockerfile**, with `Dockerfile` at the repository root, then redeploy the latest commit. The Docker build verifies that Python, `yt-dlp`, and `ffmpeg` still run after package cleanup; container startup checks that the media tools are present. A Railway deployment built with Nixpacks or an older image may not include these tools.

YouTube extraction also requires JavaScript challenge support. The Docker image installs `yt-dlp[default]`, and the app enables the Node.js runtime already in the image. If YouTube still responds with “Sign in to confirm you’re not a bot,” its server-side access check is blocking the Railway instance. Users can upload a video file instead. An administrator can optionally set `YTDLP_COOKIES_FILE` to a private, Netscape-format cookies file readable by the app user; keep it off Git and treat it as an account credential. Cookies may expire or fail when the server uses a different IP address.

The container stores data in `/data/clipnote.sqlite` through `DATA_DIR=/data`. Back up the Railway volume before making destructive catalogue or account changes. The application deliberately uses one replica because a shared SQLite file and in-memory background work are not safe across replicas. For horizontal scaling, move the data and job coordination to managed services first.
