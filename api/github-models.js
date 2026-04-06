/**
 * Vercel serverless: proxy to GitHub Models so the PAT stays off the client.
 * Set GITHUB_MODELS_PAT in Vercel → Environment Variables (Production / Preview).
 * Falls back to VITE_GITHUB_TOKEN if present on the server (not recommended).
 *
 * IMPORTANT: Do not import from ../src here — some deploy bundles only include /api,
 * which would break the function and yield 404/HTML from the static host.
 */

const UPSTREAM = 'https://models.github.ai/inference/chat/completions'
const GITHUB_MODELS_API_VERSION = '2026-03-10'

function githubModelsFetchHeaders(extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_MODELS_API_VERSION,
    ...extra,
  }
}

function serverToken() {
  return (
    process.env.GITHUB_MODELS_PAT ||
    process.env.VITE_GITHUB_TOKEN ||
    ''
  ).trim()
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'GET') {
    return res.status(200).json({ tokenConfigured: Boolean(serverToken()) })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = serverToken()
  if (!token) {
    return res.status(503).json({
      error:
        'GitHub PAT missing on the server. In Vercel add GITHUB_MODELS_PAT (recommended) under Environment Variables for this environment, then redeploy.',
    })
  }

  const body = req.body
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Expected JSON object body' })
  }

  let upstreamRes
  try {
    upstreamRes = await fetch(UPSTREAM, {
      method: 'POST',
      headers: githubModelsFetchHeaders({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      }),
      body: JSON.stringify(body),
    })
  } catch {
    return res.status(502).json({ error: 'Upstream GitHub Models request failed' })
  }

  const text = await upstreamRes.text()
  res.status(upstreamRes.status)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.send(text)
}
