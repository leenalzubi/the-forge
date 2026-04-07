/**
 * @typedef {{
 *   score: number,
 *   fair_to_me: boolean,
 *   fair_to_others: boolean,
 *   bias_detected: boolean,
 *   bias_note: string | null,
 *   missing: string | null,
 *   verdict: 'approve' | 'flag',
 * }} ValidationRecord
 */

/**
 * Parse validator JSON from model output (may include markdown fences).
 * @param {string} raw
 * @returns {Record<string, unknown> | null}
 */
export function parseValidationJson(raw) {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return null
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  const tryParse = fence ? fence[1].trim() : s
  const objMatch = tryParse.match(/\{[\s\S]*\}/)
  if (!objMatch) return null
  try {
    return JSON.parse(objMatch[0])
  } catch {
    return null
  }
}

/**
 * @param {Record<string, unknown> | null} raw
 * @returns {ValidationRecord | null}
 */
export function normalizeValidationRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const score = Number(raw.score)
  const v = String(raw.verdict ?? '').toLowerCase()
  const verdict = v === 'approve' ? 'approve' : 'flag'
  return {
    score: Number.isFinite(score) ? Math.min(10, Math.max(0, Math.round(score))) : 0,
    fair_to_me: Boolean(raw.fair_to_me),
    fair_to_others: Boolean(raw.fair_to_others),
    bias_detected: Boolean(raw.bias_detected),
    bias_note:
      raw.bias_note == null || raw.bias_note === 'null'
        ? null
        : String(raw.bias_note),
    missing:
      raw.missing == null || raw.missing === 'null'
        ? null
        : String(raw.missing),
    verdict,
  }
}

/**
 * @param {ValidationRecord | null} b
 * @param {ValidationRecord | null} c
 * @returns {'pending' | 'approved' | 'flagged'}
 */
export function computeValidationStatus(b, c) {
  if (!b || !c) return 'pending'
  const avg = (b.score + c.score) / 2
  if (avg < 6) return 'flagged'
  if (b.verdict === 'flag' || c.verdict === 'flag') return 'flagged'
  if (b.verdict === 'approve' && c.verdict === 'approve') return 'approved'
  return 'flagged'
}

/**
 * @param {string} prompt
 * @param {string} ownRound1
 * @param {string} synthesisOutput
 */
export function buildSynthesisValidationUserMessage(
  prompt,
  ownRound1,
  synthesisOutput
) {
  return `Here was the original question: ${prompt}

Here was your position (Round 1): ${ownRound1}

Here is the synthesis produced by GPT-4o mini: ${synthesisOutput}

Score the synthesis for fairness. Did it fairly represent your position and the other positions in the debate?`
}

/** When the model returns non-JSON, treat as flagged so the run still completes. */
export function fallbackFlaggedValidation() {
  return /** @type {ValidationRecord} */ ({
    score: 0,
    fair_to_me: false,
    fair_to_others: false,
    bias_detected: true,
    bias_note: 'Validator response could not be parsed.',
    missing: null,
    verdict: 'flag',
  })
}
