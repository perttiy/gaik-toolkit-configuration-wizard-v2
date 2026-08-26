import type { Blueprint } from "@/lib/mock-sessions";
import type { Dict } from "@/lib/i18n";
import { buildDeploymentChecklist, type ChecklistItem } from "@/lib/deployment-checklist";

// SME-LC-1 (#52): deployment guidance in business language, a checklist
// generated from the actual blueprint, and a pointer to the Rahti deploy
// path — not a real deploy trigger (package generation itself is later
// sprint scope), so this is guidance, not automation.

function checklistLabel(item: ChecklistItem, t: Dict): string {
  switch (item.kind) {
    case "component":
      return `${t.deployChecklistComponent}: ${item.detail}`;
    case "integration":
      return `${t.deployChecklistIntegration}: ${item.detail}`;
    case "reviewer":
      return `${t.deployChecklistReviewer}: ${item.detail}`;
    case "fixed":
      return item.id === "secrets" ? t.deployChecklistSecrets : t.deployChecklistDryRun;
  }
}

export function DeploymentGuide({ blueprint, t }: { blueprint: Blueprint; t: Dict }) {
  const checklist = buildDeploymentChecklist(blueprint);
  const hasSolutionSpecificItems = checklist.some((i) => i.kind !== "fixed");

  return (
    <div className="mx-auto w-full max-w-2xl py-1">
      <p className="text-sm leading-relaxed text-text-secondary">{t.deployIntro}</p>

      <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-text-muted">
        {t.deployStepsTitle}
      </h3>
      <ol className="mt-2 space-y-2">
        {t.deploySteps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-text">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-text">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <h3 className="mt-6 text-sm font-bold uppercase tracking-wide text-text-muted">
        {t.deployChecklistTitle}
      </h3>
      {!hasSolutionSpecificItems && (
        <p className="mt-1 text-xs text-text-muted">{t.deployChecklistEmpty}</p>
      )}
      <ul className="mt-2 space-y-1.5 rounded-xl border border-border bg-surface p-3.5">
        {checklist.map((item) => (
          <li key={item.id} className="flex items-start gap-2 text-sm text-text">
            <span
              className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full border border-border-strong"
              aria-hidden
            />
            <span>{checklistLabel(item, t)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-4 rounded-md border border-border bg-surface-muted/40 px-3 py-2.5 text-xs text-text-muted">
        {t.deployRahtiNote}
      </p>
    </div>
  );
}
