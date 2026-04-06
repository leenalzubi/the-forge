/** Full URL for GitHub Models chat completions (REST). */
export const GITHUB_MODELS_CHAT_URL =
  'https://models.github.ai/inference/chat/completions'

/** Required for routing some GitHub REST behavior; see GitHub Models docs. */
export const GITHUB_MODELS_API_VERSION = '2026-03-10'

/**
 * Headers GitHub recommends for Models inference (plus any extras, e.g. Content-Type).
 * @param {Record<string, string>} [extra]
 */
export function githubModelsFetchHeaders(extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_MODELS_API_VERSION,
    ...extra,
  }
}
