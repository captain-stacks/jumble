import { TProfile } from '@/types'

const cache = new Map<string, TProfile>()
const listeners = new Map<string, Set<(profile: TProfile) => void>>()

export function getCachedProfile(pubkey: string): TProfile | undefined {
  return cache.get(pubkey)
}

export function setCachedProfile(pubkey: string, profile: TProfile) {
  cache.set(pubkey, profile)
  listeners.get(pubkey)?.forEach((fn) => fn(profile))
}

export function subscribeToProfile(
  pubkey: string,
  fn: (profile: TProfile) => void
): () => void {
  let set = listeners.get(pubkey)
  if (!set) {
    set = new Set()
    listeners.set(pubkey, set)
  }
  set.add(fn)
  return () => set!.delete(fn)
}
