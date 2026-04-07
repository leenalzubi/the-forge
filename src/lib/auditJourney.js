import { normStance, verdictFromThreeStances } from './claimDivergence.js'

/** @typedef {{ claimId: string, gpt?: unknown, phi?: unknown, mistral?: unknown }} R1Row */

/**
 * @param {unknown} row
 * @param {string} key
 */
function rowPosition(row, key) {
  if (!row || typeof row !== 'object') return 'silent'
  const o = /** @type {Record<string, unknown>} */ (row)
  if ('position' in o) return o.position
  return o[key] ?? 'silent'
}

/**
 * @param {Record<string, unknown> | null | undefined} audit
 */
export function computeJourneySummary(audit) {
  const claims =
    audit && Array.isArray(audit.claims) ? audit.claims : []
  const r1p = audit?.positionsRound1
  const p1 = r1p && typeof r1p === 'object' && Array.isArray(r1p.positions)
    ? r1p.positions
    : []
  const nClaims = claims.length > 0 ? claims.length : p1.length
  const r3 = audit?.positionsRound3
  const keys = /** @type {const} */ (['gpt', 'phi', 'mistral'])

  let unchanged = 0
  let shifted = 0
  let flipped = 0

  for (const row of p1) {
    const po = /** @type {Record<string, unknown>} */ (row)
    const id = String(po.claimId ?? '')
    for (const k of keys) {
      const a = normStance(po[k])
      const r3arr = r3 && typeof r3 === 'object' ? r3[k] : null
      let r3row = null
      if (Array.isArray(r3arr)) {
        r3row = r3arr.find(
          (x) => x && typeof x === 'object' && String(x.claimId) === id
        )
      }
      const c = normStance(rowPosition(r3row, k))
      if (a === c) {
        unchanged += 1
        continue
      }
      if (
        (a === 'agree' && c === 'disagree') ||
        (a === 'disagree' && c === 'agree')
      ) {
        flipped += 1
        continue
      }
      shifted += 1
    }
  }

  return { nClaims, unchanged, shifted, flipped }
}

/**
 * @param {Record<string, unknown> | null | undefined} audit
 */
export function computeAuditPositionMetrics(audit) {
  const r1p = audit?.positionsRound1
  const p1 = r1p && typeof r1p === 'object' && Array.isArray(r1p.positions)
    ? r1p.positions
    : []
  const r3 = audit?.positionsRound3
  const keys = /** @type {const} */ (['gpt', 'phi', 'mistral'])
  let shifted = 0
  let flipped = 0
  const perModel = { gpt: 0, phi: 0, mistral: 0 }

  for (const row of p1) {
    const po = /** @type {Record<string, unknown>} */ (row)
    const id = String(po.claimId ?? '')
    for (const k of keys) {
      const a = normStance(po[k])
      const r3arr = r3 && typeof r3 === 'object' ? r3[k] : null
      let r3row = null
      if (Array.isArray(r3arr)) {
        r3row = r3arr.find(
          (x) => x && typeof x === 'object' && String(x.claimId) === id
        )
      }
      const c = normStance(rowPosition(r3row, k))
      if (a === c) continue
      shifted += 1
      perModel[k] += 1
      if (
        (a === 'agree' && c === 'disagree') ||
        (a === 'disagree' && c === 'agree')
      ) {
        flipped += 1
      }
    }
  }

  let most_changed_model = null
  let max = 0
  for (const k of keys) {
    const n = perModel[k]
    if (n > max) {
      max = n
      most_changed_model = k
    }
  }
  if (max === 0) most_changed_model = null

  return {
    positions_shifted: shifted,
    positions_flipped: flipped,
    most_changed_model,
  }
}

/**
 * Stance leaning score: higher = more agree-leaning.
 * @param {unknown} v
 */
export function stanceLeanScore(v) {
  const s = normStance(v)
  if (s === 'agree') return 2
  if (s === 'partial') return 1
  if (s === 'disagree') return 0
  return 1
}

/**
 * @param {unknown} from
 * @param {unknown} to
 * @returns {'green' | 'red' | 'muted'}
 */
export function changeArrowTone(from, to) {
  const a = normStance(from)
  const b = normStance(to)
  if (a === b) return 'muted'
  const da = stanceLeanScore(from)
  const db = stanceLeanScore(to)
  if (db > da) return 'green'
  if (db < da) return 'red'
  return 'muted'
}

/**
 * @param {Record<string, unknown> | null | undefined} audit
 * @param {string} claimId
 */
export function buildMergedR3RowForTrace(audit, claimId) {
  const rows = buildRowsForClaim(audit, claimId)
  const g = rows.r3gpt?.position
  const p = rows.r3phi?.position
  const m = rows.r3mistral?.position
  const { verdict, minorityIncluded } = verdictFromThreeStances(g, p, m)
  return {
    claimId,
    gpt: g ?? rows.r1?.gpt,
    phi: p ?? rows.r1?.phi,
    mistral: m ?? rows.r1?.mistral,
    verdict,
    minorityIncluded,
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} audit
 * @param {string} claimId
 */
export function buildRowsForClaim(audit, claimId) {
  const id = String(claimId)
  const r1p = audit?.positionsRound1
  const p1 = r1p && typeof r1p === 'object' && Array.isArray(r1p.positions)
    ? r1p.positions
    : []
  const r1 =
    p1.find((x) => x && typeof x === 'object' && String(x.claimId) === id) ??
    null

  const pick = (arr) => {
    if (!Array.isArray(arr)) return null
    return (
      arr.find((x) => x && typeof x === 'object' && String(x.claimId) === id) ??
      null
    )
  }
  const r2 = audit?.positionsRound2
  const r3 = audit?.positionsRound3
  return {
    r1: r1 && typeof r1 === 'object' ? /** @type {Record<string, unknown>} */ (r1) : null,
    r2gpt: r2 && typeof r2 === 'object' ? pick(r2.gpt) : null,
    r2phi: r2 && typeof r2 === 'object' ? pick(r2.phi) : null,
    r2mistral: r2 && typeof r2 === 'object' ? pick(r2.mistral) : null,
    r3gpt: r3 && typeof r3 === 'object' ? pick(r3.gpt) : null,
    r3phi: r3 && typeof r3 === 'object' ? pick(r3.phi) : null,
    r3mistral: r3 && typeof r3 === 'object' ? pick(r3.mistral) : null,
  }
}
