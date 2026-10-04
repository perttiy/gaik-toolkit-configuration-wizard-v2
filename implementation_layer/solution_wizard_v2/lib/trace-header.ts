/**
 * Just the header name, split out from lib/request-context.ts so that
 * Edge runtime code (middleware.ts) can reference it without pulling in
 * node:crypto / node:async_hooks, which webpack can't bundle for Edge.
 */
export const TRACE_HEADER = "x-trace-id";

/** Longest trace id we accept from a caller; our own ids are 36-char UUIDs. */
export const TRACE_ID_MAX_LENGTH = 128;

const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

/**
 * Accept an incoming `x-trace-id` only when it looks like a trace id: a short
 * token of letters, digits, dot, underscore, colon and dash. Anything else
 * (empty, overlong, whitespace, punctuation) returns null and the caller
 * generates a fresh id instead. The value is echoed on our responses, written
 * to every log line and forwarded to wizard_api, so the client must not get
 * to choose its shape freely.
 */
export function sanitizeTraceId(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length > TRACE_ID_MAX_LENGTH) return null;
  return TRACE_ID_PATTERN.test(value) ? value : null;
}
