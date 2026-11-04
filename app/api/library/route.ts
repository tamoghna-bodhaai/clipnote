import { catalogRefreshDue, courseCount, searchCourses } from "@/lib/db";
import { ensureStarterCatalog, refreshCatalog } from "@/lib/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let refreshing = false;
let lastRefresh: { imported: number; total: number; errors: string[] } | null = null;
export async function GET(request: Request) {
  const empty = !courseCount();
  if (empty) ensureStarterCatalog();
  if (catalogRefreshDue() && !refreshing) {
    refreshing = true;
    void refreshCatalog().then((result) => { lastRefresh = result; }).finally(() => { refreshing = false; });
  }
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
  return Response.json({ ...searchCourses((params.get("q") || "").slice(0, 120), params.get("provider") || "", params.get("subject") || "", page), refreshing, lastRefresh });
}
export async function POST(request: Request) {
  const token = process.env.CATALOG_SYNC_TOKEN;
  if (!token || request.headers.get("x-catalog-sync-token") !== token) return Response.json({ error: "Catalogue refresh is not configured or authorized." }, { status: 403 });
  lastRefresh = await refreshCatalog();
  return Response.json(lastRefresh);
}
