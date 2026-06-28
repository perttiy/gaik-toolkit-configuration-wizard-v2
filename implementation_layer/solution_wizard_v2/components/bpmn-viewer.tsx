"use client";

import { useEffect, useRef, useState } from "react";
import type NavigatedViewer from "bpmn-js/lib/NavigatedViewer";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";

export function BpmnViewer({
  xml,
  ariaLabel,
  loadErrorLabel,
}: {
  xml: string;
  ariaLabel: string;
  loadErrorLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<NavigatedViewer | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;

    (async () => {
      setError(null);
      viewerRef.current?.destroy();
      viewerRef.current = null;

      const { default: Viewer } = await import("bpmn-js/lib/NavigatedViewer");
      if (cancelled) return;

      const viewer = new Viewer({ container });
      viewerRef.current = viewer;

      try {
        await viewer.importXML(xml);
        const canvas = viewer.get("canvas") as { zoom: (mode: string) => void };
        canvas.zoom("fit-viewport");
      } catch {
        if (!cancelled) setError(loadErrorLabel);
      }
    })();

    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [xml, loadErrorLabel]);

  if (error) {
    return (
      <p className="text-sm text-danger-text" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full min-h-[420px] rounded-lg border border-border bg-surface overflow-hidden [&_.bjs-powered-by]:hidden"
      aria-label={ariaLabel}
    />
  );
}
