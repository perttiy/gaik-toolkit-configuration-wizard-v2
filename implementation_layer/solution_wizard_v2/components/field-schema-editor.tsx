"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Blueprint, FieldSpec } from "@/lib/mock-sessions";

// Structured output field schema — the core of Umair's example use cases
// (a list of fields with type, allowed values, missing-behaviour, order and
// extraction rule). Maps to the V1 blueprint `target_output_spec.fields`.
// Editable: the SME manager defines/adjusts the schema here (SME-7 / #25),
// saved onto `blueprint.output_fields` the same way the Blueprint tab saves
// (PATCH /sessions/:id/blueprint). Falls back to an example schema (Umair's
// factory safety-observation case) when nothing has been defined yet, so the
// manager always has a concrete starting point to edit or approve as-is.

const EXAMPLE_FIELDS: FieldSpec[] = [
  {
    name: "Havaintotyyppi",
    type: "enum",
    allowedValues: ["Near miss", "safety observation", "deviation"],
    required: true,
    missingBehavior: "default",
    defaultValue: "safety observation",
    rule: "Valitse vain yksi arvoista. Jos ei pääteltävissä → oletus.",
  },
  {
    name: "Havainto- ja poikkeamatyyppi",
    type: "enum",
    allowedValues: ["Kalusto", "Laatu", "Alihankinta", "Ympäristö", "Asiakas", "Turvallisuus"],
    required: true,
    missingBehavior: "default",
    defaultValue: "Turvallisuus",
    rule: "Valitse vain yksi. Jos ei pääteltävissä → 'Turvallisuus'.",
  },
  {
    name: "Päivämäärä",
    type: "date",
    required: false,
    missingBehavior: "empty",
    rule: "Tapahtuman päivämäärä. Palauta \"\" jos ei saatavilla.",
  },
  {
    name: "Työnantaja",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Litteraatiossa mainittu alihankkijan/työnantajan/yrityksen nimi.",
  },
  {
    name: "Kirjaaja",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Havainnon kirjaavan henkilön nimi.",
  },
  {
    name: "Tapahtumaselostus",
    type: "text",
    required: true,
    missingBehavior: "empty",
    rule: "Tarkka kuvaus havainnosta tai poikkeamasta.",
  },
  {
    name: "Tapahtumaan johtaneet tekijät",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Kuvaus tapahtumaan johtaneista tekijöistä.",
  },
  {
    name: "Tehdyt välittömät toimenpiteet",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Kuvaus välittömistä tehdyistä toimenpiteistä.",
  },
  {
    name: "Ehdotukset vastaavien tilanteiden välttämiseksi",
    type: "text",
    required: false,
    missingBehavior: "empty",
    rule: "Ehdotukset vastaavien tilanteiden välttämiseksi.",
  },
];

const FIELD_TYPES: FieldSpec["type"][] = ["text", "enum", "date", "number", "boolean"];

const TYPE_STYLE: Record<FieldSpec["type"], string> = {
  text: "bg-neutral-bg text-neutral-text border-neutral-border",
  enum: "bg-brand-soft text-brand-text border-brand-soft-border",
  date: "bg-info-bg text-info-text border-info-border",
  number: "bg-info-bg text-info-text border-info-border",
  boolean: "bg-neutral-bg text-neutral-text border-neutral-border",
};

function newField(): FieldSpec {
  return { name: "", type: "text", required: false, missingBehavior: "empty" };
}

export function FieldSchemaEditor({
  sessionId,
  blueprint,
}: {
  sessionId: string;
  blueprint: Blueprint;
}) {
  const router = useRouter();
  const initial = blueprint.output_fields?.length ? blueprint.output_fields : EXAMPLE_FIELDS;
  const [fields, setFields] = useState<FieldSpec[]>(initial);
  const [saved, setSaved] = useState<FieldSpec[]>(initial);
  const [sel, setSel] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const f = fields[sel];
  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);
  const canSave = dirty && fields.every((row) => row.name.trim().length > 0) && !saving;

  function update(patch: Partial<FieldSpec>) {
    setFields((rows) => rows.map((row, i) => (i === sel ? { ...row, ...patch } : row)));
  }

  function addField() {
    setFields((rows) => [...rows, newField()]);
    setSel(fields.length);
  }

  function removeField(i: number) {
    if (fields.length <= 1) return;
    setFields((rows) => rows.filter((_, idx) => idx !== i));
    setSel((s) => (s >= i ? Math.max(0, s - 1) : s));
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(false);
    setSavedFlash(false);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/blueprint`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: { ...blueprint, output_fields: fields },
          note: "Output-kentät päivitetty (SME-7)",
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const data = (await res.json()) as { blueprint: Blueprint };
      const savedFields = data.blueprint.output_fields?.length
        ? data.blueprint.output_fields
        : fields;
      setFields(savedFields);
      setSaved(savedFields);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
      router.refresh();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl py-1">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <span className="section-kicker text-gold">Kenttäskeema</span>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-text">
            Poimittavat kentät
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            {fields.length} kenttää · tarkka järjestys · ei arvauksia. Tämä on
            tuotoksen rakenteinen määrittely — muokkaa tai hyväksy sellaisenaan.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="btn-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Tallennetaan…" : "Tallenna"}
          </button>
          {savedFlash && <span className="badge-success text-xs">Tallennettu</span>}
          {saveError && (
            <span className="text-xs font-medium text-danger-text">
              Tallennus epäonnistui — yritä uudelleen.
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_20rem]">
        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="grid grid-cols-[1.6rem_1fr_auto_auto] gap-2 border-b border-border bg-surface-muted px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
            <span>#</span>
            <span>Kenttä</span>
            <span>Tyyppi</span>
            <span />
          </div>
          <ul>
            {fields.map((row, i) => (
              <li key={i}>
                <div
                  className={`grid grid-cols-[1.6rem_1fr_auto_auto] items-center gap-2 border-b border-border px-3 py-2.5 transition-colors ${
                    i === sel ? "bg-brand-soft/60" : "hover:bg-surface-muted"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSel(i)}
                    className="text-left text-xs font-semibold text-text-muted"
                  >
                    {i + 1}
                  </button>
                  <button type="button" onClick={() => setSel(i)} className="min-w-0 text-left">
                    <span className="block truncate text-sm font-medium text-text">
                      {row.name || "(nimetön kenttä)"}
                    </span>
                    {row.required && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-danger-text">
                        pakollinen
                      </span>
                    )}
                  </button>
                  <button type="button" onClick={() => setSel(i)}>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${TYPE_STYLE[row.type]}`}
                    >
                      {row.type}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeField(i)}
                    disabled={fields.length <= 1}
                    aria-label="Poista kenttä"
                    className="text-text-muted hover:text-danger-text disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="px-3 py-2.5">
            <button
              type="button"
              onClick={addField}
              className="text-sm font-medium text-brand-text hover:underline"
            >
              + Lisää kenttä
            </button>
          </div>
        </div>

        {/* Detail / edit form */}
        <div className="h-fit rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gold">
            Kenttä #{sel + 1}
          </div>

          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Nimi
            </span>
            <input
              type="text"
              value={f.name}
              onChange={(e) => update({ name: e.target.value })}
              className="mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Tyyppi
            </span>
            <select
              value={f.type}
              onChange={(e) => update({ type: e.target.value as FieldSpec["type"] })}
              className="mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          {f.type === "enum" && (
            <label className="mt-3 block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                Sallitut arvot (pilkulla eroteltuna)
              </span>
              <input
                type="text"
                value={(f.allowedValues ?? []).join(", ")}
                onChange={(e) =>
                  update({
                    allowedValues: e.target.value
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean),
                  })
                }
                className="mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </label>
          )}

          <label className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={f.required}
              onChange={(e) => update({ required: e.target.checked })}
              className="h-4 w-4 rounded border-border-strong"
            />
            <span className="text-sm text-text">Pakollinen</span>
          </label>

          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Jos arvo puuttuu
            </span>
            <select
              value={f.missingBehavior}
              onChange={(e) =>
                update({ missingBehavior: e.target.value as FieldSpec["missingBehavior"] })
              }
              className="mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              <option value="empty">jätä tyhjäksi</option>
              <option value="default">käytä oletusta</option>
            </select>
          </label>

          {f.missingBehavior === "default" && (
            <label className="mt-3 block">
              <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
                Oletusarvo
              </span>
              <input
                type="text"
                value={f.defaultValue ?? ""}
                onChange={(e) => update({ defaultValue: e.target.value })}
                className="mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
            </label>
          )}

          <label className="mt-3 block">
            <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">
              Poimintasääntö
            </span>
            <textarea
              value={f.rule ?? ""}
              onChange={(e) => update({ rule: e.target.value })}
              rows={2}
              className="mt-1 w-full rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
