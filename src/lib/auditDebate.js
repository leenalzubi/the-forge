import { callGitHubModel } from '../api/githubModelsClient.js'
import { verdictFromThreeStances } from './claimDivergence.js'
import { clipInferenceText } from './clipInferenceText.js'

const CLAIMS_SYSTEM = `You are a precise analytical assistant. Extract the 3-5 most specific, falsifiable claims from each of these three AI responses to the same prompt. A claim is a concrete assertion that can be agreed with, disagreed with, or partially agreed with.

Return ONLY valid JSON in exactly this format, no preamble:
{
  "claims": [
    { "id": "c1", "text": "brief claim statement under 15 words" },
    { "id": "c2", "text": "..." }
  ]
}`

const POSITIONS_SYSTEM = `You are a precise analytical assistant. For each claim, determine each agent's position based on their response.

Return ONLY valid JSON:
{
  "positions": [
    {
      "claimId": "c1",
      "gpt": "agree" | "disagree" | "partial" | "silent",
      "phi": "agree" | "disagree" | "partial" | "silent",
      "mistral": "agree" | "disagree" | "partial" | "silent",
      "verdict": "unanimous" | "majority" | "contested" | "minority",
      "minorityIncluded": true | false
    }
  ]
}`

const POSITION_ROUND2_REMAP = `Given these specific claims extracted from the debate, and this model's round 2 cross-review and rebuttal response, determine its current position on each claim.

A position may have changed from round 1 if the model challenged, conceded, or softened its view.

Return ONLY valid JSON:
{
  "positions": [
    {
      "claimId": "c1",
      "position": "agree" | "disagree" | "partial" | "silent",
      "changed": true | false,
      "changeNote": "one sentence explaining the shift or null"
    }
  ]
}`

const POSITION_ROUND3_REMAP = `Given these specific claims extracted from the debate, and this model's round 3 final position response, determine its current position on each claim.

A position may have changed from round 2 if the model challenged, conceded, or softened its view.

Return ONLY valid JSON:
{
  "positions": [
    {
      "claimId": "c1",
      "position": "agree" | "disagree" | "partial" | "silent",
      "changed": true | false,
      "changeNote": "one sentence explaining the shift or null"
    }
  ]
}`

const TRACE_SYSTEM = `You are auditing an AI debate. For this specific claim, trace its full journey through the debate.

Return ONLY valid JSON:
{
  "claimId": "c1",
  "origin": {
    "agent": "mistral",
    "quote": "exact short quote from their response, max 25 words"
  },
  "challenge": {
    "occurred": true | false,
    "by": ["gpt"] | ["phi"] | ["gpt", "phi"] | [],
    "quote": "exact short quote of the challenge, max 25 words",
    "type": "direct" | "implicit" | "reframe" | "none"
  },
  "defense": {
    "occurred": true | false,
    "by": "agent name or null",
    "quote": "quote or null"
  },
  "synthesisTreatment": {
    "included": true | false,
    "framing": "original" | "modified" | "merged" | "dropped",
    "quote": "how it appears in synthesis, max 25 words",
    "drift": true | false,
    "driftNote": "one sentence explaining the framing shift or null"
  },
  "flag": true | false,
  "flagReason": "why this is notable or null"
}`

/** @param {string} text */
function extractJsonObject(text) {
  let t = typeof text === 'string' ? text.trim() : ''
  const fence = /```(?:json)?\s*([\s\S]*?)```/im
  const fm = t.match(fence)
  if (fm) t = fm[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('Audit: model response contained no JSON object.')
  }
  return JSON.parse(t.slice(start, end + 1))
}

/**
 * @param {{
 *   config: {
 *     agentA: { name: string, model: string },
 *     agentB: { name: string },
 *     agentC: { name: string },
 *   },
 *   prompt: string,
 *   round1: { agentA: string, agentB: string, agentC: string },
 *   reviews: { aReviews: string, bReviews: string, cReviews: string },
 *   synthesis: { output: string },
 *   finalPositions?: { agentA: string, agentB: string, agentC: string },
 * }} snapshot
 */
/**
 * Cross-review plus optional follow-up rebuttal text for audit pass 2.
 * @param {{
 *   reviews: { aReviews: string, bReviews: string, cReviews: string },
 *   rebuttals?: { a?: string, b?: string, c?: string },
 * }} snapshot
 * @param {'a' | 'b' | 'c'} slot
 */
function round2ResponseForAgent(snapshot, slot) {
  const R = snapshot.reviews
  const B =
    snapshot.rebuttals && typeof snapshot.rebuttals === 'object'
      ? snapshot.rebuttals
      : {}
  const main =
    slot === 'a' ? R.aReviews : slot === 'b' ? R.bReviews : R.cReviews
  const extraRaw = slot === 'a' ? B.a : slot === 'b' ? B.b : B.c
  const extra = typeof extraRaw === 'string' ? extraRaw.trim() : ''
  if (!extra) return main
  return `${main}\n\n--- Follow-up rebuttal ---\n\n${extra}`
}

function buildRound1Bundle(snapshot) {
  const { config, round1 } = snapshot
  return [
    `Original prompt:\n${snapshot.prompt}`,
    `=== ${config.agentA.name} (key: gpt) ===\n${round1.agentA}`,
    `=== ${config.agentB.name} (key: phi) ===\n${round1.agentB}`,
    `=== ${config.agentC.name} (key: mistral) ===\n${round1.agentC}`,
  ].join('\n\n')
}

/**
 * @param {{
 *   config: {
 *     agentA: { name: string, model: string },
 *     agentB: { name: string },
 *     agentC: { name: string },
 *   },
 *   prompt: string,
 *   round1: { agentA: string, agentB: string, agentC: string },
 *   reviews: { aReviews: string, bReviews: string, cReviews: string },
 *   synthesis: { output: string },
 *   finalPositions?: { agentA: string, agentB: string, agentC: string },
 * }} snapshot
 * @param {{ id: string, text: string }} claim
 * @param {Record<string, unknown>} positionRow
 */
function buildTraceUserMessage(snapshot, claim, positionRow) {
  const { config, synthesis } = snapshot
  const bundle = buildRound1Bundle(snapshot)
  const reviewsBlock = [
    `=== ${config.agentA.name} (round 2) ===\n${round2ResponseForAgent(snapshot, 'a')}`,
    `=== ${config.agentB.name} (round 2) ===\n${round2ResponseForAgent(snapshot, 'b')}`,
    `=== ${config.agentC.name} (round 2) ===\n${round2ResponseForAgent(snapshot, 'c')}`,
  ].join('\n\n')
  return clipInferenceText(
    [
      `Claim to audit (id: ${claim.id}): ${claim.text}`,
      `Position summary after round 3 (JSON): ${JSON.stringify(positionRow)}`,
      '',
      '--- Round 1 responses ---',
      bundle,
      '',
      '--- Cross-reviews ---',
      reviewsBlock,
      '',
      '--- Synthesis output ---',
      synthesis.output,
      '',
      'Keys: origin.agent must be one of: gpt, phi, mistral (matching Agent A/B/C slots above).',
    ].join('\n'),
    56_000
  )
}

/**
 * @param {{ id: string, text: string }[]} claims
 * @param {Record<string, unknown>[]} round1Positions
 * @param {string} agentKey
 * @param {string} responseText
 * @param {string} agentName
 * @param {string} systemPrompt
 * @param {string} model
 */
async function remapPositionsForRound(
  claims,
  round1Positions,
  agentKey,
  responseText,
  agentName,
  systemPrompt,
  model
) {
  const prior = round1Positions.map((r) => {
    const row = /** @type {Record<string, unknown>} */ (r)
    return {
      claimId: row.claimId,
      priorPosition: row[agentKey],
    }
  })
  const user = clipInferenceText(
    [
      'Claims JSON:',
      JSON.stringify({ claims }),
      '',
      `Prior positions for this model (${agentKey}) per claimId:`,
      JSON.stringify(prior),
      '',
      `This is ${agentName}'s (${agentKey}) full response to analyze:`,
      responseText,
    ].join('\n'),
    56_000
  )
  const raw = await callGitHubModel(
    model,
    [{ role: 'user', content: user }],
    systemPrompt,
    { maxTokens: 4096 }
  )
  const parsed = extractJsonObject(raw)
  return Array.isArray(parsed.positions) ? parsed.positions : []
}

/**
 * @param {{ id: string, text: string }[]} claims
 * @param {unknown[]} priorRoundPositions
 * @param {string} agentKey
 * @param {string} responseText
 * @param {string} agentName
 * @param {string} systemPrompt
 * @param {string} model
 */
async function remapPositionsFromPriorArray(
  claims,
  priorRoundPositions,
  agentKey,
  responseText,
  agentName,
  systemPrompt,
  model
) {
  const prior = priorRoundPositions.map((r) => {
    const row = /** @type {Record<string, unknown>} */ (r)
    return {
      claimId: row.claimId,
      priorPosition: row.position,
    }
  })
  const user = clipInferenceText(
    [
      'Claims JSON:',
      JSON.stringify({ claims }),
      '',
      `Prior positions for this model (${agentKey}) per claimId (from last round):`,
      JSON.stringify(prior),
      '',
      `This is ${agentName}'s (${agentKey}) round 3 final position text:`,
      responseText,
    ].join('\n'),
    56_000
  )
  const raw = await callGitHubModel(
    model,
    [{ role: 'user', content: user }],
    systemPrompt,
    { maxTokens: 4096 }
  )
  const parsed = extractJsonObject(raw)
  return Array.isArray(parsed.positions) ? parsed.positions : []
}

/**
 * @param {unknown[]} gptP
 * @param {unknown[]} phiP
 * @param {unknown[]} mistralP
 * @param {Record<string, unknown>[]} round1Positions
 */
function mergeR3RowsForTrace(gptP, phiP, mistralP, round1Positions) {
  /** @param {unknown[]} arr */
  const mapBy = (arr) => {
    const m = new Map()
    if (!Array.isArray(arr)) return m
    for (const row of arr) {
      if (row && typeof row === 'object' && 'claimId' in row) {
        m.set(String(row.claimId), row)
      }
    }
    return m
  }
  const mg = mapBy(gptP)
  const mp = mapBy(phiP)
  const mm = mapBy(mistralP)
  return round1Positions.map((r) => {
    const row = /** @type {Record<string, unknown>} */ (r)
    const id = String(row.claimId ?? '')
    const g =
      mg.get(id) && typeof mg.get(id) === 'object'
        ? /** @type {Record<string, unknown>} */ (mg.get(id)).position
        : row.gpt
    const p =
      mp.get(id) && typeof mp.get(id) === 'object'
        ? /** @type {Record<string, unknown>} */ (mp.get(id)).position
        : row.phi
    const mi =
      mm.get(id) && typeof mm.get(id) === 'object'
        ? /** @type {Record<string, unknown>} */ (mm.get(id)).position
        : row.mistral
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

/**
 * @param {{
 *   config: { agentA: { name: string, model: string }, agentB: { name: string }, agentC: { name: string } },
 *   prompt: string,
 *   round1: { agentA: string, agentB: string, agentC: string },
 *   reviews: { aReviews: string, bReviews: string, cReviews: string },
 *   rebuttals?: { a?: string, b?: string, c?: string },
 *   synthesis: { output: string },
 *   finalPositions?: { agentA: string, agentB: string, agentC: string },
 * }} snapshot
 */
export async function runAudit(snapshot) {
  const model = snapshot.config.agentA.model
  const { config } = snapshot
  const r2a = round2ResponseForAgent(snapshot, 'a')
  const r2b = round2ResponseForAgent(snapshot, 'b')
  const r2c = round2ResponseForAgent(snapshot, 'c')
  const finals = snapshot.finalPositions ?? {
    agentA: '',
    agentB: '',
    agentC: '',
  }

  const round1User = clipInferenceText(buildRound1Bundle(snapshot), 56_000)

  const rawClaims = await callGitHubModel(
    model,
    [{ role: 'user', content: round1User }],
    CLAIMS_SYSTEM,
    { maxTokens: 4096 }
  )

  const claimsParsed = extractJsonObject(rawClaims)
  const claims = Array.isArray(claimsParsed.claims) ? claimsParsed.claims : []

  const positionsUser = clipInferenceText(
    [
      'Extracted claims JSON:',
      JSON.stringify({ claims }),
      '',
      'Use these round-1 responses to map each agent position (gpt = Agent A, phi = Agent B, mistral = Agent C):',
      round1User,
    ].join('\n'),
    56_000
  )

  const rawPositions = await callGitHubModel(
    model,
    [{ role: 'user', content: positionsUser }],
    POSITIONS_SYSTEM,
    { maxTokens: 4096 }
  )

  const positionsParsed = extractJsonObject(rawPositions)
  const positionsR1 = Array.isArray(positionsParsed.positions)
    ? positionsParsed.positions
    : []

  const positionsRound1 = { claims, positions: positionsR1 }

  const [gpt2, phi2, mistral2] = await Promise.all([
    remapPositionsForRound(
      claims,
      positionsR1,
      'gpt',
      r2a,
      config.agentA.name,
      POSITION_ROUND2_REMAP,
      model
    ),
    remapPositionsForRound(
      claims,
      positionsR1,
      'phi',
      r2b,
      config.agentB.name,
      POSITION_ROUND2_REMAP,
      model
    ),
    remapPositionsForRound(
      claims,
      positionsR1,
      'mistral',
      r2c,
      config.agentC.name,
      POSITION_ROUND2_REMAP,
      model
    ),
  ])

  const positionsRound2 = {
    gpt: gpt2,
    phi: phi2,
    mistral: mistral2,
  }

  const [gpt3, phi3, mistral3] = await Promise.all([
    remapPositionsFromPriorArray(
      claims,
      gpt2,
      'gpt',
      finals.agentA,
      config.agentA.name,
      POSITION_ROUND3_REMAP,
      model
    ),
    remapPositionsFromPriorArray(
      claims,
      phi2,
      'phi',
      finals.agentB,
      config.agentB.name,
      POSITION_ROUND3_REMAP,
      model
    ),
    remapPositionsFromPriorArray(
      claims,
      mistral2,
      'mistral',
      finals.agentC,
      config.agentC.name,
      POSITION_ROUND3_REMAP,
      model
    ),
  ])

  const positionsRound3 = {
    gpt: gpt3,
    phi: phi3,
    mistral: mistral3,
  }

  const claimById = new Map(claims.map((c) => [c.id, c]))
  const mergedR3Rows = mergeR3RowsForTrace(gpt3, phi3, mistral3, positionsR1)

  const needsTrace = (/** @type {Record<string, unknown>} */ p) =>
    p.verdict === 'contested' || p.minorityIncluded === true

  const traceTargets = mergedR3Rows.filter(needsTrace)

  const traceResults = await Promise.all(
    traceTargets.map(async (pos) => {
      const claimId = String(pos.claimId ?? '')
      const claim = claimById.get(claimId)
      if (!claim) {
        return {
          claimId,
          error: 'Claim id not found',
        }
      }
      try {
        const userMsg = buildTraceUserMessage(snapshot, claim, pos)
        const raw = await callGitHubModel(
          model,
          [{ role: 'user', content: userMsg }],
          TRACE_SYSTEM,
          { maxTokens: 4096 }
        )
        return extractJsonObject(raw)
      } catch (e) {
        return {
          claimId,
          error: e instanceof Error ? e.message : String(e),
        }
      }
    })
  )

  return {
    claims,
    positionsRound1,
    positionsRound2,
    positionsRound3,
    traces: traceResults,
  }
}
