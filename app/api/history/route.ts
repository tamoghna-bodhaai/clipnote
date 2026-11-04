import { cookies } from "next/headers";
import { deleteStudy, listStudies, saveStudy, userForToken } from "@/lib/db";

export const dynamic = "force-dynamic";

async function currentUser() { return userForToken((await cookies()).get("clipnote_session")?.value); }

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to view your library." }, { status: 401 });
  return Response.json({ studies: listStudies(user.id) });
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to save studies." }, { status: 401 });
  const study = await request.json();
  if (!study?.id || !Array.isArray(study.analyses) || !["youtube", "upload", "nptel"].includes(study.source)) return Response.json({ error: "Invalid study." }, { status: 400 });
  saveStudy(user.id, study);
  return Response.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to manage studies." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || undefined;
  deleteStudy(user.id, id);
  return Response.json({ ok: true });
}
