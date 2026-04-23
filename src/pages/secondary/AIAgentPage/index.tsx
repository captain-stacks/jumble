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
  Square,
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
  isSynthesis?: boolean
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

Process action — transforms data sequentially (each step receives the previous step's output):
- "filter": { "field": "content"|"pubkey"|"kind", "contains": "string" } or { "field": "pubkey"|"kind", "equals": value }
- "sort": { "field": "created_at"|"content", "order": "asc"|"desc" }
- "deduplicate": { "field": "pubkey"|"id" }
- "top": { "n": number }
- "count": { "groupBy": "pubkey"|"kind" }
- "summarize": {} — AI-generated natural language summary
- "customScript": { "code": "(data) => { /* JS arrow fn or function expr */ return processedData }" }

Design the full plan in one response. If no actions needed, return "actions": [].
Respond ONLY with valid JSON.`

// ── JSON extraction helper ────────────────────────────────────────────────────

function extractJSON(raw: string): string {
  // Strip markdown code fences: ```json ... ``` or ``` ... ```
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  // Find first { ... } block in case of leading/trailing prose
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1)
  return raw.trim()
}

// ── OpenAI helper ─────────────────────────────────────────────────────────────

async function callOpenAI(
  apiKey: string,
  messages: { role: string; content: string }[],
  signal?: AbortSignal
) {
  const body = { model: 'gpt-5', messages }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`)
  const response = await res.json()
  return { request: body, response }
}

// ── Relay fetch with timeout ──────────────────────────────────────────────────

function fetchWithTimeout(relays: string[], filter: Filter, ms = 15_000): Promise<any[]> {
  return Promise.race([
    client.fetchEvents(relays, filter),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Relay query timed out after ${ms / 1000}s`)), ms)
    )
  ])
}

// ── Build conversation history ────────────────────────────────────────────────

function buildHistory(
  msgs: TMessage[],
  localResults?: Map<number, TActionResult['output']>,
  msgIndex?: number
): { role: string; content: string }[] {
  return msgs.flatMap((m, mi) => {
    if (m.role === 'user') return [{ role: 'user', content: m.content }]
    if (m.role === 'assistant') {
      let text = m.content
      try {
        text = JSON.parse(m.content).message ?? m.content
      } catch { /* use raw */ }

      const actions = m.actions ?? []
      if (actions.length > 0) {
        const isSynthesisMsg = mi === msgIndex && localResults !== undefined
        const summary = actions
          .map((a, ai) => {
            const label = `[${a.action.type}] ${a.action.description}`
            const output = isSynthesisMsg ? localResults!.get(ai) : a.output
            const status = isSynthesisMsg
              ? (localResults!.has(ai) ? 'done' : a.status)
              : a.status

            if (status === 'done' && output !== null) {
              if (typeof output === 'string') {
                return `${label}:\n${output.slice(0, 800)}`
              }
              if (Array.isArray(output) && output.length > 0) {
                if ('key' in (output[0] as any)) {
                  // count output — include full list up to 50
                  return `${label} (${output.length} groups):\n${JSON.stringify(output.slice(0, 50))}`
                }
                if ('id' in (output[0] as any)) {
                  // events — include meaningful sample
                  const sample = (output as TNostrEvent[]).slice(0, 20).map((e) => ({
                    kind: e.kind,
                    pubkey: e.pubkey.slice(0, 12) + '…',
                    content: e.content.slice(0, 250),
                    created_at: new Date(e.created_at * 1000).toISOString()
                  }))
                  return `${label} (${output.length} events):\n${JSON.stringify(sample, null, 2)}`
                }
              }
              if (Array.isArray(output) && output.length === 0) {
                return `${label}: 0 results`
              }
            }
            if (status === 'error') return `${label}: ERROR — ${(a as any).error ?? 'unknown'}`
            return `${label}: ${status}`
          })
          .join('\n\n')
        text = `${text}\n\nAction results:\n${summary}`
      }
      return [{ role: 'assistant', content: text }]
    }
    return []
  })
}

// ── Replaceable event deduplication ──────────────────────────────────────────

function deduplicateReplaceableEvents(events: TNostrEvent[]): TNostrEvent[] {
  const isReplaceable = (kind: number) =>
    kind === 0 || kind === 3 || (kind >= 10000 && kind < 20000)
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
    return events.filter((e) => {
      const val = (e as any)[params.field] ?? ''
      if (params.contains !== undefined)
        return String(val).toLowerCase().includes(String(params.contains).toLowerCase())
      if (params.equals !== undefined) return val === params.equals
      return true
    })
  }
  if (operation === 'sort') {
    return [...events].sort((a, b) => {
      const av = (a as any)[params.field] ?? ''
      const bv = (b as any)[params.field] ?? ''
      return params.order === 'asc' ? (av > bv ? 1 : -1) : av < bv ? 1 : -1
    })
  }
  if (operation === 'deduplicate') {
    const seen = new Set()
    return events.filter((e) => {
      const key = (e as any)[params.field]
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }
  if (operation === 'top') {
    return events.slice(0, params.n ?? 10)
  }
  if (operation === 'count') {
    const counts: Record<string, number> = {}
    events.forEach((e) => {
      const key = String((e as any)[params.groupBy] ?? 'unknown')
      counts[key] = (counts[key] ?? 0) + 1
    })
    return Object.entries(counts)
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
  }
  if (operation === 'summarize') {
    const sample = events.slice(0, 50).map((e) => ({
      kind: e.kind,
      content: e.content.slice(0, 300),
      created_at: new Date(e.created_at * 1000).toISOString()
    }))
    const result = await callOpenAI(
      apiKey,
      [
        {
          role: 'system',
          content:
            'You are a Nostr data analyst. Summarize the events concisely to answer the user question.'
        },
        {
          role: 'user',
          content: `Question: "${question}"\n\nEvents (${events.length} total, sample of up to 50):\n${JSON.stringify(sample, null, 2)}\n\nProvide a clear answer.`
        }
      ]
    )
    return result.response.choices[0].message.content as string
  }
  if (operation === 'customScript') {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./ai-agent.worker.ts', import.meta.url), {
        type: 'module'
      })
      const timer = setTimeout(() => {
        worker.terminate()
        reject(new Error('customScript worker timed out'))
      }, 12_000)
      worker.onmessage = (e) => {
        clearTimeout(timer)
        worker.terminate()
        if (e.data.error) reject(new Error(e.data.error))
        else resolve(e.data.results)
      }
      worker.onerror = (e) => {
        clearTimeout(timer)
        worker.terminate()
        reject(new Error(`Worker error: ${e.message}`))
      }
      worker.postMessage({ code: params.code, data: events })
    })
  }
  return events
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
  const [synthesizing, setSynthesizing] = useState(false)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openai_api_key') ?? '')
  const bottomRef = useRef<HTMLDivElement>(null)
  const messagesRef = useRef(messages)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    return openaiService.subscribe(() => {
      setApiKey(localStorage.getItem('openai_api_key') ?? '')
    })
  }, [])

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
    } catch { /* storage unavailable */ }
  }, [messages])

  const scrollToBottom = () =>
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)

const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
    setSynthesizing(false)
  }

  // ── Low-level action executor ────────────────────────────────────────────────
  // Returns the output, updates UI state. Always receives action and input directly.

  const runAction = async (
    msgIndex: number,
    actionIndex: number,
    action: TAction,
    inputOverride: TNostrEvent[],
    question: string,
    signal: AbortSignal
  ): Promise<TActionResult['output']> => {
    if (signal.aborted) throw new Error('Aborted')

    // Mark running
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
        if (signal.aborted) throw new Error('Aborted')
        const relays = action.relays?.length ? action.relays : getDefaultRelayUrls()
        const rawEvents = await fetchWithTimeout(relays, action.filter)
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
        if (signal.aborted) throw new Error('Aborted')
        output = await runProcessStep(action, inputOverride, apiKey, question)
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
      if (e.message === 'Aborted' || signal.aborted) throw e
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

  // ── Run full plan: queries in parallel, process steps sequentially ────────────

  const runPlan = async (
    msgIndex: number,
    actions: TActionResult[],
    question: string,
    signal: AbortSignal
  ): Promise<Map<number, TActionResult['output']>> => {
    const results = new Map<number, TActionResult['output']>()

    // Queries in parallel
    await Promise.all(
      actions.map(async (ar, i) => {
        if (ar.action.type !== 'query') return
        const out = await runAction(msgIndex, i, ar.action, [], question, signal)
        results.set(i, out)
      })
    )

    if (signal.aborted) throw new Error('Aborted')

    // Process steps sequentially, chaining data
    let processInput: TNostrEvent[] = []
    for (const [, out] of results) {
      if (Array.isArray(out) && out.length > 0 && 'id' in (out[0] as any)) {
        processInput.push(...(out as TNostrEvent[]))
      }
    }

    for (let i = 0; i < actions.length; i++) {
      if (actions[i].action.type !== 'process') continue
      if (signal.aborted) throw new Error('Aborted')
      const out = await runAction(msgIndex, i, actions[i].action, processInput, question, signal)
      results.set(i, out)
      if (Array.isArray(out) && out.length > 0 && 'id' in (out[0] as any)) {
        processInput = out as TNostrEvent[]
      } else if (Array.isArray(out) && out.length === 0) {
        processInput = []
      }
    }

    return results
  }

  // ── Synthesis: send results back to AI for final answer ──────────────────────

  const synthesize = async (
    priorMessages: TMessage[],
    msgIndex: number,
    localResults: Map<number, TActionResult['output']>,
    iteration: number,
    signal: AbortSignal
  ) => {
    if (signal.aborted) return

    setSynthesizing(true)
    try {
      const history = buildHistory(priorMessages, localResults, msgIndex)
      const { request, response } = await callOpenAI(
        apiKey,
        [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          {
            role: 'user',
            content:
              'Based on the action results above, write a clear answer to the user\'s question in plain conversational text. Do NOT respond with JSON. If the data is insufficient to answer, say so and explain what was found.'
          }
        ],
        signal
      )

      if (signal.aborted) return

      const raw: string = response.choices[0]?.message?.content ?? ''

      // Check if AI still returned JSON (requesting more actions)
      let newActions: TAction[] = []
      try {
        const parsed = JSON.parse(extractJSON(raw))
        newActions = parsed?.actions?.filter(Boolean) ?? []
      } catch { /* plain text — no more actions */ }

      const synthMsg: TMessage = {
        role: 'assistant',
        content: newActions.length > 0 ? raw : raw,
        isSynthesis: newActions.length === 0,
        actions: newActions.length > 0
          ? newActions.map((a) => ({ action: a, output: null, status: 'pending' }))
          : undefined,
        request,
        response
      }

      setMessages((prev) => [...prev, synthMsg])
      scrollToBottom()

      // Agentic loop: if AI wants more data, execute again (max 3 iterations)
      if (newActions.length > 0 && iteration < 2 && !signal.aborted) {
        // Give React a tick to update messagesRef
        await new Promise((r) => setTimeout(r, 50))
        const nextMsgIndex = messagesRef.current.length - 1
        const question =
          priorMessages
            .slice()
            .reverse()
            .find((m) => m.role === 'user')?.content ?? ''
        const nextResults = await runPlan(nextMsgIndex, synthMsg.actions!, question, signal)
        await synthesize(messagesRef.current, nextMsgIndex, nextResults, iteration + 1, signal)
      }
    } catch (e: any) {
      if (!signal.aborted) {
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: `Synthesis error: ${e.message}` }
        ])
      }
    } finally {
      setSynthesizing(false)
    }
  }

  // ── Main send ────────────────────────────────────────────────────────────────

  const sendMessage = async () => {
    const text = input.trim()
    if (!text || loading || synthesizing) return
    if (!apiKey) return

    const userMsg: TMessage = { role: 'user', content: text }
    const history = [...messagesRef.current, userMsg]
    setMessages(history)
    messagesRef.current = history
    setInput('')
    setLoading(true)
    scrollToBottom()

    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller

    try {
      const { request, response } = await callOpenAI(
        apiKey,
        [{ role: 'system', content: SYSTEM_PROMPT }, ...buildHistory(history)],
        signal
      )
      if (signal.aborted) return

      const raw: string = response.choices[0]?.message?.content ?? ''
      let parsed: { message: string; actions: TAction[] }
      try {
        parsed = JSON.parse(extractJSON(raw))
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

      const withAssistant = [...history, assistantMsg]
      setMessages(withAssistant)
      messagesRef.current = withAssistant
      scrollToBottom()

      const msgIndex = withAssistant.length - 1

      if ((parsed.actions ?? []).length > 0 && !signal.aborted) {
        const localResults = await runPlan(msgIndex, assistantMsg.actions!, text, signal)
        if (!signal.aborted) {
          await synthesize(messagesRef.current, msgIndex, localResults, 0, signal)
        }
      }
    } catch (e: any) {
      if (!signal.aborted) {
        setMessages((prev) => [
          ...prev,
          { role: 'system', content: `Error: ${e.message}` }
        ])
      }
    } finally {
      setLoading(false)
      setSynthesizing(false)
      if (abortRef.current === controller) abortRef.current = null
      scrollToBottom()
    }
  }

  // ── Manual re-run (for already-shown messages) ───────────────────────────────

  const executeAll = async (msgIndex: number) => {
    const msg = messagesRef.current[msgIndex]
    const question =
      messagesRef.current
        .slice(0, msgIndex)
        .reverse()
        .find((m) => m.role === 'user')?.content ?? ''

    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    try {
      const localResults = await runPlan(msgIndex, msg.actions ?? [], question, controller.signal)
      if (!controller.signal.aborted) {
        await synthesize(messagesRef.current, msgIndex, localResults, 0, controller.signal)
      }
    } finally {
      setLoading(false)
      setSynthesizing(false)
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const executeAction = async (msgIndex: number, actionIndex: number) => {
    const msg = messagesRef.current[msgIndex]
    const ar = msg.actions![actionIndex]
    const question =
      messagesRef.current
        .slice(0, msgIndex)
        .reverse()
        .find((m) => m.role === 'user')?.content ?? ''

    // Collect previous step output for process actions
    let inputEvents: TNostrEvent[] = []
    if (ar.action.type === 'process') {
      const prevActions = msg.actions ?? []
      for (let i = actionIndex - 1; i >= 0; i--) {
        const prev = prevActions[i]
        if (prev.status === 'done' && Array.isArray(prev.output) && prev.output.length > 0 && 'id' in (prev.output[0] as any)) {
          inputEvents = prev.output as TNostrEvent[]
          break
        }
      }
      if (inputEvents.length === 0) {
        inputEvents = (msg.actions ?? [])
          .filter((a) => a.action.type === 'query' && a.status === 'done' && Array.isArray(a.output))
          .flatMap((a) => a.output as TNostrEvent[])
      }
    }

    const controller = new AbortController()
    abortRef.current = controller
    await runAction(msgIndex, actionIndex, ar.action, inputEvents, question, controller.signal)
    if (abortRef.current === controller) abortRef.current = null
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

  const isRunning = loading || synthesizing

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('AI Agent')}>
      <div className="flex flex-col gap-0">
        {/* Toolbar */}
        <div className="flex items-center justify-end border-b px-4 py-2">
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => setMessages([])}
          >
            <Trash2 className="size-3.5" />
            {t('Clear history')}
          </button>
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

              {msg.role === 'assistant' && msg.isSynthesis && (
                <div className="flex gap-2">
                  <Bot className="mt-1 size-4 shrink-0 text-primary" />
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              )}

              {msg.role === 'assistant' && !msg.isSynthesis && (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <Bot className="mt-0.5 size-4 shrink-0 text-primary" />
                    <p className="text-sm text-muted-foreground">
                      {(() => {
                        try {
                          return JSON.parse(msg.content).message ?? msg.content
                        } catch {
                          return msg.content
                        }
                      })()}
                    </p>
                  </div>

                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t('Actions')}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {msg.actions.some((a) => a.status === 'pending') && !isRunning && (
                            <Button
                              size="sm"
                              className="h-6 gap-1 px-2 text-xs"
                              onClick={() => executeAll(msgIdx)}
                            >
                              <Play className="size-3" />
                              {t('Run all')}
                            </Button>
                          )}
                          {msg.actions.some((a) => a.status === 'done' || a.status === 'error') && !isRunning && (
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
                              ar.status === 'pending' && !isRunning
                                ? (action) => updateAction(msgIdx, aIdx, action)
                                : undefined
                            }
                            onDelete={
                              ar.status === 'pending' && !isRunning
                                ? () => deleteAction(msgIdx, aIdx)
                                : undefined
                            }
                            onReset={
                              (ar.status === 'done' || ar.status === 'error') && !isRunning
                                ? () => resetActionsFrom(msgIdx, aIdx)
                                : undefined
                            }
                          />
                        ))}
                        {!isRunning && (
                          <button
                            className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => addAction(msgIdx, (msg.actions?.length ?? 1) - 1)}
                          >
                            <Plus className="size-3" />
                            {t('Add action')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {loading && !synthesizing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('Thinking...')}
            </div>
          )}

          {synthesizing && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('Synthesizing results...')}
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
              disabled={isRunning}
            />
            {isRunning ? (
              <Button size="icon" variant="outline" onClick={stop} title={t('Stop')}>
                <Square className="size-4" />
              </Button>
            ) : (
              <Button size="icon" onClick={sendMessage} disabled={!input.trim()}>
                <Send className="size-4" />
              </Button>
            )}
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
    Array.isArray(result.output) &&
    result.output.length > 0 &&
    'key' in (result.output[0] as any)
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
            {result.status === 'running' && (
              <Loader2 className="size-3.5 animate-spin text-primary" />
            )}
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
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {result.output as string}
            </p>
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
                      <p className="mt-1 line-clamp-3 break-words">
                        {evt.content || '(no content)'}
                      </p>
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
