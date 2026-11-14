import {
  adviceText,
  adviceWords,
  careWords,
  clockTime,
  doseAmount,
  emergencyPattern,
  emergencyText,
} from '../chat/chat.policy';
import { canonical, hash } from './near-protocol';

// Tomo gate rules, version 1. The gate below runs from this object, and its SHA-256 is
// published on NEAR with `publish_policy`, so the on-chain hash pins the exact patterns and
// replies that decided every turn. Changing any rule requires a new version.
//
// Routes are checked in order. Only ALLOW reaches a model, and only a NEAR AI Cloud
// Confidential TEE model whose reply carries a verified provider_tee signature.
export const escalateText =
  'That needs your care team, so I won’t answer it here. To keep the question for your next appointment, say “Remember that” followed by your question. If it feels urgent, contact your care team now.';

export const GATE_RULES = {
  name: 'kuvos-tomo-gate',
  version: 1,
  scope:
    'Explain or organise only the patient’s confirmed ACTIVE plan versions and recorded activity. Never advise, diagnose, triage or change care.',
  order: ['emergency', 'note', 'escalate', 'block', 'allow'],
  routes: {
    emergency: {
      decision: 'BLOCK',
      pattern: emergencyPattern.source,
      flags: 'i',
      reply: emergencyText,
      model: false,
    },
    // Requests to change treatment or describing how the person feels need a human, never a model.
    escalate: {
      decision: 'ESCALATE',
      pattern:
        "\\b(can i (take|stop|skip|mix|double)|change.{0,20}(dose|medicine|medication)|increase.{0,20}dose|decrease.{0,20}dose|more (tablets?|pills?)|extra (dose|tablets?|pills?)|side.effects?|symptoms?|feel (unwell|sick|ill|worse)|i('m| am) (unwell|sick|ill)|pain|swelling|fever|dizz\\w*|rash|nausea|vomit\\w*|infection|bleeding)\\b",
      flags: 'i',
      reply: escalateText,
      model: false,
    },
    block: {
      decision: 'BLOCK',
      pattern:
        '\\b(should i|safe to|is it safe|recommend\\w*|diagnos\\w*|treat\\w*|cure|normal|what does .{0,40} mean for my (health|plan|condition)|is .{0,30} (good|bad) for me)\\b',
      flags: 'i',
      reply: adviceText,
      model: false,
    },
    note: {
      decision: 'ALLOW',
      pattern: '^remember\\s+(?:that\\s+|this:\\s*)?(.+)',
      flags: 'i',
      model: false,
    },
    allow: {
      decision: 'ALLOW',
      model: 'NEAR AI Cloud Confidential TEE (provider_tee signature required)',
      // Model wording that matches these falls back to verbatim records or the fixed reply.
      outputFilter: [
        doseAmount.source,
        adviceWords.source,
        clockTime.source,
        careWords.source,
      ],
    },
  },
} as const;

export const GATE_HASH = hash(
  canonical(JSON.parse(JSON.stringify(GATE_RULES))),
);

export type GateDecision = 'ALLOW' | 'BLOCK' | 'ESCALATE';
export type GateResult = {
  decision: GateDecision;
  rule: 'emergency' | 'escalate' | 'block' | 'note' | 'allow';
  reply?: string;
};

const compiled = (route: { pattern: string; flags: string }) =>
  new RegExp(route.pattern, route.flags);
const emergency = compiled(GATE_RULES.routes.emergency);
const escalate = compiled(GATE_RULES.routes.escalate);
const block = compiled(GATE_RULES.routes.block);
const note = compiled(GATE_RULES.routes.note);

export function gate(text: string): GateResult {
  const value = text.replace(/[’‘]/g, "'");
  if (emergency.test(value))
    return { decision: 'BLOCK', rule: 'emergency', reply: emergencyText };
  // A saved note is the person's own words for a visit, so it is checked before advice routes.
  if (note.test(value)) return { decision: 'ALLOW', rule: 'note' };
  if (escalate.test(value))
    return { decision: 'ESCALATE', rule: 'escalate', reply: escalateText };
  if (block.test(value))
    return { decision: 'BLOCK', rule: 'block', reply: adviceText };
  return { decision: 'ALLOW', rule: 'allow' };
}
