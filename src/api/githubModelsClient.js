/**
 * GitHub Models — OpenAI-compatible chat completions.
 *
 * - Local dev: set VITE_GITHUB_TOKEN (GitHub PAT with Models access).
 * - Production (e.g. Vercel): prefer GITHUB_MODELS_PAT on the server; the client calls
 *   /api/github-models so the token is never embedded in static JS.
 */

import { API_ERROR, isLikelyNetworkError } from '../lib/apiErrors.js'
import {
  GITHUB_MODELS_CHAT_URL,
  githubModelsFetchHeaders,
} from '../lib/githubModelsHttp.js'

const PROXY_PATH = '/api/github-models'

/**
 * @returns {{ url: string, authorization: string | null }}
 */
function resolveGithubChatRequest() {
  const vite =
    typeof import.meta.env.VITE_GITHUB_TOKEN === 'string'
      ? import.meta.env.VITE_GITHUB_TOKEN.trim()
      : ''
  if (vite) {
    return {
      url: GITHUB_MODELS_CHAT_URL,
      authorization: `Bearer ${vite}`,
    }
  }
  if (import.meta.env.PROD) {
    return { url: PROXY_PATH, authorization: null }
  }
  return { url: '', authorization: null }
}

/**
 * @param {number} status
 */
function classifyGitHubModelsStatus(status) {
  if (status === 401 || status === 403) {
    return API_ERROR.GITHUB_TOKEN_REJECTED
  }
  if (status === 404) {
    return API_ERROR.GITHUB_MODEL_NOT_FOUND
  }
  if (status === 429) {
    return API_ERROR.RATE_LIMIT
  }
  return `GitHub Models error: ${status}`
}

/** @param {unknown} data */
function upstreamErrorText(data) {
  if (
    data &&
    typeof data === 'object' &&
    'error' in data &&
    typeof data.error === 'string'
  ) {
    return data.error
  }
  if (
    data &&
    typeof data === 'object' &&
    'message' in data &&
    typeof data.message === 'string'
  ) {
    return data.message
  }
  return ''
}

/**
 * @param {Response} response
 * @param {string} fallback
 */
async function errorMessageFromResponse(response, fallback) {
  try {
    const data = await response.clone().json()
    const t = upstreamErrorText(data)
    if (t) return t
  } catch {
    /* use fallback */
  }
  return fallback
}

export async function callGitHubModel(model, messages, systemPrompt) {
  const { url, authorization } = resolveGithubChatRequest()
  const isProxyRequest = url === PROXY_PATH

  if (!url) {
    throw new Error(API_ERROR.GITHUB_TOKEN_MISSING)
  }

  if (typeof model !== 'string' || !model.trim()) {
    throw new Error('callGitHubModel: model must be a non-empty string.')
  }

  if (typeof systemPrompt !== 'string') {
    throw new Error('callGitHubModel: systemPrompt must be a string.')
  }

  if (!Array.isArray(messages)) {
    throw new Error('callGitHubModel: messages must be an array.')
  }

  const headers = githubModelsFetchHeaders({ 'Content-Type': 'application/json' })
  if (authorization) {
    headers.Authorization = authorization
  }

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
      }),
    })
  } catch (err) {
    if (isLikelyNetworkError(err)) {
      throw new Error(API_ERROR.NETWORK)
    }
    throw err instanceof Error ? err : new Error(String(err))
  }

  if (
    isProxyRequest &&
    response.status === 404 &&
    !(response.headers.get('content-type') ?? '').includes('application/json')
  ) {
    throw new Error(API_ERROR.GITHUB_PROXY_404)
  }

  let data
  try {
    data = await response.json()
  } catch {
    if (!response.ok) {
      const msg = await errorMessageFromResponse(
        response,
        classifyGitHubModelsStatus(response.status)
      )
      throw new Error(msg)
    }
    throw new Error(API_ERROR.NETWORK)
  }

  if (!response.ok) {
    const fallback = classifyGitHubModelsStatus(response.status)
    const msg = upstreamErrorText(data) || fallback
    throw new Error(msg)
  }

  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error(
      'GitHub Models response missing choices[0].message.content string.'
    )
  }

  return content
}

/**
 * Whether the browser has a direct VITE token (local / legacy client-only prod).
 * @returns {boolean}
 */
export function hasGithubModelsClientToken() {
  const v = import.meta.env.VITE_GITHUB_TOKEN
  return typeof v === 'string' && Boolean(v.trim())
}

/**
 * GET /api/github-models — production server token probe (Vercel).
 * @returns {Promise<boolean>}
 */
export async function fetchGithubModelsProxyConfigured() {
  try {
    const r = await fetch(PROXY_PATH, { method: 'GET' })
    if (!r.ok) return false
    const d = await r.json()
    return Boolean(d?.tokenConfigured)
  } catch {
    return false
  }
}
