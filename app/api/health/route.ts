import { databaseHealthcheck } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Railway uses this endpoint while bringing a new instance online. AI-provider
// availability must not prevent the web server from starting.
export async function GET() {
  try {
    databaseHealthcheck();
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
