import { describe, expect, it } from "vitest";
import { TRACE_ID_MAX_LENGTH, sanitizeTraceId } from "@/lib/trace-header";

describe("sanitizeTraceId", () => {
  it("keeps a uuid, an opentelemetry-style hex id and a dotted/colon token", () => {
    expect(sanitizeTraceId("3f2a9c1e-7b4d-4e8a-9c21-0f6d5e4b3a21")).toBe(
      "3f2a9c1e-7b4d-4e8a-9c21-0f6d5e4b3a21",
    );
    expect(sanitizeTraceId("4bf92f3577b34da6a3ce929d0e0e4736")).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
    expect(sanitizeTraceId("web.req_12:ab-cd")).toBe("web.req_12:ab-cd");
  });

  it("rejects an empty or missing value", () => {
    expect(sanitizeTraceId(null)).toBeNull();
    expect(sanitizeTraceId(undefined)).toBeNull();
    expect(sanitizeTraceId("")).toBeNull();
  });

  it("rejects whitespace, quotes, slashes and other punctuation", () => {
    expect(sanitizeTraceId("abc def")).toBeNull();
    expect(sanitizeTraceId('abc"def')).toBeNull();
    expect(sanitizeTraceId("../etc/passwd")).toBeNull();
    expect(sanitizeTraceId("id\tinjected=1")).toBeNull();
    expect(sanitizeTraceId("<script>")).toBeNull();
    expect(sanitizeTraceId("ääkköset")).toBeNull();
  });

  it("rejects a value longer than the limit", () => {
    expect(sanitizeTraceId("a".repeat(TRACE_ID_MAX_LENGTH))).toHaveLength(TRACE_ID_MAX_LENGTH);
    expect(sanitizeTraceId("a".repeat(TRACE_ID_MAX_LENGTH + 1))).toBeNull();
  });
});
