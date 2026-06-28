/** Sprint 1 #40 spike — which mock sessions serve a pre-generated BPMN diagram. */

export const BPMN_SPIKE_ASSET = "incident-reporting.bpmn";

/** Seed sessions that show the spike BPMN (from V1 incident_reporting_blueprint.json). */
export const BPMN_SPIKE_SESSION_IDS = new Set(["ses_chatbot", "ses_laskut"]);

export function hasBpmnSpike(sessionId: string): boolean {
  return BPMN_SPIKE_SESSION_IDS.has(sessionId);
}
