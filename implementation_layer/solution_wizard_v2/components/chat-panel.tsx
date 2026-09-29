"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage, ChatRole } from "@/lib/mock-sessions";
import { renderMarkdown } from "@/lib/markdown";
import { RobotHex, UserAvatar } from "./robot-avatar";

function MessageRow({
  role,
  userInitial,
  markdown = false,
  children,
}: {
  role: ChatRole;
  userInitial: string;
  markdown?: boolean;
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex items-end gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      {isUser ? <UserAvatar initial={userInitial} /> : <RobotHex px={28} />}
      <div
        className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-xs ${
          markdown ? "chat-md" : "whitespace-pre-wrap"
        } ${
          isUser
            ? "bg-brand text-on-brand font-medium rounded-br-md"
            : "bg-surface/70 backdrop-blur-md text-text-secondary border border-border rounded-bl-md"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

// Past this, a bare "thinking" cue reads as a frozen chat — a blueprint or
// scaffolding turn really does take minutes — so say the work is still going.
const STILL_WORKING_AFTER_MS = 20_000;

// Shown in the assistant bubble while waiting for the first token — a clear
// "the wizard is thinking" cue (the real agent can take 30–60 s on turn one).
function TypingIndicator({
  label,
  stillWorkingLabel,
}: {
  label: string;
  stillWorkingLabel: string;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), STILL_WORKING_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <span className="inline-flex flex-col gap-1.5 py-0.5">
      <span
        className="inline-flex items-center gap-1.5"
        role="status"
        aria-label={label}
      >
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-muted" />
      </span>
      {slow ? (
        <span className="text-xs text-text-muted" data-testid="chat-still-working">
          {stillWorkingLabel}
        </span>
      ) : null}
    </span>
  );
}

function newMessageId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function ChatPanel({
  id,
  sessionId,
  initialMessages,
  chatTitle,
  greeting,
  inputPlaceholder,
  inputLabel,
  sendLabel,
  streamFailedLabel,
  thinkingLabel,
  stillWorkingLabel,
  emptyReplyLabel,
  inputValue,
  onInputChange,
  userInitial,
}: {
  id: string;
  sessionId: string;
  initialMessages: ChatMessage[];
  chatTitle: string;
  greeting: string;
  inputPlaceholder: string;
  inputLabel: string;
  sendLabel: string;
  streamFailedLabel: string;
  thinkingLabel: string;
  stillWorkingLabel: string;
  emptyReplyLabel: string;
  inputValue: string;
  onInputChange: (value: string) => void;
  userInitial: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inputId = `${id}-input`;
  const router = useRouter();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  // Messages appended on the server — gate approve / request-changes / reject
  // post the reviewer's reason and the wizard's acknowledgement — arrive as new
  // props after revalidation. This state was seeded once, so without adopting
  // them the chat showed nothing until a manual reload: the "no visible
  // feedback" half of #126. Only grow from the server list, so an optimistic
  // message added by `send()` (not yet persisted) is never dropped, and never
  // mid-stream.
  useEffect(() => {
    if (streaming) return;
    setMessages((current) =>
      initialMessages.length > current.length ? initialMessages : current,
    );
  }, [initialMessages, streaming]);

  // Grow the textarea to fit its content (multi-line), capped so it scrolls.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [inputValue]);

  async function send(e?: React.FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const text = inputValue.trim();
    if (!text || streaming) return;

    const ts = new Date().toISOString();
    const userId = newMessageId();
    const asstId = newMessageId();

    onInputChange("");
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", content: text, createdAt: ts },
      { id: asstId, role: "assistant", content: "", createdAt: ts },
    ]);
    setStreaming(true);

    try {
      const res = await fetch(`/api/sessions/${sessionId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) throw new Error("stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotText = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.startsWith("data: ") ? frame.slice(6) : frame;
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.error) throw new Error("stream error");
          if (evt.delta) {
            gotText = true;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstId ? { ...m, content: m.content + evt.delta } : m,
              ),
            );
          }
        }
      }
      // A stream that ends without a word is a failed turn, not an answer:
      // leaving the bubble empty looks like the wizard chose to say nothing.
      if (!gotText) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === asstId && !m.content
              ? { ...m, content: `⚠︎ ${emptyReplyLabel}` }
              : m,
          ),
        );
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === asstId && !m.content
            ? { ...m, content: `⚠︎ ${streamFailedLabel}` }
            : m,
        ),
      );
    } finally {
      setStreaming(false);
      // Re-render server components so the requirements checklist / phase reflect
      // any answer recorded during this exchange.
      router.refresh();
    }
  }

  return (
    <div id={id} className="flex flex-col h-full min-h-0">
      <h2 className="shrink-0 h-11 px-5 flex items-center gap-2 border-b border-border text-xs font-semibold uppercase tracking-wider text-text-muted">
        <RobotHex px={22} />
        {chatTitle}
      </h2>

      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        className="flex-1 overflow-auto px-4 py-4 space-y-3"
      >
        <MessageRow role="assistant" userInitial={userInitial}>
          {greeting}
        </MessageRow>

        {messages.map((m) => {
          const isAsst = m.role === "assistant";
          return (
            <MessageRow
              key={m.id}
              role={m.role}
              userInitial={userInitial}
              markdown={isAsst && !!m.content}
            >
              {m.content ? (
                isAsst ? (
                  <div
                    className="chat-md-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                  />
                ) : (
                  m.content
                )
              ) : streaming ? (
                <TypingIndicator
                  label={thinkingLabel}
                  stillWorkingLabel={stillWorkingLabel}
                />
              ) : null}
            </MessageRow>
          );
        })}
      </div>

      <form
        onSubmit={send}
        className="shrink-0 flex items-end gap-2 px-4 py-3 border-t border-border bg-surface/60 backdrop-blur-md"
      >
        <label htmlFor={inputId} className="sr-only">
          {inputLabel}
        </label>
        <textarea
          ref={textareaRef}
          id={inputId}
          name="message"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter inserts a newline.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          autoComplete="off"
          placeholder={inputPlaceholder}
          className="input-field max-h-40 resize-none overflow-y-auto"
        />
        <button
          type="submit"
          disabled={streaming}
          className="btn-brand px-3"
        >
          {sendLabel}
        </button>
      </form>
    </div>
  );
}
