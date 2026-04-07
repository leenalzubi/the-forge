import { AlertTriangle } from 'lucide-react'

/**
 * @param {{ message: string | null, onDismiss: () => void }} props
 */
const CONTENT_FILTER_BANNER =
  'One model was blocked by a content filter. Try rephrasing your prompt — avoid ambiguous or sensitive framings.'

export default function ErrorBanner({ message, onDismiss }) {
  if (!message) return null

  const raw = typeof message === 'string' ? message : String(message ?? '')
  const looksLikeContentFilter = /content filter/i.test(raw)
  const text = looksLikeContentFilter ? CONTENT_FILTER_BANNER : raw

  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-forge-card border border-[var(--diverge)]/35 bg-[color-mix(in_srgb,var(--diverge)_8%,var(--bg-surface))] px-4 py-3 text-[var(--text-primary)]"
      role="alert"
    >
      <AlertTriangle
        className="mt-0.5 h-5 w-5 shrink-0 text-red-600"
        aria-hidden
      />
      <p className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-red-900">
        {text}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1 font-mono text-[10px] font-medium text-red-800 hover:bg-red-100"
      >
        Dismiss
      </button>
    </div>
  )
}
