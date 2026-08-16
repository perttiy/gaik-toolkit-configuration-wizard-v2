import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { restoreSessionBlueprintVersion } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; version: string }> },
) {
  const { id, version: versionRaw } = await params;
  const version = Number(versionRaw);
  if (!Number.isInteger(version) || version < 1) {
    return new Response("Invalid version", { status: 400 });
  }
  const owned = await requireOwnedSession(id);
  if (!owned) {
    return new Response("Session not found", { status: 404 });
  }

  let note = "";
  try {
    const body = await req.json();
    if (typeof body?.note === "string") note = body.note;
  } catch {
    // empty body OK
  }

  const updated = await restoreSessionBlueprintVersion(id, version, note);
  if (!updated) {
    return new Response("version not found", { status: 404 });
  }

  return Response.json({
    blueprint: updated.blueprint,
    activeVersion: updated.activeVersion,
    versions: updated.versions,
  });
}
