"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/mock-sessions";
import { ChatPanel } from "./chat-panel";
import { RobotHex } from "./robot-avatar";

const MIN_WIDTH_PX = 320;
const MAX_WIDTH_PX = 720;
const DEFAULT_WIDTH_PX = 384; // matches --width-chat
const DEFAULT_WIDE_WIDTH_PX = 512; // matches --width-chat-wide
const STORAGE_KEY = "wizardv2-chat-width-px";

function clampWidth(px: number): number {
  return Math.min(MAX_WIDTH_PX, Math.max(MIN_WIDTH_PX, px));
}

export function ChatDock({
  sessionId,
  initialMessages,
  chatTitle,
  greeting,
  inputPlaceholder,
  inputLabel,
  sendLabel,
  streamFailedLabel,
  thinkingLabel,
  hideChatLabel,
  showChatLabel,
  railBadge,
  userInitial,
  defaultOpen = true,
  wide = false,
}: {
  sessionId: string;
  initialMessages: ChatMessage[];
  chatTitle: string;
  greeting: string;
  inputPlaceholder: string;
  inputLabel: string;
  sendLabel: string;
  streamFailedLabel: string;
  thinkingLabel: string;
  hideChatLabel: string;
  showChatLabel: string;
  railBadge: string;
  userInitial: string;
  /** false on BPMN+ workspace steps so the canvas gets the viewport (MIC012). */
  defaultOpen?: boolean;
  /** wider panel while the chat is the focus (gathering / Q&A). */
  wide?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // Kept here (not in ChatPanel) so a half-typed message survives hide/show —
  // ChatPanel unmounts when the dock collapses to the rail.
  const [chatInput, setChatInput] = useState("");
  const panelId = useId();

  // User-resizable width (#2 — customer feedback: no way to widen the chat panel,
  // had to horizontal-scroll to read messages). null = no manual override yet, use
  // the step-driven default (wide/normal). Read from localStorage lazily so SSR and
  // the client's first render agree (localStorage isn't available server-side).
  const [customWidthPx, setCustomWidthPx] = useState<number | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Runs after hydration, so the first client render matches SSR (both start at
  // the step-driven default) and this only adjusts width once mounted.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setCustomWidthPx(clampWidth(Number(saved)));
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to defaults.
    }
  }, []);

  // Soft navigations keep this client tree mounted — follow step-driven default.
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  const defaultWidthPx = wide ? DEFAULT_WIDE_WIDTH_PX : DEFAULT_WIDTH_PX;
  const widthPx = customWidthPx ?? defaultWidthPx;

  function startDrag(clientX: number) {
    dragStateRef.current = { startX: clientX, startWidth: widthPx };

    function onMove(e: PointerEvent) {
      const state = dragStateRef.current;
      if (!state) return;
      // Panel sits on the right edge — dragging left (negative dx) grows it.
      const next = clampWidth(state.startWidth - (e.clientX - state.startX));
      setCustomWidthPx(next);
    }

    function onUp() {
      dragStateRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setCustomWidthPx((current) => {
        if (current !== null) {
          try {
            window.localStorage.setItem(STORAGE_KEY, String(current));
          } catch {
            // ignore — resize still works this session, just won't persist
          }
        }
        return current;
      });
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <aside
      role="complementary"
      aria-label={chatTitle}
      data-testid="chat-dock"
      data-chat-open={open ? "true" : "false"}
      style={open ? { width: `${widthPx}px` } : undefined}
      className={`chat-bg relative shrink-0 border-l border-border flex flex-col min-h-0 ${
        open ? "" : "w-[var(--width-chat-rail)] transition-[width] duration-200 motion-reduce:transition-none"
      }`}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`${chatTitle} — resize`}
          aria-valuenow={widthPx}
          aria-valuemin={MIN_WIDTH_PX}
          aria-valuemax={MAX_WIDTH_PX}
          tabIndex={0}
          data-testid="chat-dock-resize-handle"
          onPointerDown={(e) => {
            e.preventDefault();
            startDrag(e.clientX);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setCustomWidthPx(clampWidth(widthPx + 16));
            if (e.key === "ArrowRight") setCustomWidthPx(clampWidth(widthPx - 16));
          }}
          className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-px cursor-col-resize touch-none hover:bg-brand/40 active:bg-brand/60"
        />
      )}

      <button
        type="button"
        data-testid="chat-dock-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? hideChatLabel : showChatLabel}
        className="absolute -left-3 top-1/2 -translate-y-1/2 z-10 flex h-14 w-6 flex-col items-center justify-center gap-0.5 rounded-lg border border-border-strong bg-surface-muted text-text-muted shadow-[-2px_0_8px_rgba(0,0,0,0.35)] transition-colors hover:border-brand hover:text-brand-strong"
      >
        <span className="h-0.5 w-0.5 rounded-full bg-current opacity-60" aria-hidden />
        <span className="text-sm leading-none" aria-hidden>
          {open ? "›" : "‹"}
        </span>
        <span className="h-0.5 w-0.5 rounded-full bg-current opacity-60" aria-hidden />
      </button>

      {open ? (
        <ChatPanel
          id={panelId}
          sessionId={sessionId}
          initialMessages={initialMessages}
          chatTitle={chatTitle}
          greeting={greeting}
          inputPlaceholder={inputPlaceholder}
          inputLabel={inputLabel}
          sendLabel={sendLabel}
          streamFailedLabel={streamFailedLabel}
          thinkingLabel={thinkingLabel}
          inputValue={chatInput}
          onInputChange={setChatInput}
          userInitial={userInitial}
        />
      ) : (
        <div className="flex h-full flex-col items-center gap-4 py-4">
          <RobotHex px={28} />
          <span className="[writing-mode:vertical-rl] text-xs font-semibold tracking-wide text-text-muted">
            {chatTitle}
          </span>
          <span className="[writing-mode:vertical-rl] rounded-full bg-brand-soft px-0.5 py-1.5 text-xs font-semibold text-brand-text">
            {railBadge}
          </span>
        </div>
      )}
    </aside>
  );
}

