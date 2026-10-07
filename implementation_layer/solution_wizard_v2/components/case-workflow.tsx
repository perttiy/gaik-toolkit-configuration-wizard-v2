"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaseStrings } from "@/lib/case-strings";
import { renderMarkdown } from "@/lib/markdown";
import {
  type Case,
  type CaseModel,
  type CaseRecord,
  type CaseSummary,
  type OutputSpec,
  type ProcessNode,
  citedInputs,
  currentTask,
  elapsed,
  findInText,
  groupCases,
  isLastInput,
  logTail,
  shortStepName,
  fieldProblem,
  formFields,
  formatOf,
  humanize,
  isAudioInput,
  isDocument,
  isList,
  isStructured,
  isTable,
  parseInput,
  problemCount,
  rowProblems,
  shapeProcess,
  show,
  stepState,
  tableColumns,
  toCsv,
  toMarkdown,
  uncertainField,
} from "@/lib/case-process";

type Props = { sessionId: string; strings: CaseStrings; dateLocale: string };

const LANE_COLORS = ["#0277c0", "#8a2387", "#2f7a2b", "#b0602f"];

async function detailOf(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  const d = (body as { detail?: unknown }).detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && "message" in d) return String((d as { message: unknown }).message);
  return `HTTP ${res.status}`;
}

function download(name: string, type: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function CaseWorkflow({ sessionId, strings: s, dateLocale }: Props) {
  const base = `/api/sessions/${sessionId}/cases`;
  const [model, setModel] = useState<CaseModel | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [current, setCurrent] = useState<Case | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const shaped = useMemo(() => (model ? shapeProcess(model.process) : null), [model]);
  const laneColor = useCallback(
    (laneId: string | null | undefined) => {
      const i = model?.process.lanes.findIndex((l) => l.id === laneId) ?? -1;
      return LANE_COLORS[Math.max(0, i) % LANE_COLORS.length];
    },
    [model],
  );

  const loadCases = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    if (res.ok) setCases(((await res.json()) as { cases: typeof cases }).cases);
  }, [base]);

  const loadCase = useCallback(
    async (id: string) => {
      const res = await fetch(`${base}/${id}`, { cache: "no-store" });
      if (!res.ok) return setError(await detailOf(res));
      setCurrent((await res.json()) as Case);
    },
    [base],
  );

  useEffect(() => {
    (async () => {
      const res = await fetch(`${base}/model`, { cache: "no-store" });
      if (!res.ok) return setModelError(await detailOf(res));
      const m = (await res.json()) as CaseModel;
      setModel(m);
      setRole(shapeProcess(m.process).roles[0]?.id ?? null);
      await loadCases();
    })();
  }, [base, loadCases]);

  // A running case settles on the server when its run has finished; ask until it has.
  useEffect(() => {
    if (current?.status !== "running") return;
    const timer = setInterval(() => void loadCase(current.id), 4000);
    return () => clearInterval(timer);
  }, [current?.status, current?.id, loadCase]);

  // When the case moves to another role's task, follow it.
  const task = shaped && current ? currentTask(shaped, current.status, current.steps_done) : undefined;
  // Keyed on the task, not only the status: one person's input step done moves
  // the case to the next person while it stays a draft.
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    const key = current ? `${current.status}:${task?.id ?? ""}` : null;
    if (!current || prevStatus.current === key) return;
    if (prevStatus.current !== null && task?.lane) setRole(task.lane);
    prevStatus.current = key;
    void loadCases();
  }, [current, task, loadCases]);

  async function act(fn: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(await detailOf(res));
        return null;
      }
      return res;
    } finally {
      setBusy(false);
    }
  }

  async function newCase() {
    const res = await act(() => fetch(base, { method: "POST" }));
    if (!res) return;
    const c = (await res.json()) as Case;
    prevStatus.current = null;
    setRole(shaped?.inputTask?.lane ?? role);
    await loadCase(c.id);
    await loadCases();
  }

  if (modelError) {
    return <p className="badge-warning">{s.loadError} {modelError}</p>;
  }
  if (!model || !shaped) return <p className="text-sm text-text-muted">…</p>;

  const roleName = (id: string | null | undefined) =>
    model.process.lanes.find((l) => l.id === id)?.name ?? s.aiRole;
  const statusBadge = (st: Case["status"]) =>
    st === "approved" || st === "completed" ? "badge-success" : st === "review" || st === "draft" ? "badge-warning" : st === "running" ? "badge-info" : "badge";

  // The role the open case is shown as, so the list and the case agree.
  const listRole = role ?? task?.lane ?? shaped.roles[0]?.id ?? null;
  const groups = groupCases(cases, shaped, listRole);
  const number = (id: string) => cases.length - cases.findIndex((c) => c.id === id);
  const caseButton = (c: CaseSummary) => (
    <li key={c.id}>
      <button
        type="button"
        onClick={() => { prevStatus.current = null; void loadCase(c.id).then(() => setRole(null)); }}
        className={`w-full text-left rounded-md px-2 py-1.5 text-sm ${current?.id === c.id ? "bg-brand-soft" : "hover:bg-surface-muted"}`}
      >
        <span className="font-medium">#{number(c.id)}</span>{" "}
        <span className={statusBadge(c.status)}>{s.status[c.status]}</span>
        <span className="block text-xs text-text-muted">
          {new Date(c.created_at).toLocaleString(dateLocale, { dateStyle: "short", timeStyle: "short" })}
        </span>
      </button>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-text">{model.title}</h1>
          {/* For the designer: how the view came about. The people using it do not need it. */}
          <details className="mt-1 text-sm text-text-muted max-w-3xl">
            <summary className="cursor-pointer select-none text-xs">{s.howBuilt}</summary>
            <p className="mt-1">{s.intro}</p>
          </details>
        </div>
        <button type="button" className="btn-brand" onClick={newCase} disabled={busy || !model.package_ready} data-testid="case-new">
          {s.newCase}
        </button>
      </div>

      {!model.package_ready && (
        <p className="badge-warning">{s.notReady} {model.package_problems.join("; ")}</p>
      )}
      {error && (
        <p className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-sm text-danger-text" role="alert">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* On a phone the open case takes the screen; the list is one tap back. */}
        <aside className={`rounded-lg border border-border bg-surface p-3 self-start ${current ? "hidden lg:block" : ""}`} data-testid="case-list">
          <h2 className="text-sm font-semibold mb-1">
            {s.yourCases}
            {listRole && <span className="font-normal text-text-muted"> · {roleName(listRole)}</span>}
          </h2>
          {groups.mine.length === 0 ? (
            <p className="text-xs text-text-muted mb-2">{s.noneWaiting}</p>
          ) : (
            <ul className="flex flex-col gap-1 mb-2" data-testid="case-list-mine">{groups.mine.map(caseButton)}</ul>
          )}
          {groups.open.length > 0 && (
            <details open className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-text-secondary">{s.openCases} ({groups.open.length})</summary>
              <ul className="flex flex-col gap-1 mt-1">{groups.open.map(caseButton)}</ul>
            </details>
          )}
          {groups.done.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-text-secondary">{s.doneCases} ({groups.done.length})</summary>
              <ul className="flex flex-col gap-1 mt-1">{groups.done.map(caseButton)}</ul>
            </details>
          )}
        </aside>

        {current ? (
          <CaseView
            key={current.id}
            caseData={current}
            model={model}
            shaped={shaped}
            role={role ?? task?.lane ?? shaped.roles[0]?.id ?? null}
            setRole={setRole}
            laneColor={laneColor}
            roleName={roleName}
            base={`${base}/${current.id}`}
            s={s}
            dateLocale={dateLocale}
            busy={busy}
            act={act}
            reload={() => loadCase(current.id)}
            statusBadge={statusBadge}
            onBack={() => { setCurrent(null); void loadCases(); }}
          />
        ) : (
          <div className="hidden lg:block rounded-lg border border-dashed border-border-strong p-8 text-center text-sm text-text-muted">
            {s.noCases}
          </div>
        )}
      </div>
    </div>
  );
}

type ViewProps = {
  caseData: Case;
  model: CaseModel;
  shaped: ReturnType<typeof shapeProcess>;
  role: string | null;
  setRole: (r: string) => void;
  laneColor: (id: string | null | undefined) => string;
  roleName: (id: string | null | undefined) => string;
  base: string;
  s: CaseStrings;
  dateLocale: string;
  busy: boolean;
  act: (fn: () => Promise<Response>) => Promise<Response | null>;
  reload: () => Promise<void>;
  statusBadge: (st: Case["status"]) => string;
  onBack?: () => void;
  // The value of the field the reviewer is on, highlighted in the source.
  focus?: unknown;
  setFocus?: (v: unknown) => void;
  // An input file opened beside the review.
  preview?: string | null;
  setPreview?: (name: string | null) => void;
};

function CaseView(props: ViewProps) {
  const [focus, setFocus] = useState<unknown>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const p = { ...props, focus, setFocus, preview, setPreview };
  const { caseData: c, shaped, s, role } = p;
  const task = currentTask(shaped, c.status, c.steps_done);
  const mine = task && task.lane === role;
  const inputScreen = !!mine && shaped.inputTasks.includes(task as ProcessNode);

  return (
    <section className="flex flex-col gap-4 min-w-0">
      {p.onBack && (
        <button type="button" className="lg:hidden self-start text-sm text-brand-strong underline" onClick={p.onBack}>
          ← {s.backToList}
        </button>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text-muted">{s.role}:</span>
        {shaped.roles.map((l) => {
          const turn = task?.lane === l.id;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => p.setRole(l.id)}
              data-testid={`case-role-${l.id}`}
              className={`inline-flex items-center gap-2 rounded-full border-2 px-3 py-1 text-sm font-medium ${role === l.id ? "" : "border-border"}`}
              style={role === l.id ? { borderColor: p.laneColor(l.id) } : undefined}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.laneColor(l.id) }} />
              {l.name}
              {turn && <span className="rounded-full bg-danger-text px-1.5 text-xs text-white">{s.yourTurn}</span>}
            </button>
          );
        })}
        <span className={`ml-auto ${p.statusBadge(c.status)}`} data-testid="case-status">
          {s.status[c.status]}
          {c.round > 1 ? ` · ${s.roundLabel} ${c.round}` : ""}
        </span>
      </div>

      {/* The person giving the input on a phone needs their task, not the whole process. */}
      <ol className={`${inputScreen ? "hidden sm:flex" : "flex"} gap-0 overflow-x-auto pb-1`} aria-label="steps">
        {shaped.steps.map((n) => {
          const st = stepState(shaped, c.status, n, c.steps_done);
          return (
            <li
              key={n.id}
              title={n.name}
              className={`min-w-[104px] flex-1 border-t-4 px-2 py-1.5 text-xs ${st === "current" ? "bg-surface rounded-b-md" : ""}`}
              style={{ borderTopColor: st === "todo" ? "var(--color-border)" : st === "done" ? "var(--color-success-text)" : p.laneColor(n.lane) }}
            >
              <span className="block uppercase tracking-wide text-[10px] truncate" style={{ color: p.laneColor(n.lane) }}>
                {p.roleName(n.lane)}
              </span>
              <span className="font-semibold text-text leading-tight">{shortStepName(n.name, 28)}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="rounded-lg border border-border bg-surface p-4 min-w-0">
          {c.status === "running" ? (
            <RunningView {...p} />
          ) : c.status === "approved" || c.status === "rejected" || c.status === "completed" ? (
            <DoneView {...p} />
          ) : !mine ? (
            <div>
              <h3 className="font-semibold">{s.nothingForYou}</h3>
              {task && (
                <p className="text-sm text-text-muted mt-1">
                  {s.caseAt} <b>{task.name}</b> – {s.ownedBy} <b>{p.roleName(task.lane)}</b>.{" "}
                  <button type="button" className="underline text-brand-strong" onClick={() => task.lane && p.setRole(task.lane)}>
                    {s.switchRole} {p.roleName(task.lane)}
                  </button>
                </p>
              )}
            </div>
          ) : shaped.inputTasks.includes(task as ProcessNode) ? (
            <InputView key={task?.id} {...p} task={task as ProcessNode} />
          ) : (
            <ReviewView {...p} />
          )}
        </div>
        <div className={inputScreen ? "hidden xl:block" : ""}>
          <SourceView {...p} />
        </div>
      </div>
    </section>
  );
}

/** The AI step while it runs: the run's phase, time since sending, and its live log. */
function RunningView(p: ViewProps) {
  const { caseData: c, s, shaped } = p;
  const [lines, setLines] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const sentAt = [...c.events].reverse().find((e) => e.action === "submit")?.at;
  const sender = shaped.inputTasks.some((n) => n.lane === p.role);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // The run's own log, as the PoC tab follows it; the case settles by polling.
  useEffect(() => {
    if (!c.run_id) return;
    const url = p.base.replace(/\/cases\/[^/]+$/, `/runs/${encodeURIComponent(c.run_id)}/stream`);
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data) as { log?: string; done?: boolean };
        if (typeof d.log === "string") setLines((prev) => [...prev.slice(-200), d.log as string]);
        if (d.done) { es.close(); void p.reload(); }
      } catch {
        /* a frame that is not JSON is skipped */
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.run_id]);

  const tail = logTail(lines);
  return (
    <div data-testid="case-running" className="flex flex-col gap-3">
      {sender && (
        <div className="rounded-md border border-success-border bg-success-bg px-3 py-3" data-testid="case-sent">
          <p className="font-semibold text-success-text">✓ {s.sentTitle}</p>
          <p className="text-sm text-text-secondary">{s.sentHint}</p>
        </div>
      )}
      <h3 className="font-semibold">
        <span className="mr-2 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-brand align-[-2px]" />
        {s.aiRunning}
      </h3>
      <p className="text-sm text-text-muted">
        {c.run_phase === "pending" || (!c.run_phase && lines.length === 0) ? s.phasePending : s.phaseRunning}
        {sentAt ? ` · ${elapsed(sentAt, now)}` : ""}
      </p>
      <ul className="text-sm list-disc pl-5">{shaped.aiSteps.map((n) => <li key={n.id}>{n.name}</li>)}</ul>
      {tail.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-text-secondary mb-1">{s.runLog}</h4>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-app p-2 text-[11px] leading-snug" data-testid="case-log">
            {tail.join("\n")}
          </pre>
        </div>
      )}
    </div>
  );
}

function InputView(p: ViewProps & { task: ProcessNode }) {
  const { caseData: c, s, base } = p;
  const [note, setNote] = useState(c.notes?.[p.task.id] ?? "");
  const first = p.shaped.inputTasks[0];
  // A file belongs to the step that uploaded it; untagged files to the first step.
  const mine = c.inputs.filter((f) => (f.task ?? first?.id) === p.task.id);
  const last = isLastInput(p.shaped, p.task);
  const earlier = p.shaped.inputTasks.filter((n) => n !== p.task && (c.steps_done ?? []).includes(n.id));
  const returnedHere = c.status === "returned" && (c.return_to ?? first?.id) === p.task.id;
  const [uploading, setUploading] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [take, setTake] = useState<{ file: File; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const audio = p.task.outputs.some(isAudioInput);

  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setTick(Date.now()), 500);
    return () => clearInterval(t);
  }, [startedAt]);
  useEffect(() => () => { if (take) URL.revokeObjectURL(take.url); }, [take]);

  async function upload(files: File[]) {
    setUploading(true);
    for (const f of files) {
      const form = new FormData();
      form.append("file", f, f.name);
      form.append("task", p.task.id);
      await p.act(() => fetch(`${base}/inputs`, { method: "POST", body: form }));
    }
    setUploading(false);
    await p.reload();
  }

  async function record() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        // Listened to first; uploaded only when the person keeps it.
        const file = new File(chunks, `recording-${stamp}.${ext}`, { type });
        setTake({ file, url: URL.createObjectURL(file) });
        setRecorder(null);
        setStartedAt(null);
      };
      rec.start();
      setRecorder(rec);
      setStartedAt(Date.now());
      setTake(null);
    } catch {
      alert(s.micError);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="case-input">
      <h3 className="font-semibold">{s.yourTask}: {p.task.name}</h3>
      {returnedHere && (
        <p className="rounded-md border-l-4 border-warning-border bg-warning-bg px-3 py-2 text-sm"><b>{s.returned}</b> {c.comment}</p>
      )}
      {earlier.length > 0 && (
        <div className="rounded-md border border-border bg-app px-3 py-2 text-sm" data-testid="case-earlier">
          <span className="font-semibold">{s.earlierSteps}:</span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {earlier.map((n) => (
              <li key={n.id}>
                <b>{p.roleName(n.lane)}</b> – {n.name}: {c.inputs.filter((f) => (f.task ?? first?.id) === n.id).map((f) => f.name).join(", ") || "—"}
                {c.notes?.[n.id] ? ` · “${c.notes[n.id]}”` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.status === "failed" && (
        <p className="rounded-md border-l-4 border-danger-border bg-danger-bg px-3 py-2 text-sm"><b>{s.failed}</b> {c.run_message}</p>
      )}
      <div>
        <span className="field-label">{p.task.outputs.filter(Boolean).join(", ") || "Input"} <span className="text-danger-text">*</span></span>
        <ul className="flex flex-col gap-1.5 mb-2" data-testid="case-inputs">
          {mine.map((f) => (
            <li key={f.name} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono text-xs">{f.name}</span>
              <span className="text-text-muted text-xs">{Math.max(1, Math.round(f.bytes / 1024))} kB</span>
              {/\.(wav|mp3|m4a|ogg|webm)$/i.test(f.name) && (
                <audio controls src={`${base}/inputs/${encodeURIComponent(f.name)}`} className="h-8 max-w-full" />
              )}
              <button
                type="button"
                className="text-xs text-danger-text underline"
                onClick={async () => { await p.act(() => fetch(`${base}/inputs/${encodeURIComponent(f.name)}`, { method: "DELETE" })); await p.reload(); }}
              >
                {s.remove}
              </button>
            </li>
          ))}
        </ul>
        {take && (
          <div className="mb-2 flex flex-col gap-2 rounded-md border border-border bg-app p-3" data-testid="case-take">
            <audio controls src={take.url} className="w-full" />
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-brand" onClick={() => { const f = take.file; setTake(null); void upload([f]); }}>
                {s.useRecording}
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setTake(null); void record(); }}>
                {s.recordAgain}
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {audio && !take && (recorder ? (
            <button type="button" className="btn-secondary w-full sm:w-auto py-4 sm:py-2 text-base sm:text-sm text-danger-text" onClick={() => recorder.stop()} data-testid="case-stop">
              <span className="h-3 w-3 rounded-full bg-danger-text animate-pulse" /> {s.stop}
              {startedAt ? ` · ${elapsed(new Date(startedAt).toISOString(), tick || Date.now())}` : ""}
            </button>
          ) : (
            <button type="button" className="btn-brand w-full sm:w-auto py-4 sm:py-2 text-base sm:text-sm" onClick={record} disabled={uploading} data-testid="case-record">
              ● {mine.length ? s.recordAgain : s.recordBig}
            </button>
          ))}
          <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={uploading || !!recorder}>
            {uploading ? s.uploading : s.upload}
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept={audio ? "audio/*" : undefined}
            data-testid="case-file"
            onChange={(e) => { const files = Array.from(e.target.files ?? []); e.target.value = ""; if (files.length) void upload(files); }}
          />
        </div>
      </div>
      <label className="block">
        <span className="field-label">{s.note}</span>
        <textarea className="input-field min-h-16" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div>
        <button
          type="button"
          className="btn-brand w-full sm:w-auto py-3 sm:py-2"
          data-testid="case-submit"
          disabled={p.busy || uploading || !!recorder || !!take || mine.length === 0}
          title={mine.length === 0 ? s.inputMissing : undefined}
          onClick={async () => {
            const body = JSON.stringify({ task: p.task.id, role: p.roleName(p.task.lane), note });
            const res = await p.act(() =>
              fetch(`${base}/${last ? "submit" : "step"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body }),
            );
            if (res) await p.reload();
          }}
        >
          {p.busy ? s.submitting : last ? s.submit : s.stepDone}
        </button>
      </div>
    </div>
  );
}

function ReviewView(p: ViewProps) {
  const { caseData: c, model, s, base } = p;
  const original = (c.result?.record ?? {}) as CaseRecord | CaseRecord[];
  const [rec, setRec] = useState<CaseRecord | CaseRecord[]>(() => structuredClone(c.record ?? original));
  const [ask, setAsk] = useState<null | "return" | "reject">(null);
  const [comment, setComment] = useState("");
  const [returnTo, setReturnTo] = useState<string>(p.shaped.inputTasks[0]?.id ?? "");
  const doc = isDocument(rec);
  const bad = doc ? docProblems(rec as CaseRecord) : problemCount(model.spec, rec);
  const reviewer = p.roleName(p.shaped.reviewTask?.lane);

  async function send(action: "approve" | "return" | "reject") {
    const res = await p.act(() =>
      fetch(`${base}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          role: reviewer,
          comment,
          record: action === "approve" ? rec : null,
          return_to: action === "return" ? returnTo : null,
        }),
      }),
    );
    if (res) await p.reload();
  }

  return (
    <div className="flex flex-col gap-3" data-testid="case-review">
      <h3 className="font-semibold">{s.yourTask}: {p.shaped.reviewTask?.name ?? s.reviewTitle}</h3>
      {p.shaped.inputTasks
        .filter((n) => c.notes?.[n.id] || (n === p.shaped.inputTasks.at(-1) && c.note && !c.notes?.[n.id]))
        .map((n) => (
          <p key={n.id} className="rounded-md border-l-4 border-info-border bg-info-bg px-3 py-2 text-sm">
            {p.roleName(n.lane)}: “{c.notes?.[n.id] || c.note}”
          </p>
        ))}
      {doc ? (
        <DocumentEditor rec={rec as CaseRecord} original={original as CaseRecord} setRec={setRec} s={s} inputs={c.inputs.map((f) => f.name)} onCite={p.setPreview} />
      ) : Array.isArray(rec) ? (
        <div className="flex flex-col gap-4">
          {rec.map((item, i) => (
            <fieldset key={i} className="rounded-md border border-border p-3">
              <legend className="px-1 text-sm font-semibold">{s.item} {i + 1}</legend>
              <RecordForm
                spec={model.spec}
                rec={item}
                original={((original as CaseRecord[])[i] ?? {}) as CaseRecord}
                setRec={(next) => setRec(rec.map((x, j) => (j === i ? next : x)))}
                s={s}
                onFocusField={p.setFocus}
              />
            </fieldset>
          ))}
        </div>
      ) : (
        <RecordForm spec={model.spec} rec={rec} original={original as CaseRecord} setRec={setRec} s={s} onFocusField={p.setFocus} />
      )}
      {/* Kept in view however long the form is: the decision is what this screen is for. */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 mt-2 flex flex-col gap-2 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-sm rounded-b-lg" data-testid="case-actions">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-brand" data-testid="case-approve" disabled={p.busy || bad > 0} onClick={() => send("approve")}>
          {s.approve}
        </button>
        <button type="button" className="btn-secondary" onClick={() => { setAsk("return"); setComment(""); }}>{s.returnForFix}</button>
        <button type="button" className="btn-secondary text-danger-text" onClick={() => { setAsk("reject"); setComment(""); }}>{s.reject}</button>
        <button type="button" className="ml-auto self-center text-xs text-text-muted underline" onClick={() => setRec(structuredClone(original))}>{s.restoreAll}</button>
      </div>
      {ask && (
        <div className="rounded-md border border-border-strong p-3 flex flex-col gap-2">
          <label className="field-label" htmlFor="case-comment">{ask === "return" ? s.askReturn : s.askReject}</label>
          <textarea id="case-comment" className="input-field" value={comment} onChange={(e) => setComment(e.target.value)} />
          {ask === "return" && p.shaped.inputTasks.length > 1 && (
            <label className="block">
              <span className="field-label">{s.returnTo}</span>
              <select className="input-field" value={returnTo} onChange={(e) => setReturnTo(e.target.value)} data-testid="case-return-to">
                {p.shaped.inputTasks.map((n) => (
                  <option key={n.id} value={n.id}>{p.roleName(n.lane)} – {n.name}</option>
                ))}
              </select>
            </label>
          )}
          {ask === "return" && !p.shaped.returnInDiagram && <p className="text-xs text-text-muted">{s.returnNotInDiagram}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-brand" data-testid="case-confirm" disabled={!comment.trim() || p.busy} onClick={() => send(ask)}>{s.confirm}</button>
            <button type="button" className="btn-ghost" onClick={() => setAsk(null)}>{s.cancel}</button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

type Section = { id?: string; title?: string; text?: string };
const docProblems = (rec: CaseRecord) =>
  ((rec.sections as Section[]) ?? []).filter((x) => !String(x.text ?? "").trim()).length;

/**
 * Report markdown rendered safely, with each `[file]` the case has turned into a
 * button that opens that source beside the report.
 */
function MarkdownWithSources({ text, inputs, onCite }: { text: string; inputs: string[]; onCite?: (name: string) => void }) {
  let html = renderMarkdown(text);
  for (const name of citedInputs(text, inputs)) {
    const shown = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    html = html.split(`[${shown}]`).join(`<button type="button" data-src="${shown}" class="case-cite">[${shown}]</button>`);
  }
  return (
    <div
      className="case-md text-sm leading-relaxed"
      onClick={(e) => {
        const src = (e.target as HTMLElement).closest("[data-src]")?.getAttribute("data-src");
        if (src && onCite) onCite(src);
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function DocumentEditor({ rec, original, setRec, s, inputs, onCite }: { rec: CaseRecord; original: CaseRecord; setRec: (r: CaseRecord) => void; s: CaseStrings; inputs: string[]; onCite?: (name: string) => void }) {
  const sections = (rec.sections as Section[]) ?? [];
  const before = (original.sections as Section[]) ?? [];
  const [editing, setEditing] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setEditing((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <div className="flex flex-col gap-4">
      {typeof rec.title === "string" && <h4 className="text-lg font-bold">{rec.title}</h4>}
      {sections.map((sec, i) => {
        const edited = (before[i]?.text ?? "") !== (sec.text ?? "");
        const open = editing.has(i);
        return (
          <section key={sec.id ?? i} className="rounded-md border border-border p-3" data-testid={`case-section-${i}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h5 className="font-semibold">{sec.title ?? sec.id}</h5>
              {edited && <span className="badge-info">{s.edited}</span>}
              {!String(sec.text ?? "").trim() && <span className="text-danger-text text-xs">{s.required}</span>}
              <button type="button" className="ml-auto text-xs underline text-brand-strong" onClick={() => toggle(i)}>
                {open ? s.preview : s.edit}
              </button>
            </div>
            {open ? (
              <textarea
                className="input-field font-mono text-xs min-h-40"
                value={sec.text ?? ""}
                onChange={(e) => {
                  const next = sections.map((x, j) => (j === i ? { ...x, text: e.target.value } : x));
                  setRec({ ...rec, sections: next });
                }}
              />
            ) : (
              <MarkdownWithSources text={sec.text ?? ""} inputs={inputs} onCite={onCite} />
            )}
          </section>
        );
      })}
    </div>
  );
}

function RecordForm({ spec, rec, original, setRec, s, onFocusField }: { spec: OutputSpec; rec: CaseRecord; original: CaseRecord; setRec: (r: CaseRecord) => void; s: CaseStrings; onFocusField?: (v: unknown) => void }) {
  const unc = uncertainField(spec);
  const uncertain = new Set(unc ? ((original[unc] as string[]) ?? []) : []);
  return (
    <div className="flex flex-col gap-3">
      {formFields(spec).map((f) => {
        const problem = fieldProblem(spec, rec, f);
        const edited = show(rec[f]) !== show(original[f]);
        const allowed = spec.allowed_values?.[f];
        const long = /description|actions|notes|summary/.test(f) || show(rec[f]).length > 60;
        const common = {
          id: `case-f-${f}`,
          "data-testid": `case-field-${f}`,
          // The AI's value is what was taken from the source, so that is what to find there.
          onFocus: () => onFocusField?.(original[f]),
          className: `input-field ${problem ? "border-danger-text" : edited ? "border-brand" : uncertain.has(f) ? "border-warning-text" : ""}`,
        };
        const change = (raw: string) => setRec({ ...rec, [f]: parseInput(spec, f, raw) });
        return (
          <div key={f}>
            <label htmlFor={common.id} className="field-label flex flex-wrap items-center gap-2">
              {humanize(f)}
              {(spec.required_fields ?? []).includes(f) && <span className="text-danger-text">*</span>}
              {uncertain.has(f) && <span className="badge-warning">{s.uncertain}</span>}
              {edited && <span className="badge-info">{s.edited}</span>}
              {original[f] == null && !edited && <span className="badge">{s.notStated}</span>}
            </label>
            <p className="text-xs text-text-muted mb-1">
              {spec.field_descriptions?.[f]}
              {isList(spec, f) && !isStructured(rec[f]?.[0 as never]) && !/list\[(dict|list)/.test(spec.field_types?.[f] ?? "") ? ` · ${s.listHint}` : ""}
            </p>
            {isTable(rec[f]) || (Array.isArray(rec[f]) && /list\[dict\]/.test(spec.field_types?.[f] ?? "")) ? (
              <TableEditor rows={(rec[f] as CaseRecord[]) ?? []} onChange={(rows) => setRec({ ...rec, [f]: rows })} s={s} testId={common["data-testid"]} />
            ) : isStructured(rec[f]) && !(Array.isArray(rec[f]) && (rec[f] as unknown[]).every((x) => typeof x !== "object")) ? (
              <JsonField value={rec[f]} onChange={(v) => setRec({ ...rec, [f]: v })} className={common.className} testId={common["data-testid"]} />
            ) : allowed ? (
              <select {...common} value={show(rec[f])} onChange={(e) => change(e.target.value)}>
                <option value="" />
                {allowed.map((a) => <option key={a}>{a}</option>)}
              </select>
            ) : long ? (
              <textarea {...common} value={show(rec[f])} onChange={(e) => change(e.target.value)} />
            ) : (
              <input {...common} value={show(rec[f])} placeholder={formatOf(spec, f)} onChange={(e) => change(e.target.value)} />
            )}
            {edited && (
              <p className="text-xs text-text-muted mt-1">
                {s.ai} <em>{isStructured(original[f]) ? "…" : show(original[f]) || "—"}</em> ·{" "}
                <button type="button" className="underline" onClick={() => setRec({ ...rec, [f]: structuredClone(original[f]) })}>{s.restore}</button>
              </p>
            )}
            {rowProblems(spec, rec)
              .filter((rp) => rp.table === f)
              .map((rp) => (
                <p key={`${rp.row}-${rp.column}`} className="text-xs text-danger-text mt-1">
                  {humanize(rp.column)} #{rp.row}:{" "}
                  {rp.problem.kind === "required" ? s.required : rp.problem.kind === "allowed" ? `${s.allowed} ${rp.problem.detail}` : `${s.format} ${rp.problem.detail}`}
                </p>
              ))}
            {problem && (
              <p className="text-xs text-danger-text mt-1">
                {problem.kind === "required" ? s.required : problem.kind === "allowed" ? `${s.allowed} ${problem.detail}` : `${s.format} ${problem.detail}`}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** A list of objects as an editable table: one row per item, a column per key. */
function TableEditor({ rows, onChange, s, testId }: { rows: CaseRecord[]; onChange: (rows: CaseRecord[]) => void; s: CaseStrings; testId?: string }) {
  const cols = tableColumns(rows);
  const set = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="overflow-x-auto rounded-md border border-border-strong" data-testid={testId}>
      <table className="w-full text-xs">
        <thead className="bg-surface-muted">
          <tr>
            {cols.map((k) => <th key={k} className="px-2 py-1 text-left font-semibold">{humanize(k)}</th>)}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {cols.map((k) => (
                <td key={k} className="p-1 min-w-[110px]">
                  {isStructured(r[k]) ? (
                    <JsonField value={r[k]} onChange={(v) => set(i, k, v)} className="input-field text-xs" />
                  ) : (
                    <textarea
                      rows={Math.min(4, Math.max(1, Math.ceil(show(r[k]).length / 40)))}
                      className="input-field text-xs px-2 py-1"
                      value={show(r[k])}
                      onChange={(e) => set(i, k, e.target.value === "" ? null : e.target.value)}
                    />
                  )}
                </td>
              ))}
              <td className="p-1">
                <button type="button" className="text-danger-text text-xs underline" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                  {s.removeRow}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="m-1 text-xs underline text-brand-strong"
        onClick={() => onChange([...rows, Object.fromEntries(cols.map((k) => [k, null]))])}
      >
        + {s.addRow}
      </button>
    </div>
  );
}

/** A structured value edited as JSON; kept as text until it parses again. */
function JsonField({ value, onChange, className, testId }: { value: unknown; onChange: (v: unknown) => void; className?: string; testId?: string }) {
  const [text, setText] = useState(() => JSON.stringify(value));
  const [bad, setBad] = useState(false);
  return (
    <textarea
      data-testid={testId}
      className={`${className ?? ""} font-mono ${bad ? "border-danger-text" : ""}`}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        try {
          onChange(JSON.parse(e.target.value));
          setBad(false);
        } catch {
          setBad(true);
        }
      }}
    />
  );
}

function ValueView({ value }: { value: unknown }) {
  if (isTable(value)) {
    const cols = tableColumns(value);
    return (
      <table className="w-full text-xs border border-border">
        <thead className="bg-surface-muted"><tr>{cols.map((k) => <th key={k} className="px-2 py-1 text-left">{humanize(k)}</th>)}</tr></thead>
        <tbody>
          {value.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              {cols.map((k) => <td key={k} className="px-2 py-1">{isStructured(r[k]) ? JSON.stringify(r[k]) : show(r[k]) || "—"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (isStructured(value) && !(Array.isArray(value) && value.every((x) => typeof x !== "object"))) {
    return <code className="text-xs">{JSON.stringify(value)}</code>;
  }
  return <>{show(value) || "—"}</>;
}

function DoneView(p: ViewProps) {
  const { caseData: c, model, s } = p;
  const raw = c.record ?? {};
  const list = Array.isArray(raw) ? raw : [raw];
  const rec = list[0] ?? {};
  const doc = isDocument(raw);
  const name = (model.spec.schema_name || "result").toLowerCase();
  const stamp = c.events.at(-1)?.at;
  const approved = c.status === "approved";
  const exported: CaseRecord | CaseRecord[] = approved
    ? Array.isArray(raw) ? raw.map((r) => ({ ...r, review_status: r.review_status ?? "approved" })) : { ...raw, review_status: "approved", approved_at: stamp }
    : raw;

  function printPdf() {
    const w = window.open("", "_blank");
    if (!w) return;
    const esc = (t: string) => t.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] as string);
    const body = doc
      ? `<pre style="white-space:pre-wrap;font:11pt/1.45 Helvetica,Arial">${esc(toMarkdown(rec))}</pre>`
      : list
          .map(
            (r) => `<table style="border-collapse:collapse;width:100%;font:11pt Helvetica,Arial;margin-bottom:18px">${formFields(model.spec)
              .map((f) => `<tr><td style="border-bottom:1px solid #bbb;padding:6px;font-weight:bold;width:28%;vertical-align:top">${esc(humanize(f))}</td><td style="border-bottom:1px solid #bbb;padding:6px">${esc(isStructured(r[f]) ? JSON.stringify(r[f], null, 1) : show(r[f]) || "—")}</td></tr>`)
              .join("")}</table>`,
          )
          .join("");
    const when = new Date(String(stamp ?? Date.now())).toLocaleString(p.dateLocale);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(model.title)}</title></head><body style="margin:32px"><h2 style="font-family:Helvetica,Arial">${esc(model.title)}</h2><p style="font-family:Helvetica,Arial">${approved ? s.approvedTitle : s.completedTitle} ${esc(when)}</p>${body}</body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  if (c.status === "rejected") {
    return (
      <div data-testid="case-done">
        <h3 className="font-semibold">{s.rejectedTitle}</h3>
        <p className="text-sm text-text-muted mt-1">{c.comment}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="case-done">
      <h3 className="font-semibold">{approved ? s.approvedTitle : s.completedTitle}</h3>
      {doc ? (
        <div className="max-h-[640px] overflow-auto rounded-md border border-border bg-app p-3">
          <MarkdownWithSources text={toMarkdown(rec)} inputs={c.inputs.map((f) => f.name)} onCite={p.setPreview} />
        </div>
      ) : (
        list.map((r, i) => (
          <dl key={i} className={`grid grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-x-3 gap-y-1.5 text-sm ${list.length > 1 ? "rounded-md border border-border p-3" : ""}`}>
            {formFields(model.spec).map((f) => (
              <div key={f} className="contents">
                <dt className="font-medium text-text-secondary">{humanize(f)}</dt>
                <dd className="min-w-0 overflow-x-auto"><ValueView value={r[f]} /></dd>
              </div>
            ))}
          </dl>
        ))
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => download(`${name}.json`, "application/json", JSON.stringify(exported, null, 2))}>
          {s.export} JSON
        </button>
        {doc ? (
          <button type="button" className="btn-secondary" onClick={() => download(`${name}.md`, "text/markdown;charset=utf-8", toMarkdown(rec))}>
            {s.export} Markdown
          </button>
        ) : (
          <button type="button" className="btn-secondary" onClick={() => download(`${name}.csv`, "text/csv;charset=utf-8", toCsv(exported))}>
            {s.export} CSV
          </button>
        )}
        <button type="button" className="btn-secondary" onClick={printPdf}>{s.export} PDF</button>
      </div>
    </div>
  );
}

function SourceView(p: ViewProps) {
  const { caseData: c, s, base, model } = p;
  const validation = c.result?.validation;
  const rec = c.record;
  const bad = rec ? (isDocument(rec) ? docProblems(rec as CaseRecord) : problemCount(model.spec, rec)) : 0;
  const transcript = c.result?.transcript ?? "";
  const hits = findInText(transcript, p.focus);
  const preview = p.preview && c.inputs.some((f) => f.name === p.preview) ? p.preview : null;
  const previewUrl = preview ? `${base}/inputs/${encodeURIComponent(preview)}` : "";
  return (
    // Stays in view beside a long form, scrolling on its own.
    <aside className="flex flex-col gap-4 min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
      {preview && (
        <div className="rounded-lg border border-border bg-surface p-3" data-testid="case-preview">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="font-semibold text-sm">{s.sourcePreview}: <span className="font-mono text-xs">{preview}</span></h3>
            <button type="button" className="ml-auto text-xs underline" onClick={() => p.setPreview?.(null)}>{s.closePreview}</button>
          </div>
          {/\.pdf$/i.test(preview) ? (
            <iframe title={preview} src={previewUrl} className="h-[420px] w-full rounded border border-border" />
          ) : (
            <a className="underline text-brand-strong text-sm" href={previewUrl} target="_blank" rel="noreferrer">{preview}</a>
          )}
        </div>
      )}
      {c.inputs.length > 0 && c.status !== "draft" && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="font-semibold mb-2">{s.source}</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {c.inputs.map((f) => (
              <li key={f.name}>
                {/\.(wav|mp3|m4a|ogg|webm)$/i.test(f.name) ? (
                  <audio controls src={`${base}/inputs/${encodeURIComponent(f.name)}`} className="w-full" />
                ) : (
                  <a className="underline text-brand-strong font-mono text-xs" href={`${base}/inputs/${encodeURIComponent(f.name)}`} target="_blank" rel="noreferrer">
                    {f.name}
                  </a>
                )}
              </li>
            ))}
          </ul>
          {transcript && (
            <>
              <h4 className="text-sm font-semibold mt-3 mb-1">{s.transcript}</h4>
              <p className="whitespace-pre-wrap rounded-md border border-border bg-app p-2 text-sm" data-testid="case-transcript">
                {hits.length === 0
                  ? transcript
                  : hits.flatMap(([a, b], i) => [
                      transcript.slice(i === 0 ? 0 : hits[i - 1][1], a),
                      <mark key={a} className="rounded bg-warning-bg px-0.5 text-text">{transcript.slice(a, b)}</mark>,
                    ]).concat(transcript.slice(hits[hits.length - 1][1]))}
              </p>
              {c.status === "review" && <p className="mt-1 text-xs text-text-muted">{s.highlightHint}</p>}
            </>
          )}
        </div>
      )}
      {rec && (validation || c.status === "review") && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="font-semibold mb-2">{s.checks}</h3>
          <div className="flex flex-wrap gap-2">
            {validation && (
              <span className={validation.passed ? "badge-success" : "badge-warning"}>{validation.passed ? s.groundingOk : s.groundingBad}</span>
            )}
            {c.status === "review" && (
              <span className={bad ? "badge-warning" : "badge-success"}>{bad ? `${bad} ${s.needFixing}` : s.allValid}</span>
            )}
          </div>
        </div>
      )}
      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-semibold mb-2">{s.events}</h3>
        <ul className="flex flex-col-reverse gap-1 text-xs text-text-muted" data-testid="case-events">
          {c.events.map((e, i) => (
            <li key={i}>
              {new Date(e.at).toLocaleTimeString(p.dateLocale, { hour: "2-digit", minute: "2-digit" })} ·{" "}
              <b className="text-text">{e.role === "ai" ? s.aiRole : e.role}</b> {s.actions[e.action] ?? e.action}
              {e.detail ? ` “${e.detail}”` : ""}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
