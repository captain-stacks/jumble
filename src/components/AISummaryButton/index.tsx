import openaiService from '@/services/openai.service'
import { cn } from '@/lib/utils'
import { Loader, Sparkles, X } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { ExtendedKind } from '@/constants'

const SUMMARIZABLE_KINDS = [
  kinds.ShortTextNote,
  kinds.LongFormArticle,
  kinds.Highlights,
  ExtendedKind.COMMENT,
  ExtendedKind.PICTURE,
  ExtendedKind.POLL,
  ExtendedKind.RELAY_REVIEW
]

export function useAISummary(event: Event) {
  const [loading, setLoading] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [apiKeyReady, setApiKeyReady] = useState(() => openaiService.isInitialized())
  useEffect(() => openaiService.subscribe(() => setApiKeyReady(openaiService.isInitialized())), [])

  const supported = useMemo(
    () =>
      SUMMARIZABLE_KINDS.includes(event.kind) &&
      event.content.trim().length > 0 &&
      apiKeyReady,
    [event, apiKeyReady]
  )

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation()

    if (visible) {
      setVisible(false)
      return
    }

    setVisible(true)
    if (summary || loading) return

    setLoading(true)
    try {
      const result = await openaiService.summarizeNote(event.content)
      setSummary(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to summarize')
    } finally {
      setLoading(false)
    }
  }

  const dismiss = (e: React.MouseEvent) => {
    e.stopPropagation()
    setVisible(false)
  }

  return { supported, loading, summary, error, visible, toggle, dismiss }
}

export function AISummaryButton({
  loading,
  visible,
  summary,
  supported,
  toggle,
  className
}: {
  loading: boolean
  visible: boolean
  summary: string | null
  supported: boolean
  toggle: (e: React.MouseEvent) => void
  className?: string
}) {
  if (!supported) return null

  return (
    <button
      className={cn(
        'flex h-full items-center px-2 py-1 text-muted-foreground transition-colors hover:text-purple-400 disabled:text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0',
        className
      )}
      disabled={loading}
      onClick={toggle}
      title="AI Summary"
    >
      {loading ? (
        <Loader className="animate-spin" />
      ) : (
        <Sparkles className={visible && summary ? 'text-purple-400' : ''} />
      )}
    </button>
  )
}

export function AISummaryPanel({
  loading,
  summary,
  error,
  visible,
  dismiss
}: {
  loading: boolean
  summary: string | null
  error: string | null
  visible: boolean
  dismiss: (e: React.MouseEvent) => void
}) {
  if (!visible) return null

  return (
    <div
      className="mt-2 flex items-start gap-2 rounded-md border border-purple-400/30 bg-purple-500/10 px-3 py-2 text-sm text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-purple-400" />
      <span className="flex-1">
        {loading && 'Summarizing...'}
        {!loading && error && <span className="text-red-400">{error}</span>}
        {!loading && summary}
      </span>
      <button className="shrink-0 text-muted-foreground hover:text-foreground" onClick={dismiss}>
        <X className="size-3.5" />
      </button>
    </div>
  )
}
