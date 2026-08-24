import { NextRequest } from "next/server";
import { requireOwnedSession } from "@/lib/session-access";
import { apiRestoreVersion, wizardApiEnabled } from "@/lib/wizard-api-client";
import { withLogging } from "@/lib/with-logging";
import { audit } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { getTraceId, setContextUserId } from "@/lib/request-context";

export const dynamic = "force-dynamic";

// S3-5/#67 — undo/restore: copy an earlier version's content forward as a
// new version. wizard_api-only — mock mode has no persisted version history.
export const POST = withLogging(
  "blueprint.version.restore",
  async (
    _req: NextRequest,
    { params }: { params: Promise<{ id: string; version: string }> },
  ) => {
    const { id, version } = await params;
    const owned = await requireOwnedSession(id);
    if (!owned) {
      return new Response("Session not found", { status: 404 });
    }
    setContextUserId(owned.user.email);

    const versionNum = Number.parseInt(version, 10);
    if (!Number.isInteger(versionNum) || versionNum < 1) {
      return new Response("Invalid version", { status: 400 });
    }

    if (!wizardApiEnabled()) {
      return new Response("wizard_api required for version restore", { status: 503 });
    }

    try {
      const detail = await apiRestoreVersion(id, versionNum);
      audit("blueprint.version.restore", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: "success",
        restoredVersion: versionNum,
        newVersion: detail.active_version,
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
      logger.error(
        { traceId: getTraceId(), err, sessionId: id, version: versionNum },
        "blueprint.version.restore failed",
      );
      const message = err instanceof Error ? err.message : "restore failed";
      const status = message.includes("404") ? 404 : 500;
      audit("blueprint.version.restore", {
        actor: owned.user.email,
        resource: { type: "session", id },
        outcome: status === 404 ? "denied" : "error",
        restoredVersion: versionNum,
      });
      return new Response(message, { status });
    }
  },
);
