import { normalizeUrl } from '@/lib/url'
import { useCurrentRelays } from '@/providers/CurrentRelaysProvider'
import client from '@/services/client.service'
import { useCallback, useEffect, useRef, useState } from 'react'

const POLL_INTERVAL_MS = 5_000

export function useRelayConnectionStatus(explicitRelayUrls?: string[]) {
  const { relayUrls: currentRelayUrls } = useCurrentRelays()
  const relayUrls = explicitRelayUrls ?? currentRelayUrls
  const [statusMap, setStatusMap] = useState<Map<string, boolean>>(new Map())
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    const status = await client.getRelayConnectionStatus()
    if (mountedRef.current) {
      setStatusMap(status)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refresh])

  const relays = relayUrls.map((url) => ({
    url,
    connected: statusMap.get(normalizeUrl(url)) ?? false
  }))

  return { relays }
}
