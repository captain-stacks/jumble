import type { BaseGroupHistory } from '@internet-privacy/marmot-ts'
import localforage from 'localforage'

const COUNT_KEY = '__count__'

/**
 * Localforage-backed message history for a single MLS group.
 * Stores decrypted application message bytes in insertion order.
 * Also exposes loadMessages() so the UI can read them back.
 */
export class GroupHistory implements BaseGroupHistory {
  private store: ReturnType<typeof localforage.createInstance>
  private countCache: number | null = null

  constructor(pubkey: string, groupIdHex: string) {
    this.store = localforage.createInstance({
      name: `marmot-history-${pubkey}-${groupIdHex}`
    })
  }

  private async getCount(): Promise<number> {
    if (this.countCache !== null) return this.countCache
    const stored = await this.store.getItem<number>(COUNT_KEY)
    this.countCache = stored ?? 0
    return this.countCache
  }

  async saveMessage(message: Uint8Array): Promise<void> {
    const count = await this.getCount()
    await this.store.setItem(`msg_${count}`, message)
    this.countCache = count + 1
    await this.store.setItem(COUNT_KEY, this.countCache)
  }

  async loadMessages(): Promise<Uint8Array[]> {
    const count = await this.getCount()
    if (count === 0) return []
    const results = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        this.store.getItem<Uint8Array>(`msg_${i}`)
      )
    )
    return results.filter((m): m is Uint8Array => m !== null)
  }

  async purgeMessages(): Promise<void> {
    await this.store.clear()
    this.countCache = 0
  }
}

/** Creates and caches GroupHistory instances for a given account */
export class GroupHistoryRegistry {
  private instances = new Map<string, GroupHistory>()

  constructor(private pubkey: string) {}

  get(groupIdHex: string): GroupHistory {
    let instance = this.instances.get(groupIdHex)
    if (!instance) {
      instance = new GroupHistory(this.pubkey, groupIdHex)
      this.instances.set(groupIdHex, instance)
    }
    return instance
  }

  clear() {
    this.instances.clear()
  }
}
