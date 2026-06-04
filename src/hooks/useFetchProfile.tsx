import { getCachedProfile, setCachedProfile, subscribeToProfile } from '@/lib/profile-cache'
import { userIdToPubkey } from '@/lib/pubkey'
import { useNostr } from '@/providers/NostrProvider'
import client from '@/services/client.service'
import { TProfile } from '@/types'
import { useEffect, useState } from 'react'

export function useFetchProfile(id?: string) {
  const { profile: currentAccountProfile } = useNostr()
  const [isFetching, setIsFetching] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [pubkey, setPubkey] = useState<string | null>(null)
  const [profile, setProfile] = useState<TProfile | null>(() => {
    if (!id) return null
    try {
      const pk = userIdToPubkey(id)
      return getCachedProfile(pk) ?? null
    } catch {
      return null
    }
  })

  useEffect(() => {
    setPubkey(null)
    const fetchProfile = async () => {
      setIsFetching(true)
      try {
        if (!id) {
          setIsFetching(false)
          setError(new Error('No id provided'))
          return
        }

        const pk = userIdToPubkey(id)
        setPubkey(pk)

        const cached = getCachedProfile(pk)
        if (cached) {
          setProfile(cached)
        }

        const fetched = await client.fetchProfile(id)
        if (fetched) {
          setCachedProfile(pk, fetched)
          setProfile(fetched)
        }
      } catch (err) {
        setError(err as Error)
      } finally {
        setIsFetching(false)
      }
    }

    fetchProfile()
  }, [id])

  useEffect(() => {
    if (!pubkey) return
    return subscribeToProfile(pubkey, (updated) => setProfile(updated))
  }, [pubkey])

  useEffect(() => {
    if (currentAccountProfile && pubkey === currentAccountProfile.pubkey) {
      setCachedProfile(pubkey, currentAccountProfile)
    }
  }, [currentAccountProfile, pubkey])

  return { isFetching, error, profile }
}
