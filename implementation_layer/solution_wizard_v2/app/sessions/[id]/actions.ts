"use server";

import { revalidatePath } from "next/cache";
import { requireOwnedSession } from "@/lib/session-access";
import { getI18n } from "@/lib/i18n";
import {
  advanceSession,
  regressSession,
  approveGate,
  rejectGate,
  requestGateChanges,
} from "@/lib/sessions";

function refresh(id: string) {
  revalidatePath(`/sessions/${id}`);
  revalidatePath("/");
}

export async function advance(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  await advanceSession(id);
  refresh(id);
}

export async function regress(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  await regressSession(id);
  refresh(id);
}

export async function approve(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  await approveGate(id);
  refresh(id);
}

export async function reject(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  await rejectGate(id);
  refresh(id);
}

export async function requestChanges(formData: FormData) {
  const id = formData.get("id") as string;
  if (!(await requireOwnedSession(id))) return;
  const feedback = ((formData.get("feedback") as string) ?? "").trim();
  const { t } = await getI18n();
  // The backend rejects an empty user_content (min_length 1) and postMessage
  // swallows that failure, so an empty feedback here would silently drop both
  // the request and its acknowledgement (#126 / S3-13). Falling back to a
  // placeholder message keeps the acknowledgement recorded either way.
  await requestGateChanges(id, feedback || t.changesRequestedFallback, t.changesRequested);
  refresh(id);
}
