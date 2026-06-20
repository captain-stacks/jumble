import UserItem from '@/components/UserItem'
import { Button } from '@/components/ui/button'
import { getDefaultRelayUrls } from '@/lib/relay'
import { useMuteList } from '@/providers/MuteListProvider'
import client from '@/services/client.service'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import bootstrapCache from '@/services/bootstrap-cache.service'
import { Loader, X } from 'lucide-react'
import { Event, Filter, nip19, SimplePool } from 'nostr-tools'
import { useEffect, useMemo, useRef, useState } from 'react'

function toNpub(s: string): string {
  return /^[0-9a-f]{64}$/.test(s) ? nip19.npubEncode(s) : s
}

function transformFilter(filter: object): object {
  const f = filter as Record<string, unknown>
  const out: Record<string, unknown> = { ...f }
  if (Array.isArray(out.authors)) out.authors = (out.authors as string[]).map(toNpub)
  if (Array.isArray(out['#p'])) out['#p'] = (out['#p'] as string[]).map(toNpub)
  return out
}

export default function MuteDebugModal({ onClose }: { onClose: () => void }) {
  const { mutePubkeySet } = useMuteList()
  const { pubkey: currentPubkey } = useNostr()
  const { demandFetchCount, muteVersion, isWotReady, wotStep, wotSize, muteSetSize, inspectedPubkey, getTrustScore, getMuteRatio, isUserTrusted, getWotFollowers, getWotMuters, getWotInLists, fetchScoreForPubkey, refetchScoreForPubkey, downvotedFollowPacks, queryLog, queryLogVersion } = useUserTrust()
  const log = useMemo(() => queryLog, [queryLogVersion])
  const cachedMuteList = bootstrapCache.getMuteList()
  const cachedWoT = bootstrapCache.getWoT()
  const followSourcePubkey = import.meta.env.VITE_EASY_LOGIN_FOLLOW_SOURCE_PUBKEY as string | undefined

  const [tab, setTab] = useState<'debug' | 'progress' | 'packs' | 'log' | 'query'>('progress')
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null)
  const [expandedPack, setExpandedPack] = useState<string | null>(null)
  const [listTab, setListTab] = useState<'followers' | 'muters' | 'inlists'>('followers')
  const [queryText, setQueryText] = useState('{\n  "kinds": [1],\n  "limit": 10\n}')
  const [queryResults, setQueryResults] = useState<Event[] | null>(null)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [queryRunning, setQueryRunning] = useState(false)
  const [expandedResultIndex, setExpandedResultIndex] = useState<number | null>(null)
  const queryPoolRef = useRef<SimplePool | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    if (inspectedPubkey) fetchScoreForPubkey(inspectedPubkey, true)
  }, [inspectedPubkey, fetchScoreForPubkey, muteVersion])

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">🐛 Mute Debug Info</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded">
            <X size={20} />
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700 flex-wrap">
          {(['progress', 'packs', 'log', 'query', 'debug'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium capitalize rounded-t transition-colors ${
                tab === t
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t === 'progress' ? 'WoT Progress' : t === 'packs' ? `👎 Packs (${downvotedFollowPacks.length})` : t === 'log' ? `Query Log (${log.length})` : t === 'query' ? 'Query' : 'Debug Info'}
            </button>
          ))}
        </div>

        {tab === 'progress' && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <div className="flex items-center gap-3">
                <span>WoT ready: {isWotReady ? '✅' : `⏳ step ${wotStep}`}</span>
                <span>WoT: {wotSize.toLocaleString()} · Muted: {muteSetSize.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-3">
                <span>On-demand queries: {demandFetchCount} · mute v{muteVersion}</span>
                {inspectedPubkey && (
                  <button
                    onClick={() => refetchScoreForPubkey(inspectedPubkey, true)}
                    className="text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                  >
                    ↺ Reload lists
                  </button>
                )}
              </div>
            </div>

            {inspectedPubkey ? (() => {
              const score = getTrustScore(inspectedPubkey)
              const { follows, mutes } = getMuteRatio(inspectedPubkey)
              const inWot = isUserTrusted(inspectedPubkey)
              const wotFollowers = getWotFollowers(inspectedPubkey)
              const wotMuters = getWotMuters(inspectedPubkey)
              const wotInLists = getWotInLists(inspectedPubkey)
              return (
                <div className="space-y-3">
                  <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded text-xs space-y-2">
                    <div className="font-semibold text-gray-700 dark:text-gray-300">Inspected profile</div>
                    <div className="font-mono break-all text-gray-500 dark:text-gray-400">{inspectedPubkey}</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <span className="text-gray-500 dark:text-gray-400">Trust score</span>
                      <span className="font-mono font-medium">{score}</span>
                      <span className="text-gray-500 dark:text-gray-400">In WoT</span>
                      <span className="font-mono">{inWot ? '✅' : '❌'}</span>
                      <span className="text-gray-500 dark:text-gray-400">WoT follows</span>
                      <span className="font-mono">{follows}</span>
                      <span className="text-gray-500 dark:text-gray-400">WoT mutes</span>
                      <span className="font-mono">{mutes}</span>
                    </div>
                  </div>
                  {(wotFollowers.length > 0 || wotMuters.length > 0 || wotInLists.length > 0) && (
                    <div>
                      <div className="flex gap-1 mb-2 border-b border-gray-200 dark:border-gray-700">
                        <button
                          onClick={() => setListTab('followers')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${listTab === 'followers' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                        >
                          Followed by ({wotFollowers.length})
                        </button>
                        <button
                          onClick={() => setListTab('muters')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${listTab === 'muters' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                        >
                          Muted by ({wotMuters.length})
                        </button>
                        <button
                          onClick={() => setListTab('inlists')}
                          className={`px-3 py-1.5 text-xs font-medium rounded-t transition-colors ${listTab === 'inlists' ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
                        >
                          In Lists ({wotInLists.length})
                        </button>
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {(listTab === 'followers' ? wotFollowers : listTab === 'muters' ? wotMuters : wotInLists).map((pk) => (
                          <UserItem key={pk} userId={pk} hideFollowButton />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })() : (
              <div className="text-xs text-gray-400 dark:text-gray-500 italic">
                Open a profile to see its mute query info here.
              </div>
            )}
          </div>
        )}

        {tab === 'packs' && (
          <div className="space-y-2 text-sm">
            {downvotedFollowPacks.length === 0 ? (
              <div className="text-xs text-gray-400 dark:text-gray-500 italic">
                No 👎'd follow packs found.
              </div>
            ) : (
              downvotedFollowPacks.map((pack) => (
                <div key={pack.addr} className="border border-gray-200 dark:border-gray-700 rounded">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => setExpandedPack(expandedPack === pack.addr ? null : pack.addr)}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-sm">{pack.title}</span>
                      <span className="block font-mono text-[10px] text-gray-400 dark:text-gray-500 truncate">{pack.addr}</span>
                    </span>
                    <span className="shrink-0 ml-2 text-xs text-gray-500">{pack.pubkeys.length} members {expandedPack === pack.addr ? '▲' : '▼'}</span>
                  </button>
                  {expandedPack === pack.addr && (
                    <div className="max-h-48 overflow-y-auto border-t border-gray-200 dark:border-gray-700">
                      {pack.pubkeys.map((pk) => (
                        <UserItem key={pk} userId={pk} hideFollowButton />
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'log' && (
          <div className="text-xs font-mono">
            {log.length === 0 ? (
              <div className="text-gray-400 dark:text-gray-500 italic">No queries yet.</div>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto">
                {log.map((entry, i) => (
                  <div key={i} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                    <button
                      className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${entry.error ? 'text-red-600 dark:text-red-400' : ''}`}
                      onClick={() => setExpandedLogIndex(expandedLogIndex === i ? null : i)}
                    >
                      <span className={`shrink-0 px-1 rounded text-[10px] font-semibold ${entry.source === 'wot' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400'}`}>
                        {entry.source}
                      </span>
                      <span className="text-gray-500 dark:text-gray-400 shrink-0 truncate max-w-[120px]">{toNpub(entry.pubkey)}</span>
                      <span className="shrink-0">{entry.eventCount} events</span>
                      {entry.error && <span className="truncate text-red-500">{entry.error}</span>}
                      <span className="ml-auto shrink-0 text-gray-400">{expandedLogIndex === i ? '▲' : '▼'}</span>
                    </button>
                    {expandedLogIndex === i && (
                      <div className="px-2 pb-2 space-y-2">
                        {entry.relays && (
                          <div>
                            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Relays</div>
                            <pre className="bg-gray-100 dark:bg-gray-800 rounded p-2 text-[10px] overflow-x-auto whitespace-pre-wrap break-all">
                              {entry.relays.join('\n')}
                            </pre>
                          </div>
                        )}
                        {entry.filter && (
                          <div>
                            <div className="text-[10px] font-semibold text-gray-400 uppercase mb-0.5">Filter</div>
                            <pre className="bg-gray-100 dark:bg-gray-800 rounded p-2 text-[10px] overflow-x-auto whitespace-pre-wrap">
                              {JSON.stringify(transformFilter(entry.filter), null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'query' && (
          <QueryTab
            queryText={queryText}
            setQueryText={setQueryText}
            queryResults={queryResults}
            setQueryResults={setQueryResults}
            queryError={queryError}
            setQueryError={setQueryError}
            queryRunning={queryRunning}
            setQueryRunning={setQueryRunning}
            expandedResultIndex={expandedResultIndex}
            setExpandedResultIndex={setExpandedResultIndex}
            queryPoolRef={queryPoolRef}
          />
        )}

        {tab === 'debug' && (
          <div className="space-y-4 text-sm">
            <div className="bg-red-50 dark:bg-red-900/20 p-3 rounded border border-red-200 dark:border-red-800">
              <h3 className="font-semibold mb-2">⚠️ Environment Config</h3>
              <div className="space-y-1 font-mono text-xs">
                <div>VITE_EASY_LOGIN_FOLLOW_SOURCE_PUBKEY:
                  <br />
                  {followSourcePubkey ? (
                    <span className="text-green-600 dark:text-green-400 break-all">{followSourcePubkey}</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">❌ NOT SET</span>
                  )}
                </div>
                <div>currentPubkey (logged in): {currentPubkey ? currentPubkey.slice(0, 16) + '...' : '❌ NOT LOGGED IN'}</div>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded border border-blue-200 dark:border-blue-800">
              <h3 className="font-semibold mb-2">Steps to Debug</h3>
              <ol className="space-y-1 text-xs list-decimal list-inside">
                <li>Check if FOLLOW_SOURCE_PUBKEY is set above ✓</li>
                <li>Open browser DevTools (F12) → Console</li>
                <li>Look for logs starting with [buildWoT], [buildMuteList], [BootstrapCache], [MuteListProvider]</li>
                <li>Check if step 1 and 2 are being called in buildWoT</li>
                <li>Check if relays are connecting (look for Nostr client logs)</li>
              </ol>
            </div>

            <div>
              <h3 className="font-semibold mb-2">
                mutePubkeySet (from MuteListProvider): {mutePubkeySet.size} users
              </h3>
              <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded max-h-32 overflow-auto font-mono text-xs">
                {mutePubkeySet.size === 0 ? (
                  <span className="text-gray-500">Empty</span>
                ) : (
                  Array.from(mutePubkeySet)
                    .slice(0, 10)
                    .map((pk) => <div key={pk}>{pk.slice(0, 16)}...</div>)
                )}
                {mutePubkeySet.size > 10 && <div className="text-gray-500">+{mutePubkeySet.size - 10} more</div>}
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">
                cachedMuteList (from bootstrapCache): {cachedMuteList?.length ?? 0} users
              </h3>
              <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded max-h-32 overflow-auto font-mono text-xs">
                {!cachedMuteList || cachedMuteList.length === 0 ? (
                  <span className="text-gray-500">Empty/Not cached</span>
                ) : (
                  cachedMuteList
                    .slice(0, 10)
                    .map((pk) => <div key={pk}>{pk.slice(0, 16)}...</div>)
                )}
                {cachedMuteList && cachedMuteList.length > 10 && (
                  <div className="text-gray-500">+{cachedMuteList.length - 10} more</div>
                )}
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">
                cachedWoT (from bootstrapCache): {cachedWoT?.length ?? 0} users
              </h3>
              <div className="bg-gray-100 dark:bg-gray-800 p-2 rounded max-h-32 overflow-auto font-mono text-xs">
                {!cachedWoT || cachedWoT.length === 0 ? (
                  <span className="text-gray-500">Empty/Not cached</span>
                ) : (
                  cachedWoT
                    .slice(0, 10)
                    .map((pk) => <div key={pk}>{pk.slice(0, 16)}...</div>)
                )}
                {cachedWoT && cachedWoT.length > 10 && (
                  <div className="text-gray-500">+{cachedWoT.length - 10} more</div>
                )}
              </div>
            </div>
          </div>
        )}

        <Button onClick={onClose} className="mt-4 w-full">
          Close
        </Button>
      </div>
    </div>
  )
}

function QueryTab({
  queryText, setQueryText,
  queryResults, setQueryResults,
  queryError, setQueryError,
  queryRunning, setQueryRunning,
  expandedResultIndex, setExpandedResultIndex,
  queryPoolRef
}: {
  queryText: string
  setQueryText: (v: string) => void
  queryResults: Event[] | null
  setQueryResults: (v: Event[] | null) => void
  queryError: string | null
  setQueryError: (v: string | null) => void
  queryRunning: boolean
  setQueryRunning: (v: boolean) => void
  expandedResultIndex: number | null
  setExpandedResultIndex: (v: number | null) => void
  queryPoolRef: React.MutableRefObject<SimplePool | null>
}) {
  const [authorPubkey, setAuthorPubkey] = useState('')
  const [resolvedRelays, setResolvedRelays] = useState<string[]>(getDefaultRelayUrls())
  const [resolvingRelays, setResolvingRelays] = useState(false)

  const resolveRelays = async (raw: string) => {
    const hex = raw.trim()
    if (!hex) {
      setResolvedRelays(getDefaultRelayUrls())
      return
    }
    setResolvingRelays(true)
    try {
      const relayList = await client.fetchRelayList(hex)
      setResolvedRelays(relayList.read.concat(getDefaultRelayUrls()).slice(0, 5))
    } catch {
      setResolvedRelays(getDefaultRelayUrls())
    } finally {
      setResolvingRelays(false)
    }
  }

  const runQuery = async () => {
    setQueryError(null)
    setQueryResults(null)
    setExpandedResultIndex(null)
    let filter: Filter
    try {
      filter = JSON.parse(queryText)
    } catch (e) {
      setQueryError(`Invalid JSON: ${(e as Error).message}`)
      return
    }
    setQueryRunning(true)
    try {
      if (queryPoolRef.current) queryPoolRef.current.destroy()
      queryPoolRef.current = new SimplePool()
      const events = await queryPoolRef.current.querySync(resolvedRelays, filter)
      events.sort((a, b) => b.created_at - a.created_at)
      setQueryResults(events)
    } catch (e) {
      setQueryError(String(e))
    } finally {
      setQueryRunning(false)
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
          Author pubkey (hex) — resolves their read relays + defaults, capped at 5
        </label>
        <input
          className="w-full rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-3 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="leave empty to use default relays"
          value={authorPubkey}
          onChange={(e) => setAuthorPubkey(e.target.value)}
          onBlur={(e) => resolveRelays(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400">
        {resolvingRelays ? 'Resolving relays…' : <>Relays: {resolvedRelays.join(', ')}</>}
      </div>

      <textarea
        className="w-full h-32 rounded border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        value={queryText}
        onChange={(e) => setQueryText(e.target.value)}
        spellCheck={false}
      />

      <Button
        onClick={runQuery}
        disabled={queryRunning}
        className="w-full gap-2"
      >
        {queryRunning && <Loader className="h-4 w-4 animate-spin" />}
        {queryRunning ? 'Running…' : 'Run Query'}
      </Button>

      {queryError && (
        <div className="rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-600 dark:text-red-400 font-mono">
          {queryError}
        </div>
      )}

      {queryResults !== null && (
        <div>
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {queryResults.length} event{queryResults.length !== 1 ? 's' : ''} returned
          </div>
          <div className="max-h-[40vh] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded font-mono text-xs">
            {queryResults.length === 0 ? (
              <div className="px-3 py-4 text-gray-400 dark:text-gray-500 italic text-center">No events</div>
            ) : (
              queryResults.map((evt, i) => (
                <div key={evt.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => setExpandedResultIndex(expandedResultIndex === i ? null : i)}
                  >
                    <span className="shrink-0 text-[10px] px-1 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                      k{evt.kind}
                    </span>
                    <span className="truncate text-gray-500 dark:text-gray-400">
                      {toNpub(evt.pubkey).slice(0, 20)}…
                    </span>
                    <span className="shrink-0 text-gray-400 dark:text-gray-500">
                      {new Date(evt.created_at * 1000).toLocaleString()}
                    </span>
                    <span className="ml-auto shrink-0 text-gray-400">{expandedResultIndex === i ? '▲' : '▼'}</span>
                  </button>
                  {expandedResultIndex === i && (
                    <pre className="px-3 pb-3 overflow-x-auto text-[10px] bg-gray-50 dark:bg-gray-900 whitespace-pre-wrap break-all">
                      {JSON.stringify(evt, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
