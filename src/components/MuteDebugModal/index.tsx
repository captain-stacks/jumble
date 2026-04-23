import UserItem from '@/components/UserItem'
import { Button } from '@/components/ui/button'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import bootstrapCache from '@/services/bootstrap-cache.service'
import { X } from 'lucide-react'
import { useState } from 'react'

export default function MuteDebugModal({ onClose }: { onClose: () => void }) {
  const { mutePubkeySet } = useMuteList()
  const { pubkey: currentPubkey } = useNostr()
  const { demandFetchCount, isWotReady, wotStep, inspectedPubkey, getTrustScore, getMuteRatio, isUserTrusted, getWotFollowers } = useUserTrust()
  const cachedMuteList = bootstrapCache.getMuteList()
  const cachedWoT = bootstrapCache.getWoT()
  const followSourcePubkey = import.meta.env.VITE_EASY_LOGIN_FOLLOW_SOURCE_PUBKEY as string | undefined

  const [tab, setTab] = useState<'debug' | 'progress'>('progress')

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
        <div className="flex gap-1 mb-4 border-b border-gray-200 dark:border-gray-700">
          {(['progress', 'debug'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-sm font-medium capitalize rounded-t transition-colors ${
                tab === t
                  ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t === 'progress' ? 'WoT Progress' : 'Debug Info'}
            </button>
          ))}
        </div>

        {tab === 'progress' && (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>WoT ready: {isWotReady ? '✅' : `⏳ step ${wotStep}`}</span>
              <span>On-demand queries: {demandFetchCount}</span>
            </div>

            {inspectedPubkey ? (() => {
              const score = getTrustScore(inspectedPubkey)
              const { follows, mutes } = getMuteRatio(inspectedPubkey)
              const inWot = isUserTrusted(inspectedPubkey)
              const wotFollowers = getWotFollowers(inspectedPubkey)
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
                  {wotFollowers.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
                        Followed by ({wotFollowers.length})
                      </div>
                      <div className="max-h-64 overflow-y-auto space-y-1">
                        {wotFollowers.map((pk) => (
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
