import { MarmotClient, KeyValueGroupStateBackend, KeyPackageStore, createKeyPackageRelayListEvent } from '@internet-privacy/marmot-ts'
import type { NostrNetworkInterface } from '@internet-privacy/marmot-ts'
import { getKeyPackageRelayList } from '@internet-privacy/marmot-ts'
import { GroupHistoryRegistry } from '@/services/marmot-history.service'
import type { GroupHistory } from '@/services/marmot-history.service'
import { RelayPool } from 'applesauce-relay'
import localforage from 'localforage'
import { filter, lastValueFrom, toArray } from 'rxjs'
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { getDefaultRelayUrls } from '@/lib/relay'
import type { NostrEvent } from 'applesauce-core/helpers/event'

type TMarmotContext = {
  marmotClient: MarmotClient<GroupHistory> | null
  isReady: boolean
  getHistory: (groupIdHex: string) => GroupHistory | null
}

const MarmotContext = createContext<TMarmotContext | undefined>(undefined)

export function useMarmot() {
  const ctx = useContext(MarmotContext)
  if (!ctx) throw new Error('useMarmot must be used within MarmotProvider')
  return ctx
}


/** Build a NostrNetworkInterface backed by a dedicated applesauce RelayPool */
function buildNetworkInterface(pool: RelayPool): NostrNetworkInterface {
  return {
    request: async (relays, filters) => {
      const obs = pool.request(relays, Array.isArray(filters) ? filters : [filters])
      return lastValueFrom(obs.pipe(toArray()), { defaultValue: [] as NostrEvent[] })
    },

    subscription: (relays, filters) => {
      // RelayPool.subscription returns Observable<NostrEvent | "EOSE">
      // We filter out EOSE and return a Subscribable<NostrEvent>
      const obs = pool
        .subscription(relays, Array.isArray(filters) ? filters : [filters])
        .pipe(filter((e): e is NostrEvent => e !== 'EOSE'))
      return obs
    },

    publish: async (relays, event) => {
      const results = await pool.publish(relays, event)
      const map: Record<string, { from: string; ok: boolean; message?: string }> = {}
      for (const r of results) {
        map[r.from] = r
      }
      return map
    },

    getUserInboxRelays: async (pubkey) => {
      const defaultRelays = getDefaultRelayUrls()
      try {
        const relayList = await client.fetchRelayList(pubkey)
        const lookupRelays = relayList.write.slice(0, 4).concat(defaultRelays)
        const events = await client.fetchEvents(lookupRelays, {
          kinds: [10051],
          authors: [pubkey],
          limit: 1,
        })
        if (events.length > 0) {
          const urls = getKeyPackageRelayList(events[0] as NostrEvent)
          if (urls.length > 0) return urls
        }
      } catch {
        // fall through to defaults
      }
      return defaultRelays.slice(0, 2)
    },
  }
}

async function ensureMarmotRegistration(
  pubkey: string,
  mc: MarmotClient<GroupHistory>,
  network: NostrNetworkInterface,
  signEvent: (draft: { kind: number; tags: string[][]; content: string; created_at: number }) => Promise<NostrEvent>
): Promise<void> {
  try {
    const defaultRelays = getDefaultRelayUrls()
    let writeRelays: string[] = defaultRelays.slice(0, 2)
    try {
      const relayList = await client.fetchRelayList(pubkey)
      if (relayList.write.length > 0) {
        writeRelays = relayList.write.slice(0, 4)
      }
    } catch {
      // use defaults
    }

    const checkRelays = Array.from(new Set([...writeRelays, ...defaultRelays]))

    // Check for existing kind 10051 (key package relay list)
    const existing10051 = await client.fetchEvents(checkRelays, {
      kinds: [10051],
      authors: [pubkey],
      limit: 1,
    })

    // Determine which relays to check for kind 443
    let kpRelays: string[] = writeRelays
    if (existing10051.length > 0) {
      const fromEvent = getKeyPackageRelayList(existing10051[0] as NostrEvent)
      if (fromEvent.length > 0) kpRelays = fromEvent
    }

    // Check for existing kind 443 (key package) — local first, then relays
    const localCount = await mc.keyPackages.count()
    if (localCount > 0) return

    const existingKP = await client.fetchEvents(kpRelays, {
      kinds: [443],
      authors: [pubkey],
      limit: 1,
    })
    if (existingKP.length > 0) return

    // No key packages found anywhere — publish kind 10051 + kind 443
    if (existing10051.length === 0) {
      const unsigned = createKeyPackageRelayListEvent({ pubkey, relays: writeRelays })
      const signed = await signEvent(unsigned)
      await network.publish(writeRelays, signed)
      console.log('[Marmot] Published kind 10051 relay list')
    }
    await mc.keyPackages.create({ relays: writeRelays })
    console.log('[Marmot] Published kind 443 key package')
  } catch (err) {
    console.error('[Marmot] Auto-registration failed:', err)
  }
}

export function MarmotProvider({ children }: { children: React.ReactNode }) {
  const { pubkey, signEvent, nip44Encrypt, nip44Decrypt } = useNostr()
  const [marmotClient, setMarmotClient] = useState<MarmotClient<GroupHistory> | null>(null)
  const [isReady, setIsReady] = useState(false)
  const poolRef = useRef<RelayPool | null>(null)
  const registryRef = useRef<GroupHistoryRegistry | null>(null)

  // Build EventSigner directly from NostrContext — always current, no timing issues
  const eventSigner = useMemo(() => {
    if (!pubkey) return null
    return {
      getPublicKey: async () => pubkey,
      signEvent,
      nip44: {
        encrypt: nip44Encrypt,
        decrypt: nip44Decrypt,
      },
    }
  }, [pubkey, signEvent, nip44Encrypt, nip44Decrypt])

  useEffect(() => {
    if (!pubkey || !eventSigner) {
      setMarmotClient(null)
      setIsReady(false)
      return
    }

    // Create a dedicated relay pool and history registry for this account
    const pool = new RelayPool()
    poolRef.current = pool
    const registry = new GroupHistoryRegistry(pubkey)
    registryRef.current = registry

    const groupStateBackend = new KeyValueGroupStateBackend(
      localforage.createInstance({ name: `marmot-group-state-${pubkey}` }) as any
    )

    const keyPackageStore = new KeyPackageStore(
      localforage.createInstance({ name: `marmot-key-packages-${pubkey}` }) as any
    )

    const network = buildNetworkInterface(pool)

    const mc = new MarmotClient<GroupHistory>({
      signer: eventSigner,
      groupStateBackend,
      keyPackageStore,
      network,
      historyFactory: (groupId) => {
        const hex = Array.from(groupId).map((b) => b.toString(16).padStart(2, '0')).join('')
        return registry.get(hex)
      },
    })

    mc.loadAllGroups()
      .then(() => ensureMarmotRegistration(pubkey, mc, network, signEvent))
      .then(() => {
        setIsReady(true)
      })
      .catch((err) => {
        console.error('[Marmot] Failed to load groups:', err)
        setIsReady(true) // still mark ready so UI isn't stuck
      })

    setMarmotClient(mc)

    return () => {
      setMarmotClient(null)
      setIsReady(false)
      registryRef.current?.clear()
      registryRef.current = null
    }
  }, [pubkey, eventSigner])

  const getHistory = (groupIdHex: string): GroupHistory | null =>
    registryRef.current?.get(groupIdHex) ?? null

  return (
    <MarmotContext.Provider value={{ marmotClient, isReady, getHistory }}>
      {children}
    </MarmotContext.Provider>
  )
}
