import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { apiApplyBlueprintOps, wizardApiEnabled } from "@/lib/wizard-api-client";
import { withLogging } from "@/lib/with-logging";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getTraceId, setContextUserId } from "@/lib/request-context";

export const dynamic = "force-dynamic";

// S3-4/#66 — structured blueprint change-ops. wizard_api-only: mock mode has
// no persisted version history for ops to apply against (mirrors how the
// Undo control itself only ever renders when a real activeVersion exists).
export const POST = withLogging(
  "blueprint.ops",
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) {
      return new Response("Session not found", { status: 404 });
    }
    setContextUserId(owned.user.email);

    let body: { ops?: unknown[]; note?: string };
    try {
      body = await req.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    if (!Array.isArray(body.ops) || body.ops.length === 0) {
      return new Response("Missing ops", { status: 400 });
    }

    if (!wizardApiEnabled()) {
      return new Response("wizard_api required for change-ops", { status: 503 });
    }

    try {
      const detail = await apiApplyBlueprintOps(id, body.ops as object[], body.note);
      audit("blueprint.ops", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "success",
        opCount: body.ops.length,
      });
      return Response.json({
        blueprint: detail.blueprint,
        activeVersion: detail.active_version,
        versions: detail.versions.map((v) => ({
          version: v.version,
          createdAt: v.created_at,
          note: v.note,
        })),
      });
    } catch (err) {
      logger.error({ traceId: getTraceId(), err, sessionId: id }, "blueprint.ops failed");
      const message = err instanceof Error ? err.message : "ops failed";
      const status = message.includes("400") ? 400 : 500;
      audit("blueprint.ops", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: status === 400 ? "denied" : "error",
      });
      return new Response(message, { status });
    }
  },
);
