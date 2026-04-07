import { useCallback, useRef } from 'react'
import { callGitHubModel } from '../api/githubModelsClient.js'
import { AGENT_ROUND1_SYSTEM } from '../api/systemPrompts.js'
import { useForgeUiSettings } from '../context/ForgeSettingsContext.jsx'
import {
  AGENT_TIMEOUT_MESSAGE,
  isAgentTimeoutResponse,
} from '../lib/debateConstants.js'
import {
  isModelCallTimeoutError,
  normalizeDebateFailure,
} from '../lib/modelCallErrors.js'
import { clipInferenceText } from '../lib/clipInferenceText.js'
import { readBabelSynthesisEnabled } from '../lib/babelSynthesisPref.js'
import { useForge } from '../store/useForgeStore.js'
import { runPipelineAfterRound1 } from './debatePipeline.js'

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {import('react').Dispatch<unknown>} dispatch
 */
function bump(dispatch) {
  dispatch({ type: 'INCREMENT_PROGRESS_CALLS', payload: 1 })
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 */
async function tryModel(fn) {
  try {
    const value = await fn()
    return { ok: true, value }
  } catch (e) {
    if (isModelCallTimeoutError(e)) {
      return { ok: false, timeout: true }
    }
    throw e
  }
}

export function useDebateEngine() {
  const { dispatch, state } = useForge()
  const stateRef = useRef(state)
  stateRef.current = state
  const { settings: uiSettings } = useForgeUiSettings()

  const runDebate = useCallback(
    async (prompt, config) => {
      try {
        dispatch({ type: 'SET_ERROR', payload: null })
        const userPrompt = typeof prompt === 'string' ? prompt : String(prompt ?? '')
        dispatch({ type: 'SET_PROMPT', payload: userPrompt.trim() })
        dispatch({ type: 'SET_STATUS', payload: 'running' })

        const promptClipped = clipInferenceText(userPrompt.trim(), 48_000)

        const tA0 = Date.now()
        dispatch({
          type: 'SET_AGENT_THINKING',
          payload: { agent: 'a', startTime: tA0 },
        })
        let ra = AGENT_TIMEOUT_MESSAGE
        {
          const r = await tryModel(() =>
            callGitHubModel(
              config.agentA.model,
              [{ role: 'user', content: promptClipped }],
              AGENT_ROUND1_SYSTEM,
              {
                agentName: config.agentA.name,
                errorContext: { stage: 'round1', round: 1 },
              }
            )
          )
          if (r.ok && 'value' in r) {
            ra = r.value
            dispatch({
              type: 'SET_AGENT_DONE',
              payload: { agent: 'a', response: ra, endTime: Date.now() },
            })
          } else {
            dispatch({
              type: 'SET_AGENT_TIMEOUT',
              payload: { agent: 'a', endTime: Date.now() },
            })
          }
          bump(dispatch)
        }

        await pause(700)
        const tB0 = Date.now()
        dispatch({
          type: 'SET_AGENT_THINKING',
          payload: { agent: 'b', startTime: tB0 },
        })
        let rb = AGENT_TIMEOUT_MESSAGE
        {
          const r = await tryModel(() =>
            callGitHubModel(
              config.agentB.model,
              [{ role: 'user', content: promptClipped }],
              AGENT_ROUND1_SYSTEM,
              {
                agentName: config.agentB.name,
                errorContext: { stage: 'round1', round: 1 },
              }
            )
          )
          if (r.ok && 'value' in r) {
            rb = r.value
            dispatch({
              type: 'SET_AGENT_DONE',
              payload: { agent: 'b', response: rb, endTime: Date.now() },
            })
          } else {
            dispatch({
              type: 'SET_AGENT_TIMEOUT',
              payload: { agent: 'b', endTime: Date.now() },
            })
          }
          bump(dispatch)
        }

        await pause(700)
        const tC0 = Date.now()
        dispatch({
          type: 'SET_AGENT_THINKING',
          payload: { agent: 'c', startTime: tC0 },
        })
        let rc = AGENT_TIMEOUT_MESSAGE
        {
          const r = await tryModel(() =>
            callGitHubModel(
              config.agentC.model,
              [{ role: 'user', content: promptClipped }],
              AGENT_ROUND1_SYSTEM,
              {
                agentName: config.agentC.name,
                errorContext: { stage: 'round1', round: 1 },
              }
            )
          )
          if (r.ok && 'value' in r) {
            rc = r.value
            dispatch({
              type: 'SET_AGENT_DONE',
              payload: { agent: 'c', response: rc, endTime: Date.now() },
            })
          } else {
            dispatch({
              type: 'SET_AGENT_TIMEOUT',
              payload: { agent: 'c', endTime: Date.now() },
            })
          }
          bump(dispatch)
        }

        if (
          isAgentTimeoutResponse(ra) &&
          isAgentTimeoutResponse(rb) &&
          isAgentTimeoutResponse(rc)
        ) {
          throw new Error(
            'All three models timed out in round 1. Check your connection or try again.'
          )
        }

        dispatch({
          type: 'SET_LAST_COMPLETED_STAGE',
          payload: { stage: 'round1' },
        })

        const synthesisEnabled = readBabelSynthesisEnabled()
        await runPipelineAfterRound1({
          dispatch,
          uiSettings,
          userPrompt,
          config,
          ra,
          rb,
          rc,
          synthesisEnabled,
        })
      } catch (err) {
        dispatch({ type: 'SET_ERROR', payload: normalizeDebateFailure(err) })
        dispatch({ type: 'SET_STATUS', payload: 'error' })
      }
    },
    [dispatch, uiSettings]
  )

  const resetAndRetry = useCallback(() => {
    const snap = stateRef.current
    const p = snap.prompt
    const c = snap.config
    dispatch({ type: 'RESET' })
    dispatch({ type: 'SET_PROMPT', payload: p })
    void runDebate(p, c)
  }, [dispatch, runDebate])

  const resetForEditPrompt = useCallback(() => {
    const snap = stateRef.current
    const p = snap.prompt
    dispatch({ type: 'RESET' })
    dispatch({ type: 'SET_PROMPT', payload: p })
  }, [dispatch])

  return {
    runDebate,
    resetAndRetry,
    resetForEditPrompt,
  }
}
