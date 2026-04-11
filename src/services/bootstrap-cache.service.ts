/**
 * Caches bootstrap data (WoT, mute list) in memory for non-logged-in users
 * to avoid re-fetching during account creation.
 * 
 * Memory-only storage ensures:
 * - No stale data (cleared when tab closes)
 * - Automatic rebuild if user leaves and returns
 * - Fresh data always persisted to profile when account created
 */

type TBootstrapCache = {
  wotPubkeys: string[]
  mutePubkeys: string[]
}

class BootstrapCacheService {
  private cache: TBootstrapCache | null = null

  setWoT(pubkeys: string[]): void {
    this.cache = {
      wotPubkeys: pubkeys,
      mutePubkeys: this.cache?.mutePubkeys ?? []
    }
    console.log('[BootstrapCache] Set WoT', { size: pubkeys.length })
  }

  setMuteList(pubkeys: string[]): void {
    this.cache = {
      wotPubkeys: this.cache?.wotPubkeys ?? [],
      mutePubkeys: pubkeys
    }
    console.log('[BootstrapCache] Set mute list', { size: pubkeys.length })
  }

  getWoT(): string[] | null {
    const result = this.cache?.wotPubkeys ?? null
    console.log('[BootstrapCache] Get WoT', { size: result?.length ?? 0 })
    return result
  }

  getMuteList(): string[] | null {
    const result = this.cache?.mutePubkeys ?? null
    console.log('[BootstrapCache] Get mute list', { size: result?.length ?? 0 })
    return result
  }

  clear(): void {
    console.log('[BootstrapCache] Clearing cache')
    this.cache = null
  }
}

export default new BootstrapCacheService()
