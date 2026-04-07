/** @typedef {'agree' | 'disagree' | 'partial' | 'silent'} AgentStance */

/**
 * @param {unknown} v
 * @returns {AgentStance}
 */
export function normStance(v) {
  const s = String(v ?? '')
    .toLowerCase()
    .trim()
  if (s === 'agree' || s === 'disagree' || s === 'partial' || s === 'silent') {
    return s
  }
  return 'silent'
}

/**
 * @param {AgentStance} a
 * @param {AgentStance} b
 * @returns {number} divergence contribution in [0, 1]
 */
function scoreClaimPair(a, b) {
  const A = normStance(a)
  const B = normStance(b)

  if (A === B) {
    if (A === 'agree' || A === 'disagree') return 0
    if (A === 'partial') return 0.25
    return 0.25 // silent + silent
  }

  const set = new Set([A, B])
  if (set.has('agree') && set.has('disagree')) return 1
  if (set.has('agree') && set.has('partial')) return 0.5
  if (set.has('agree') && set.has('silent')) return 0.25
  if (set.has('disagree') && set.has('silent')) return 0.5
  return 0.25
}

/**
 * @param {AgentStance} a
 * @param {AgentStance} b
 * @returns {boolean}
 */
function isHardDisagreement(a, b) {
  const A = normStance(a)
  const B = normStance(b)
  return (
    (A === 'agree' && B === 'disagree') || (A === 'disagree' && B === 'agree')
  )
}

/**
 * Pairwise claim divergence from audit positions (gpt vs phi vs mistral).
 *
 * @param {Array<{
 *   claimId?: string,
 *   gpt?: string,
 *   phi?: string,
 *   mistral?: string,
 *   verdict?: string,
 * }>} positions
 * @returns {{
 *   ab: number,
 *   ac: number,
 *   bc: number,
 *   average: number,
 *   totalClaims: number,
 *   contestedClaims: number,
 *   unanimousClaims: number,
 *   hardDisagreements: number,
 * }}
 */
/**
 * Derive debate verdict from three Round-3 stances.
 * @param {unknown} g
 * @param {unknown} p
 * @param {unknown} m
 * @returns {{ verdict: string, minorityIncluded: boolean }}
 */
export function verdictFromThreeStances(g, p, m) {
  const a = [normStance(g), normStance(p), normStance(m)]
  const allSilent = a.every((x) => x === 'silent')
  if (allSilent) {
    return { verdict: 'contested', minorityIncluded: false }
  }
  if (a[0] === a[1] && a[1] === a[2]) {
    return { verdict: 'unanimous', minorityIncluded: false }
  }
  const counts = {}
  for (const x of a) {
    counts[x] = (counts[x] ?? 0) + 1
  }
  const entries = Object.entries(counts).sort((u, v) => v[1] - u[1])
  if (entries.length === 2) {
    const minCount = entries[entries.length - 1][1]
    const minorityIncluded = minCount === 1
    const vTop = entries[0][0]
    const vBot = entries[1][0]
    if (
      (vTop === 'agree' && vBot === 'disagree') ||
      (vTop === 'disagree' && vBot === 'agree')
    ) {
      if (counts.agree === 1 && counts.disagree === 1) {
        return { verdict: 'contested', minorityIncluded: false }
      }
    }
    return { verdict: 'majority', minorityIncluded }
  }
  return { verdict: 'contested', minorityIncluded: false }
}

/**
 * Build divergence input rows from multi-round audit (Round 3 only).
 * @param {Record<string, unknown> | null | undefined} audit
 */
export function buildDivergenceRowsFromAudit(audit) {
  if (!audit || typeof audit !== 'object') return []
  if (Array.isArray(audit.positions)) {
    return /** @type {Array<Record<string, unknown>>} */ (audit.positions)
  }
  const r1 = /** @type {{ positions?: unknown[] }} */ (audit.positionsRound1)
  const p1 = Array.isArray(r1?.positions) ? r1.positions : []
  const r3 = audit.positionsRound3
  const g3 = r3 && typeof r3 === 'object' && Array.isArray(r3.gpt) ? r3.gpt : []
  const p3 =
    r3 && typeof r3 === 'object' && Array.isArray(r3.phi) ? r3.phi : []
  const m3 =
    r3 && typeof r3 === 'object' && Array.isArray(r3.mistral) ? r3.mistral : []

  const map3 = (arr) => {
    const m = new Map()
    for (const row of arr) {
      if (row && typeof row === 'object' && 'claimId' in row) {
        m.set(String(row.claimId), row)
      }
    }
    return m
  }
  const mg = map3(g3)
  const mp = map3(p3)
  const mm = map3(m3)

  return p1.map((row) => {
    const po = /** @type {Record<string, unknown>} */ (row)
    const id = String(po.claimId ?? '')
    const g = mg.get(id)?.position ?? po.gpt
    const p = mp.get(id)?.position ?? po.phi
    const mi = mm.get(id)?.position ?? po.mistral
    const { verdict, minorityIncluded } = verdictFromThreeStances(g, p, mi)
    return {
      claimId: id,
      gpt: g,
      phi: p,
      mistral: mi,
      verdict,
      minorityIncluded,
    }
  })
}

export function computeClaimDivergence(positions) {
  const rows = Array.isArray(positions) ? positions : []
  const n = rows.length

  if (n === 0) {
    return {
      ab: 0,
      ac: 0,
      bc: 0,
      average: 0,
      totalClaims: 0,
      contestedClaims: 0,
      unanimousClaims: 0,
      hardDisagreements: 0,
    }
  }

  let sumAb = 0
  let sumAc = 0
  let sumBc = 0
  let contestedClaims = 0
  let unanimousClaims = 0
  let hardDisagreements = 0

  for (const row of rows) {
    const verdict = String(row?.verdict ?? '')
      .toLowerCase()
      .trim()
    if (verdict === 'contested' || verdict === 'minority') contestedClaims += 1
    if (verdict === 'unanimous') unanimousClaims += 1

    const g = row?.gpt
    const p = row?.phi
    const m = row?.mistral

    const sab = scoreClaimPair(g, p)
    const sac = scoreClaimPair(g, m)
    const sbc = scoreClaimPair(p, m)
    sumAb += sab
    sumAc += sac
    sumBc += sbc

    if (isHardDisagreement(g, p)) hardDisagreements += 1
    if (isHardDisagreement(g, m)) hardDisagreements += 1
    if (isHardDisagreement(p, m)) hardDisagreements += 1
  }

  const ab = sumAb / n
  const ac = sumAc / n
  const bc = sumBc / n
  const average = (ab + ac + bc) / 3

  return {
    ab: Math.round(ab * 10000) / 10000,
    ac: Math.round(ac * 10000) / 10000,
    bc: Math.round(bc * 10000) / 10000,
    average: Math.round(average * 10000) / 10000,
    totalClaims: n,
    contestedClaims,
    unanimousClaims,
    hardDisagreements,
  }
}
