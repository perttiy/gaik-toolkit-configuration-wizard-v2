import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { apiApplyBlueprintOps, wizardApiEnabled } from "@/lib/wizard-api-client";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const owned = await requireOwnedSession(id);
  if (!owned) {
    return new Response("Session not found", { status: 404 });
  }

  let body: { ops?: unknown[]; note?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!Array.isArray(body.ops) || body.ops.length === 0) {
    return new Response("Missing ops", { status: 400 });
  }

  try {
    if (wizardApiEnabled()) {
      const detail = await apiApplyBlueprintOps(id, body.ops as object[], body.note);
      return Response.json({ blueprint: detail.blueprint });
    }
    return new Response("wizard_api required for change-ops", { status: 503 });
  } catch (err) {
    console.error("[blueprint ops]", err);
    const message = err instanceof Error ? err.message : "ops failed";
    if (message.includes("400") || message.toLowerCase().includes("unsupported")) {
      return new Response(message, { status: 400 });
    }
    return new Response(message, { status: 500 });
  }
}
