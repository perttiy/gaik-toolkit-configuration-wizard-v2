/** Sprint 1 #40 spike — which mock sessions serve a pre-generated BPMN diagram. */

/** Matches mock-sessions BPMN_VISUAL_STEP (onboarding phase 8). */
export const BPMN_VISUAL_STEP = 8;

export const BPMN_SPIKE_ASSET = "incident-reporting.bpmn";

/** Seed sessions that show the spike BPMN (from V1 incident_reporting_blueprint.json). */
export const BPMN_SPIKE_SESSION_IDS = new Set(["ses_chatbot", "ses_laskut"]);

/** Sprint 1 spike — sessions that serve pre-generated BPMN (mock IDs) or any API session at phase 8+. */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Seed mock sessions + persisted API sessions (UUID). */
export function hasBpmnSpike(sessionId: string): boolean {
  return BPMN_SPIKE_SESSION_IDS.has(sessionId) || UUID_RE.test(sessionId);
}

/** Spike BPMN only from onboarding phase 8 (visual workflow) onward. */
export function shouldShowBpmnSpike(sessionId: string, wizardStep: number): boolean {
  return hasBpmnSpike(sessionId) && wizardStep >= BPMN_VISUAL_STEP;
}
