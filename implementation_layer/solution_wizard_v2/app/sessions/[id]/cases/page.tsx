import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getI18n } from "@/lib/i18n";
import { getSessionForUser } from "@/lib/session-access";
import { CASE_STRINGS } from "@/lib/case-strings";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { CaseWorkflow } from "@/components/case-workflow";

/** The generated solution in use: cases run through the solution's own process. */
export default async function CasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const { locale, t } = await getI18n();
  const session = user ? await getSessionForUser(id, user.email) : undefined;
  if (!session) notFound();
  const s = CASE_STRINGS[locale];

  return (
    <div className="min-h-screen flex flex-col">
      {/* The solution's own bar: no wizard structure, only a quiet way back
          to the designer's view. The use case's name heads the page below. */}
      <header className="h-12 shrink-0 px-4 sm:px-5 flex items-center justify-between border-b border-border bg-surface/80">
        <Link
          href={`/sessions/${id}`}
          className="text-xs text-text-muted hover:text-brand-strong transition-colors"
        >
          ← {s.designer}
        </Link>
        <div className="flex items-center gap-4 text-sm text-text-secondary">
          <LocaleSwitcher locale={locale} />
          <span className="text-text-muted hidden sm:inline">{user?.email}</span>
        </div>
      </header>
      <main id="main-content" className="flex-1 w-full max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-5">
        <CaseWorkflow sessionId={id} strings={s} dateLocale={locale === "fi" ? "fi-FI" : "en-GB"} />
      </main>
      <span className="sr-only">{t.appName}</span>
    </div>
  );
}
