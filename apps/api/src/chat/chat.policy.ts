import { BadRequestException } from '@nestjs/common';
import type { AiAttestation } from '../near/near-ai';

export const emergencyText =
  "I can't assess emergencies or give medical advice. Contact your healthcare provider now. If this may be an emergency, call your local emergency services. You can also call your caregiver.";
export const adviceText =
  "I can't weigh in on health questions, so that one is best for your doctor or care team. I'm still here for your plan and your day.";
export const chatConsentVersion = '2026-10-29-record-context-v1';

export type ChatLink = {
  label: string;
  kind: 'task' | 'plan' | 'source' | 'today' | 'rhythm' | 'exercise';
  id?: string;
  planId?: string;
  candidateId?: string;
  date?: string;
};
export type ChatReply = {
  text: string;
  kind: 'answer' | 'emergency' | 'boundary';
  links: ChatLink[];
  tool?: string;
  message?: string;
  evidenceIds?: string[];
  model?: string;
  contextResetId?: string | null;
  chart?: ChatChart;
  /** NEAR AI Cloud TEE proofs for every model call behind this reply. */
  attestations?: AiAttestation[];
  /** Tomo gate route and the NEAR commitment for this turn. */
  gate?: {
    decision: string;
    rule: string;
    policyVersion: number;
    policyHash: string;
  };
};
// Recorded check-ins per day, drawn by the app beside the verbatim summary.
export type ChatChart = {
  kind: 'rhythm';
  days: {
    day: string;
    total: number;
    done: number;
    skipped: number;
    missed: number;
  }[];
};
export type ChatEvidence = {
  id: string;
  text: string;
  links: ChatLink[];
  chart?: ChatChart;
};
export type ChatToolResult = { facts: ChatEvidence[]; note?: string };
export type ReadTool =
  | 'get_profile'
  | 'get_today'
  | 'get_next_task'
  | 'get_completed_tasks'
  | 'get_plans'
  | 'find_task'
  | 'get_memory'
  | 'get_adherence'
  | 'get_exercise'
  | 'get_day'
  | 'get_task_history'
  | 'get_help';
export type ToolCall = { name: ReadTool; query: string };
export const readTools: ReadTool[] = [
  'get_profile',
  'get_today',
  'get_next_task',
  'get_completed_tasks',
  'get_plans',
  'find_task',
  'get_memory',
  'get_adherence',
  'get_exercise',
  'get_day',
  'get_task_history',
  'get_help',
];

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function messageBody(value: unknown) {
  const body = object(value);
  if (
    typeof body.text !== 'string' ||
    !body.text.trim() ||
    body.text.length > 2000 ||
    typeof body.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.requestId,
    )
  ) {
    throw new BadRequestException(
      'Send a message of 1–2000 characters and a valid request ID.',
    );
  }
  return { text: body.text.trim(), requestId: body.requestId };
}

// shortcut: conservative English contact rules, expand with reviewed multilingual phrases before a multilingual release.
export const emergencyPattern =
  /\b(emergency|chest\s+(pain|tightness)|heart attack|stroke|overdose|suicid\w*|kill myself|end my life|self.harm|hurt myself|unconscious|faint(ed|ing)?|heavy bleeding|bleeding heavily|severe bleeding|can't breathe|cannot breathe|can not breathe|hard to breathe|trouble breathing|difficulty breathing|shortness of breath|choking|seizure|face droop\w*|slurred speech)\b/i;

export function emergencyMessage(text: string) {
  return emergencyPattern.test(text.replace(/[’‘]/g, "'"));
}

export function adviceMessage(text: string) {
  return /\b(should i|can i (take|stop|skip|mix|double)|safe to|is it safe|recommend|diagnos\w*|treat\w*|cure|side.effect|symptom\w*|feel (unwell|sick|ill)|i('m| am) (unwell|sick|ill)|pain|swelling|fever|dizz\w*|rash|nausea|vomit\w*|infection|worse|better|normal|change.{0,20}(dose|medicine)|increase.{0,20}dose|decrease.{0,20}dose)\b/i.test(
    text.replace(/[’‘]/g, "'"),
  );
}

export function parseTool(value: unknown): ToolCall | undefined {
  const call = object(value);
  const fn = object(call.function);
  if (
    !readTools.includes(fn.name as ReadTool) ||
    typeof fn.arguments !== 'string'
  )
    return;
  try {
    const args = object(JSON.parse(fn.arguments));
    if (
      args.query !== undefined &&
      (typeof args.query !== 'string' || args.query.length > 200)
    )
      return;
    return {
      name: fn.name as ReadTool,
      query: typeof args.query === 'string' ? args.query.trim() : '',
    };
  } catch {
    return;
  }
}

// Everyday companion phrases that only look like instructions to the word list below.
const companionPhrases =
  /\b(take care|take your time|the rest of|rest of (your|the) day|try again|try asking|sleep well|stay safe|safe travels|walk you through|start (your|the) day|hold on|good start|fresh start)\b/gi;

export const doseAmount =
  /\d\s*(mg|mcg|µg|ml|iu|units?|tablets?|pills?|capsules?|drops?|puffs?)\b/i;
export const adviceWords =
  /\b(diagnos\w*|prescri\w*|treat\w*|symptoms?|safe|harmless|normal|improv\w*|worsen\w*|should|must|take|stop|double|increase|decrease|reduce|avoid)\b/i;
export const clockTime =
  /\b\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.|o'clock)|\b\d{1,2}:\d{2}\b|\b(at|by|before|until)\s+\d{1,2}(?!\s*(g|grams?|kcal|cal|%))\b/i;
export const careWords =
  /\b(mg|mcg|ml|tablets?|pills?|capsules?|medicines?|medications?|doses?|dosage|skip|apply|rest|stretch|exercise|hold|breathe|walk|blood|pressure|insulin|hypertension|diabetes|arthritis|cancer|infection|pain|fever)\b/i;

// Model prose is conversation, rough food estimates and, when grounded in selected records, a natural
// retelling of them: task names, times and statuses may appear, dose amounts and advice never do.
export function unsafeModelMessage(value: string, grounded = false) {
  const text = value.replace(/[’‘]/g, "'").replace(companionPhrases, ' ');
  return (
    doseAmount.test(text) ||
    adviceWords.test(text) ||
    /\byou (?:may|might|probably) (?:have|be)\b/i.test(text) ||
    /https?:\/\/|www\./i.test(text) ||
    (!grounded && (clockTime.test(text) || careWords.test(text)))
  );
}
