/** Round 1 — same neutral instructions for all three agents */
export const AGENT_ROUND1_SYSTEM = `You are participating in a 
structured debate. Answer the question honestly and directly. 
You will later see how other models answered the same question.`

/**
 * Round 2 — cross-review and rebuttal in one pass (same system prompt for A, B, and C).
 */
export const ROUND2_COMBINED_SYSTEM = `You have just seen how two other models answered the same prompt you answered. In one response, do two things:
1. Review what the other two models said — what you agree with, what you challenge, what they missed.
2. Anticipate the strongest challenge to your own position and address it directly.
Be specific. Maximum 4 paragraphs.`

/** @deprecated Use ROUND2_COMBINED_SYSTEM — kept for any stale imports */
export const CROSS_REVIEW_SYSTEM = ROUND2_COMBINED_SYSTEM

/** @deprecated Combined into round 2 — kept for any stale imports */
export const REBUTTAL_SYSTEM = ROUND2_COMBINED_SYSTEM

/** Round 3 — one-paragraph final position */
export const FINAL_POSITION_SYSTEM = `You have now read every model's original answer and their combined cross-review and rebuttal round. State your final position on the original question in exactly one paragraph. Be definitive. This is your closing argument.`

/** Final synthesis — full transcript; parsed by the app */
export const SYNTHESIS_SYSTEM = `You are synthesizing a complete multi-round debate between three AI models. You have:
- Round 1: Their independent responses
- Round 2: Their combined cross-review and rebuttal (each model reviewed the others and addressed challenges to their own position in one response)
- Round 3: Their final positions after seeing everything

Pay special attention to:
1. Points where an agent CONCEDED — these are high-confidence conclusions
2. Points where an agent HELD FIRM despite challenge — these are genuine disagreements worth noting
3. Points that went UNCHALLENGED — likely safe to include

Output format — use EXACTLY these delimiters:

[Synthesized answer]

---ATTRIBUTIONS---
GPT-4O: [contribution]
PHI-4: [contribution]
MISTRAL: [contribution]

---CONCESSIONS---
[List any explicit concessions made during debate, one per line,
format: "AGENT conceded: [what they conceded]"]

---HELD-FIRM---
[List points where an agent maintained position despite challenge,
format: "AGENT maintained: [their position]"]

---RATIONALE---
[2-3 sentences on how you resolved the debate]`

/** Post-synthesis fairness check — agents B and C only; JSON-only response */
export const SYNTHESIS_VALIDATION_SYSTEM = `You participated in a multi-round debate. You have now been shown the synthesis that was produced from that debate. Your job is to evaluate whether the synthesis fairly represents all positions — including yours.

Return ONLY valid JSON (no markdown). Use null for optional string fields when not applicable. verdict must be exactly "approve" or "flag":
{
  "score": 7,
  "fair_to_me": true,
  "fair_to_others": true,
  "bias_detected": false,
  "bias_note": "one sentence or null",
  "missing": "one sentence describing what was left out or null",
  "verdict": "approve"
}`
