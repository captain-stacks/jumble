import { Button } from '@/components/ui/button'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import openaiService from '@/services/openai.service'
import { getDefaultRelayUrls } from '@/lib/relay'
import client from '@/services/client.service'
import { Filter } from 'nostr-tools'
import { forwardRef, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  Trash2,
  X,
  XCircle
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type TNostrEvent = {
  id: string
  pubkey: string
  kind: number
  content: string
  created_at: number
  tags?: string[][]
}

type TProcessingOperation =
  | 'filter'
  | 'sort'
  | 'deduplicate'
  | 'top'
  | 'count'
  | 'summarize'
  | 'customScript'

type TQueryAction = {
  type: 'query'
  description: string
  filter: Filter
  relays?: string[]
}

type TProcessAction = {
  type: 'process'
  description: string
  operation: TProcessingOperation
  params: Record<string, any>
}

type TAction = TQueryAction | TProcessAction

type TActionResult = {
  action: TAction
  output: TNostrEvent[] | { key: string; count: number }[] | string | null
  status: 'pending' | 'running' | 'done' | 'error'
  error?: string
}

type TMessage = {
  role: 'user' | 'assistant' | 'system'
  content: string
  actions?: TActionResult[]
  request?: any
  response?: any
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Nostr protocol AI agent. Respond with valid JSON only (no markdown):

{
  "message": "brief explanation of your plan",
  "actions": [
    { "type": "query", "description": "...", "filter": { "kinds": [1], "limit": 20 }, "relays": [] },
    { "type": "process", "description": "...", "operation": "filter", "params": { "field": "content", "contains": "bitcoin" } }
  ]
}

Query action — fetches Nostr events from relays:
- filter fields: ids, authors, kinds, since, until, limit, #e, #p, #t
- limit <= 100; kinds: 0=profile 1=note 3=follows 6=repost 7=reaction 9735=zap
- relays: optional wss:// URLs; use [] for defaults

Process action — transforms the collected data sequentially (each step receives the previous step's output, or all query results for the first process step):
- "filter": { "field": "content"|"pubkey"|"kind", "contains": "string" } or { "field": "pubkey"|"kind", "equals": value }
- "sort": { "field": "created_at"|"content", "order": "asc"|"desc" }
- "deduplicate": { "field": "pubkey"|"id" }
- "top": { "n": number }
- "count": { "groupBy": "pubkey"|"kind" }
- "summarize": {} — AI-generated natural language summary of the data
- "customScript": { "code": "function(data) { /* your JS code here */ return processedData; }" } — For complex operations, provide a Javascript function that takes an array of events and returns a modified array. The function will be executed in a sandboxed environment. Only use this when the other operations are not sufficient.

Design the full plan in one response: include queries to gather data and process steps to answer the question.
If no actions are needed (e.g. a general question), return "actions": [].
Respond ONLY with valid JSON.`

// ── OpenAI helper ─────────────────────────────────────────────────────────────

async function callOpenAI(apiKey: string, messages: { role: string; content: string }[]) {
  const body = { model: 'gpt-4o', messages, temperature: 0.2 }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)
  const response = await res.json()
  return { request: body, response }
}

// ── Build conversation history for OpenAI ─────────────────────────────────────

function buildHistory(msgs: TMessage[]): { role: string; content: string }[] {
  return msgs.flatMap((m) => {
    if (m.role === 'user') return [{ role: 'user', content: m.content }]
    if (m.role === 'assistant') {
      let text = m.content
      try {
        text = JSON.parse(m.content).message ?? m.content
      } catch { /* invalid JSON, use raw content */ }
      if (m.actions?.some((a) => a.status === 'done' || a.status === 'error')) {
        const summary = m.actions
          .map((a) => {
            const label = `[${a.action.type}] ${a.action.description}`
            if (a.status === 'done') {
              if (typeof a.output === 'string') return `${label}: "${a.output.slice(0, 300)}"`
              if (Array.isArray(a.output)) return `${label}: ${a.output.length} results`
            }
            if (a.status === 'error') return `${label}: ERROR — ${a.error}`
            return `${label}: ${a.status}`
          })
          .join('\n')
        text = `${text}\n\nResults:\n${summary}`
      }
      return [{ role: 'assistant', content: text }]
    }
    return []
  })
}

// ── Replaceable event deduplication ──────────────────────────────────────────

function deduplicateReplaceableEvents(events: TNostrEvent[]): TNostrEvent[] {
  const isReplaceable = (kind: number) => kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)
  const isParamReplaceable = (kind: number) => kind >= 30000 && kind < 40000

  const replaceableMap = new Map<string, TNostrEvent>()
  const paramMap = new Map<string, TNostrEvent>()
  const regular: TNostrEvent[] = []

  for (const e of events) {
    if (isReplaceable(e.kind)) {
      const key = `${e.pubkey}:${e.kind}`
      const existing = replaceableMap.get(key)
      if (!existing || e.created_at > existing.created_at) replaceableMap.set(key, e)
    } else if (isParamReplaceable(e.kind)) {
      const d = e.tags?.find((t) => t[0] === 'd')?.[1] ?? ''
      const key = `${e.pubkey}:${e.kind}:${d}`
      const existing = paramMap.get(key)
      if (!existing || e.created_at > existing.created_at) paramMap.set(key, e)
    } else {
      regular.push(e)
    }
  }

  return [...regular, ...replaceableMap.values(), ...paramMap.values()]
}

// ── Process step execution ────────────────────────────────────────────────────

async function runProcessStep(
  action: TProcessAction,
  events: TNostrEvent[],
  apiKey: string,
  question: string
): Promise<TNostrEvent[] | { key: string; count: number }[] | string> {
  const { operation, params } = action

  if (operation === 'filter') {
    return Promise.resolve(
      events.filter((e) => {
        const val = (e as any)[params.field] ?? ''
        if (params.contains !== undefined)
          return String(val).toLowerCase().includes(String(params.contains).toLowerCase())
        if (params.equals !== undefined) return val === params.equals
        return true
      })
    )
  }
  if (operation === 'sort') {
    return Promise.resolve(
      [...events].sort((a, b) => {
        const av = (a as any)[params.field] ?? ''
        const bv = (b as any)[params.field] ?? ''
        return params.order === 'asc' ? (av > bv ? 1 : -1) : av < bv ? 1 : -1
      })
    )
  }
  if (operation === 'deduplicate') {
    const seen = new Set()
    return Promise.resolve(
      events.filter((e) => {
        const key = (e as any)[params.field]
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    )
  }
  if (operation === 'top') {
    return Promise.resolve(events.slice(0, params.n ?? 10))
  }
  if (operation === 'count') {
    const counts: Record<string, number> = {}
    events.forEach((e) => {
      const key = String((e as any)[params.groupBy] ?? 'unknown')
      counts[key] = (counts[key] ?? 0) + 1
    })
    return Promise.resolve(
      Object.entries(counts)
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count)
    )
  }
  if (operation === 'summarize') {
    const sample = events.slice(0, 50).map((e) => ({
      kind: e.kind,
      content: e.content.slice(0, 300),
      created_at: new Date(e.created_at * 1000).toISOString()
    }))
    const result = await callOpenAI(apiKey, [
      {
        role: 'system',
        content:
          'You are a Nostr data analyst. Provide a concise analytical summary of the events that answers the user question.'
      },
      {
        role: 'user',
        content: `Question: "${question}"\n\nEvents (${events.length} total, showing up to 50):\n${JSON.stringify(
          sample,
          null,
          2
        )}\n\nProvide a clear summary answering the question.`
      }
    ])
    return result.response.choices[0].message.content as string
  }
  if (operation === 'customScript') {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./ai-agent.worker.ts', import.meta.url), {
        type: 'module'
      })
      worker.onmessage = (e) => {
        if (e.data.error) {
          reject(new Error(e.data.error))
        } else {
          resolve(e.data.results)
        }
        worker.terminate()
      }
      worker.onerror = (e) => {
        reject(new Error(`Worker error: ${e.message}`))
        worker.terminate()
      }
      worker.postMessage({
        code: params.code,
        data: events
      })
    })
  }
  return Promise.resolve(events)
}

// ── Main component ────────────────────────────────────────────────────────────

const AIAgentPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<TMessage[]>(() => {
    try {
      const stored = localStorage.getItem('ai_agent_history')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openai_api_key') ?? '')
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeyDraft, setApiKeyDraft] = useState(apiKey)
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    try {
      const sanitized = messages.map((m) => ({
        ...m,
        actions: m.actions?.map((a) => ({
          ...a,
          output: null,
          status: a.status === 'running' ? 'pending' : a.status
        }))
      }))
      localStorage.setItem('ai_agent_history', JSON.stringify(sanitized))
    } catch (_e) { /* storage unavailable */ }
  }, [messages])

  const scrollToBottom = () =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

  const saveApiKey = () => {
    openaiService.setApiKey(apiKeyDraft)
    setApiKey(apiKeyDraft)
    setShowSettings(false)
  }

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading) return
    if (!apiKey) {
      setShowSettings(true)
      return
    }

    const userMsg: TMessage = { role: 'user', content: text }
    const history = [...messages, userMsg]
    setMessages(history)
    setInput('')
    setLoading(true)
    scrollToBottom()

    try {
      const { request, response } = await callOpenAI(apiKey, [
        { role: 'system', content: SYSTEM_PROMPT },
        ...buildHistory(history)
      ])
      const raw = response.choices[0]?.message?.content ?? ''
      let parsed: { message: string; actions: TAction[] }
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new Error(`Could not parse AI response as JSON:\n${raw}`)
      }
      const assistantMsg: TMessage = {
        role: 'assistant',
        content: raw,
        actions: (parsed.actions ?? []).map((a) => ({ action: a, output: null, status: 'pending' })),
        request,
        response
      }
      setMessages([...history, assistantMsg])
    } catch (e: any) {
      setMessages([...history, { role: 'system', content: `Error: ${e.message}` }])
    } finally {
      setLoading(false)
      scrollToBottom()
    }
  }

  const executeAction = async (
    msgIndex: number,
    actionIndex: number,
    inputOverride?: TNostrEvent[]
  ): Promise<TActionResult['output']> => {
    const msg = messagesRef.current[msgIndex]
    const action = msg.actions![actionIndex].action
    const question =
      messagesRef.current
        .slice(0, msgIndex)
        .reverse()
        .find((m) => m.role === 'user')?.content ?? ''

    setMessages((prev) => {
      const next = [...prev]
      const m = { ...next[msgIndex], actions: [...(next[msgIndex].actions ?? [])] }
      m.actions[actionIndex] = { ...m.actions[actionIndex], status: 'running' }
      next[msgIndex] = m
      return next
    })

    try {
      let output: TActionResult['output']

      if (action.type === 'query') {
        const relays = action.relays?.length ? action.relays : getDefaultRelayUrls()
        const rawEvents = await client.fetchEvents(relays, action.filter)
        output = deduplicateReplaceableEvents(
          rawEvents.map((e) => ({
            id: e.id,
            pubkey: e.pubkey,
            kind: e.kind,
            content: e.content,
            created_at: e.created_at,
            tags: e.tags
          }))
        )
      } else {
        let inputEvents: TNostrEvent[]
        if (inputOverride) {
          inputEvents = inputOverride
        } else {
          // Manual single-step run: read from settled state via ref
          const currentActions = messagesRef.current[msgIndex].actions ?? []
          inputEvents = []
          let foundPrev = false
          for (let i = actionIndex - 1; i >= 0; i--) {
            const prev = currentActions[i]
            if (
              prev.action.type === 'process' &&
              prev.status === 'done' &&
              Array.isArray(prev.output) &&
              prev.output.length > 0 &&
              'id' in (prev.output[0] as any)
            ) {
              inputEvents = prev.output as TNostrEvent[]
              foundPrev = true
              break
            }
          }
          if (!foundPrev) {
            inputEvents = currentActions
              .filter((a) => a.action.type === 'query' && a.status === 'done' && Array.isArray(a.output))
              .flatMap((a) => a.output as TNostrEvent[])
          }
        }
        output = await runProcessStep(action, inputEvents, apiKey, question)
      }

      setMessages((prev) => {
        const next = [...prev]
        const m = { ...next[msgIndex], actions: [...(next[msgIndex].actions ?? [])] }
        m.actions[actionIndex] = { ...m.actions[actionIndex], status: 'done', output }
        next[msgIndex] = m
        return next
      })
      scrollToBottom()
      return output
    } catch (e: any) {
      setMessages((prev) => {
        const next = [...prev]
        const m = { ...next[msgIndex], actions: [...(next[msgIndex].actions ?? [])] }
        m.actions[actionIndex] = { ...m.actions[actionIndex], status: 'error', error: e.message }
        next[msgIndex] = m
        return next
      })
      scrollToBottom()
      return null
    }
  }

  const executeAll = async (msgIndex: number) => {
    const actions = messagesRef.current[msgIndex].actions ?? []

    // Run queries in parallel, collecting outputs directly (don't rely on state updates)
    const queryOutputs: TNostrEvent[][] = []
    await Promise.all(
      actions.map(async (a, i) => {
        if (a.action.type !== 'query') return
        if (a.status === 'done' && Array.isArray(a.output)) {
          queryOutputs.push(a.output as TNostrEvent[])
          return
        }
        if (a.status !== 'pending') return
        const out = await executeAction(msgIndex, i)
        if (Array.isArray(out)) queryOutputs.push(out as TNostrEvent[])
      })
    )

    // Run process steps sequentially, passing output from one to the next
    let processInput: TNostrEvent[] = queryOutputs.flat()
    for (let i = 0; i < actions.length; i++) {
      if (actions[i].action.type !== 'process' || actions[i].status !== 'pending') continue
      const out = await executeAction(msgIndex, i, processInput)
      if (Array.isArray(out) && out.length > 0 && 'id' in (out[0] as any)) {
        processInput = out as TNostrEvent[]
      } else if (Array.isArray(out) && out.length === 0) {
        processInput = []
      }
    }
  }

  const resetActionsFrom = (msgIndex: number, fromIndex: number) => {
    setMessages((prev) => {
      const next = [...prev]
      const msg = next[msgIndex]
      next[msgIndex] = {
        ...msg,
        actions: msg.actions?.map((a, i) =>
          i >= fromIndex ? { ...a, status: 'pending', output: null, error: undefined } : a
        )
      }
      return next
    })
  }

  const resetAllActions = (msgIndex: number) => resetActionsFrom(msgIndex, 0)

  const updateAction = (msgIndex: number, actionIndex: number, action: TAction) => {
    setMessages((prev) => {
      const next = [...prev]
      const actions = [...(next[msgIndex].actions ?? [])]
      actions[actionIndex] = { ...actions[actionIndex], action }
      next[msgIndex] = { ...next[msgIndex], actions }
      return next
    })
  }

  const deleteAction = (msgIndex: number, actionIndex: number) => {
    setMessages((prev) => {
      const next = [...prev]
      next[msgIndex] = {
        ...next[msgIndex],
        actions: (next[msgIndex].actions ?? []).filter((_, i) => i !== actionIndex)
      }
      return next
    })
  }

  const addAction = (msgIndex: number, afterIndex: number) => {
    const newResult: TActionResult = {
      action: { type: 'query', description: 'New query', filter: { kinds: [1], limit: 20 }, relays: [] },
      output: null,
      status: 'pending'
    }
    setMessages((prev) => {
      const next = [...prev]
      const actions = [...(next[msgIndex].actions ?? [])]
      actions.splice(afterIndex + 1, 0, newResult)
      next[msgIndex] = { ...next[msgIndex], actions }
      return next
    })
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('AI Agent')}>
      <div className="flex flex-col gap-0">
        {/* Settings */}
        <div className="border-b px-4 py-2">
          <button
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setShowSettings((v) => !v)}
          >
            <Settings2 className="size-3.5" />
            {t('OpenAI settings')}
          </button>
          {showSettings && (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="password"
                  className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                  placeholder="sk-..."
                  value={apiKeyDraft}
                  onChange={(e) => setApiKeyDraft(e.target.value)}
                />
                <Button size="sm" onClick={saveApiKey}>
                  {t('Save')}
                </Button>
              </div>
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => {
                  setMessages([])
                  setShowSettings(false)
                }}
              >
                <Trash2 className="size-3.5" />
                {t('Clear history')}
              </button>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="flex flex-col gap-4 px-4 py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-12 text-muted-foreground">
              <Bot className="size-10 opacity-40" />
              <p className="text-center text-sm">
                {t('Ask the AI agent to query and analyze Nostr data.')}
              </p>
            </div>
          )}

          {messages.map((msg, msgIdx) => (
            <div key={msgIdx} className="flex flex-col gap-3">
              {msg.role === 'user' && (
                <div className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
                    {msg.content}
                  </div>
                </div>
              )}

              {msg.role === 'system' && (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {msg.content}
                </div>
              )}

              {msg.role === 'assistant' && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
                    <p className="text-sm">
                      {(() => {
                        try {
                          return JSON.parse(msg.content).message ?? msg.content
                        } catch {
                          return msg.content
                        }
                      })()}
                    </p>
                  </div>

                  {msg.request && msg.response && (
                    <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3">
                      <details>
                        <summary className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t('API Call Details')}
                        </summary>
                        <div className="flex flex-col gap-2 pt-2">
                          <div>
                            <h4 className="text-sm font-semibold">{t('Request')}</h4>
                            <pre className="overflow-x-auto rounded-lg bg-background p-2 text-xs">
                              {(() => {
                                try {
                                  return JSON.stringify(msg.request, null, 2)
                                } catch {
                                  return 'Error serializing request'
                                }
                              })()}
                            </pre>
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold">{t('Response')}</h4>
                            <pre className="overflow-x-auto rounded-lg bg-background p-2 text-xs">
                              {(() => {
                                try {
                                  return JSON.stringify(msg.response, null, 2)
                                } catch {
                                  return 'Error serializing response'
                                }
                              })()}
                            </pre>
                          </div>
                        </div>
                      </details>
                    </div>
                  )}

                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t('Actions')}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {msg.actions.some((a) => a.status === 'pending') && (
                            <Button
                              size="sm"
                              className="h-6 gap-1 px-2 text-xs"
                              onClick={() => executeAll(msgIdx)}
                            >
                              <Play className="size-3" />
                              {t('Run all')}
                            </Button>
                          )}
                          {msg.actions.some((a) => a.status === 'done' || a.status === 'error') && (
                            <button
                              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                              onClick={() => resetAllActions(msgIdx)}
                            >
                              <RotateCcw className="size-3" />
                              {t('Reset all')}
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        {msg.actions.map((ar, aIdx) => (
                          <ActionCard
                            key={aIdx}
                            result={ar}
                            stepNumber={aIdx + 1}
                            onExecute={() => executeAction(msgIdx, aIdx)}
                            onUpdate={
                              ar.status === 'pending'
                                ? (action) => updateAction(msgIdx, aIdx, action)
                                : undefined
                            }
                            onDelete={
                              ar.status === 'pending' ? () => deleteAction(msgIdx, aIdx) : undefined
                            }
                            onReset={
                              ar.status === 'done' || ar.status === 'error'
                                ? () => resetActionsFrom(msgIdx, aIdx)
                                : undefined
                            }
                          />
                        ))}
                        <button
                          className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => addAction(msgIdx, (msg.actions?.length ?? 1) - 1)}
                        >
                          <Plus className="size-3" />
                          {t('Add action')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('Thinking...')}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="sticky bottom-0 border-t bg-background px-4 py-3">
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              placeholder={apiKey ? t('Ask the AI agent...') : t('Set OpenAI API key first')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
              disabled={loading}
            />
            <Button size="icon" onClick={sendMessage} disabled={loading || !input.trim()}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </SecondaryPageLayout>
  )
})
AIAgentPage.displayName = 'AIAgentPage'
export default AIAgentPage

// ── ActionCard ────────────────────────────────────────────────────────────────

const PROCESSING_OPERATIONS: TProcessingOperation[] = [
  'filter',
  'sort',
  'deduplicate',
  'top',
  'count',
  'summarize',
  'customScript'
]

function ActionCard({
  result,
  onExecute,
  onUpdate,
  onDelete,
  onReset
}: {
  result: TActionResult
  stepNumber: number
  onExecute: () => void
  onUpdate?: (action: TAction) => void
  onDelete?: () => void
  onReset?: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [editType, setEditType] = useState<'query' | 'process'>(result.action.type)
  const [editDesc, setEditDesc] = useState(result.action.description)
  const [editOp, setEditOp] = useState<TProcessingOperation>(
    result.action.type === 'process' ? result.action.operation : 'filter'
  )
  const [editData, setEditData] = useState(
    result.action.type === 'query'
      ? JSON.stringify(result.action.filter, null, 2)
      : JSON.stringify(result.action.params, null, 2)
  )
  const [dataError, setDataError] = useState('')
  const isQuery = result.action.type === 'query'
  const [showEvents, setShowEvents] = useState(!isQuery)
  const outputIsEvents =
    Array.isArray(result.output) && result.output.length > 0 && 'id' in (result.output[0] as any)
  const outputIsCounts =
    Array.isArray(result.output) && result.output.length > 0 && 'key' in (result.output[0] as any)
  const outputIsText = typeof result.output === 'string'

  const startEdit = () => {
    setEditType(result.action.type)
    setEditDesc(result.action.description)
    if (result.action.type === 'process') {
      setEditOp(result.action.operation)
      setEditData(JSON.stringify(result.action.params, null, 2))
    } else {
      setEditOp('filter')
      setEditData(JSON.stringify((result.action as TQueryAction).filter, null, 2))
    }
    setDataError('')
    setEditing(true)
  }

  const saveEdit = () => {
    let parsed: any
    try {
      parsed = editData.trim() ? JSON.parse(editData) : {}
    } catch {
      setDataError('Invalid JSON')
      return
    }
    const action: TAction =
      editType === 'query'
        ? { type: 'query', description: editDesc, filter: parsed, relays: [] }
        : { type: 'process', description: editDesc, operation: editOp, params: parsed }
    onUpdate?.(action)
    setEditing(false)
  }

  return (
    <div className="rounded-lg border bg-background">
      {editing ? (
        <div className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex gap-2">
            <select
              className="rounded border bg-muted/30 px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary"
              value={editType}
              onChange={(e) => {
                const type = e.target.value as 'query' | 'process'
                setEditType(type)
                setEditData(type === 'query' ? '{\n  "kinds": [1],\n  "limit": 20\n}' : '{}')
                setDataError('')
              }}
            >
              <option value="query">query</option>
              <option value="process">process</option>
            </select>
            {editType === 'process' && (
              <select
                className="rounded border bg-muted/30 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
                value={editOp}
                onChange={(e) => setEditOp(e.target.value as TProcessingOperation)}
              >
                {PROCESSING_OPERATIONS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
            )}
          </div>
          <input
            className="w-full rounded border bg-muted/30 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            placeholder="Description"
          />
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted-foreground">
              {editType === 'query' ? 'Filter (JSON)' : 'Params (JSON)'}
            </p>
            <textarea
              className="min-h-[60px] w-full rounded border bg-muted/30 px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-primary"
              value={editData}
              onChange={(e) => {
                setEditData(e.target.value)
                setDataError('')
              }}
              spellCheck={false}
            />
            {dataError && <p className="text-xs text-destructive">{dataError}</p>}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" className="h-6 px-2 text-xs" onClick={saveEdit}>
              {t('Save')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => setEditing(false)}
            >
              {t('Cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 px-3 py-2.5">
          <span
            className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
              isQuery
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
            }`}
          >
            {result.action.type}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{result.action.description}</p>
            {result.action.type === 'process' && (
              <p className="text-xs text-muted-foreground">
                {result.action.operation}
                {Object.keys(result.action.params).length > 0
                  ? ` · ${JSON.stringify(result.action.params)}`
                  : ''}
              </p>
            )}
            {result.status === 'error' && (
              <p className="mt-1 text-xs text-destructive">{result.error}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {result.status === 'pending' && onUpdate && (
              <button className="text-muted-foreground hover:text-foreground" onClick={startEdit}>
                <Pencil className="size-3.5" />
              </button>
            )}
            {result.status === 'pending' && onDelete && (
              <button className="text-muted-foreground hover:text-destructive" onClick={onDelete}>
                <X className="size-3.5" />
              </button>
            )}
            {result.status === 'pending' && (
              <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onExecute}>
                <Play className="mr-1 size-3" />
                {t('Run')}
              </Button>
            )}
            {result.status === 'running' && <Loader2 className="size-3.5 animate-spin text-primary" />}
            {(result.status === 'done' || result.status === 'error') && (
              <>
                {result.status === 'done' && <CheckCircle2 className="size-3.5 text-green-500" />}
                {result.status === 'error' && <XCircle className="size-3.5 text-destructive" />}
                {onReset && (
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={onReset}
                    title="Reset from here"
                  >
                    <RotateCcw className="size-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {result.status === 'done' && result.output !== null && (
        <div className="border-t px-3 py-2">
          {outputIsText && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{result.output as string}</p>
          )}
          {outputIsCounts && (
            <div className="flex flex-col gap-1">
              {(result.output as { key: string; count: number }[]).slice(0, 20).map((row, i) => (
                <div key={row.key} className="flex items-center gap-2 text-xs">
                  <span className="w-4 shrink-0 text-right text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">{row.key}</span>
                  <span className="shrink-0 font-semibold">{row.count}</span>
                </div>
              ))}
            </div>
          )}
          {outputIsEvents && (
            <div className="flex flex-col gap-1.5">
              <button
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowEvents((v) => !v)}
              >
                {showEvents ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                {(result.output as TNostrEvent[]).length} {t('events')}
              </button>
              {showEvents && (
                <div className="flex flex-col gap-1.5">
                  {(result.output as TNostrEvent[]).slice(0, 10).map((evt) => (
                    <div key={evt.id} className="rounded border bg-muted/30 px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2 text-muted-foreground">
                        <span>kind:{evt.kind}</span>
                        <span>{new Date(evt.created_at * 1000).toLocaleString()}</span>
                      </div>
                      <p className="mt-1 line-clamp-3 break-words">{evt.content || '(no content)'}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
