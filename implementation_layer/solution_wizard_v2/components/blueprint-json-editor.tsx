"use client";

import { useEffect, useState } from "react";
import type { Blueprint, BlueprintVersion } from "@/lib/mock-sessions";
import { parseBlueprintJson } from "@/lib/blueprint-parse";
import type { Dict } from "@/lib/i18n";

export function BlueprintJsonEditor({
  sessionId,
  blueprint,
  versions,
  activeVersion,
  onSaved,
  t,
}: {
  sessionId: string;
  blueprint: Blueprint;
  versions: BlueprintVersion[];
  activeVersion: number;
  onSaved: (blueprint: Blueprint, meta?: { activeVersion: number; versions: BlueprintVersion[] }) => void;
  t: Dict;
}) {
  const [text, setText] = useState(() => JSON.stringify(blueprint, null, 2));
  const [saving, setSaving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [parseError, setParseError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [undoError, setUndoError] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [undoneFlash, setUndoneFlash] = useState(false);
  const [localActive, setLocalActive] = useState(activeVersion);
  const [localVersions, setLocalVersions] = useState(versions);

  useEffect(() => {
    setText(JSON.stringify(blueprint, null, 2));
    setParseError(false);
    setSaveError(false);
    setUndoError(false);
  }, [blueprint]);

  useEffect(() => {
    setLocalActive(activeVersion);
    setLocalVersions(versions);
  }, [activeVersion, versions]);

  const canUndo = localActive > 1;

  async function handleSave() {
    const parsed = parseBlueprintJson(text);
    if (!parsed) {
      setParseError(true);
      setSaveError(false);
      return;
    }
    setSaving(true);
    setParseError(false);
    setSaveError(false);
    setSavedFlash(false);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/blueprint`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: parsed,
          note: "Blueprint päivitetty JSON-editorista",
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = (await res.json()) as {
        blueprint: Blueprint;
        activeVersion?: number;
        versions?: BlueprintVersion[];
      };
      onSaved(data.blueprint, {
        activeVersion: data.activeVersion ?? localActive + 1,
        versions: data.versions ?? localVersions,
      });
      setText(JSON.stringify(data.blueprint, null, 2));
      if (typeof data.activeVersion === "number") setLocalActive(data.activeVersion);
      if (data.versions) setLocalVersions(data.versions);
      else setLocalActive((v) => v + 1);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  async function handleUndo() {
    if (!canUndo) return;
    const target = localActive - 1;
    setUndoing(true);
    setUndoError(false);
    setUndoneFlash(false);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/versions/${target}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: "Undo last change" }),
        },
      );
      if (!res.ok) throw new Error("undo failed");
      const data = (await res.json()) as {
        blueprint: Blueprint;
        activeVersion: number;
        versions?: BlueprintVersion[];
      };
      setLocalActive(data.activeVersion);
      if (data.versions) setLocalVersions(data.versions);
      setText(JSON.stringify(data.blueprint, null, 2));
      onSaved(data.blueprint, {
        activeVersion: data.activeVersion,
        versions: data.versions ?? localVersions,
      });
      setUndoneFlash(true);
      window.setTimeout(() => setUndoneFlash(false), 2500);
    } catch {
      setUndoError(true);
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-brand shrink-0"
          onClick={handleSave}
          disabled={saving || undoing}
          data-testid="blueprint-save"
        >
          {saving ? t.wsJsonSaving : t.wsJsonSave}
        </button>
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={handleUndo}
          disabled={!canUndo || saving || undoing}
          data-testid="blueprint-undo"
          title={
            canUndo
              ? t.wsJsonUndoHint.replace("{version}", String(localActive - 1))
              : t.wsJsonUndoDisabled
          }
        >
          {undoing ? t.wsJsonUndoing : t.wsJsonUndo}
        </button>
        <span
          className="text-xs text-text-muted"
          data-testid="blueprint-version-label"
        >
          {t.activeBlueprint} v{localActive} · {localVersions.length} {t.versions}
        </span>
        {savedFlash && <span className="badge-success text-xs">{t.wsJsonSaved}</span>}
        {undoneFlash && (
          <span className="badge-success text-xs" data-testid="blueprint-undo-ok">
            {t.wsJsonUndone}
          </span>
        )}
        {parseError && (
          <span className="badge bg-danger-bg border-danger-border text-danger-text text-xs">
            {t.wsJsonInvalid}
          </span>
        )}
        {saveError && (
          <span className="badge bg-danger-bg border-danger-border text-danger-text text-xs">
            {t.wsJsonSaveError}
          </span>
        )}
        {undoError && (
          <span
            className="badge bg-danger-bg border-danger-border text-danger-text text-xs"
            data-testid="blueprint-undo-error"
          >
            {t.wsJsonUndoError}
          </span>
        )}
      </div>
      <p className="shrink-0 text-xs text-text-muted">{t.wsJsonHint}</p>
      <textarea
        className="input-field min-h-[420px] flex-1 font-mono text-xs leading-5 resize-y"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setParseError(false);
          setSaveError(false);
        }}
        spellCheck={false}
        aria-label={t.wsTabJson}
        data-testid="blueprint-json-editor"
      />
    </div>
  );
}
