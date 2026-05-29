import { formatError } from '@/lib/error'
import client from '@/services/client.service'
import indexedDb from '@/services/indexed-db.service'
import threadService from '@/services/thread.service'
import {
  TPostDraft,
  TPostDraftSigned,
  TPostDraftStatus,
  TPostDraftUnsigned
} from '@/types/post-draft'
import type { Event as NostrEvent } from 'nostr-tools'
import { useEffect, useState } from 'react'

export type TSignedDraftInput = Omit<
  TPostDraftSigned,
  'status' | 'error' | 'failedAt' | 'updatedAt'
>

class PostDraftService extends EventTarget {
  static instance: PostDraftService

  private map = new Map<string, TPostDraft>()
  private inflight = new Set<string>()
  private initialized = false
  private initPromise: Promise<void> | null = null

  static getInstance(): PostDraftService {
    if (!PostDraftService.instance) {
      PostDraftService.instance = new PostDraftService()
    }
    return PostDraftService.instance
  }

  async init(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise
    this.initPromise = (async () => {
      try {
        const all = await indexedDb.getAllPostDrafts()
        for (const draft of all) {
          this.map.set(draft.id, draft)
        }
        this.initialized = true
        this.emitChange()
      } catch (err) {
        console.error('postDraftService.init failed', err)
      }
    })()
    return this.initPromise
  }

  /**
   * Resume publishes interrupted by a previous shutdown, scoped to one account.
   * Called once the account (and its signer, needed for relay AUTH) is ready —
   * NOT at module init, where there is no signer and a foreign account's pending
   * would be broadcast/failed with the wrong identity. Reusing the stored signed
   * event (same id) means relays dedupe, so re-sending is safe.
   */
  resumePending(pubkey: string): void {
    for (const d of this.map.values()) {
      if (d.pubkey === pubkey && d.status === 'pending' && !this.inflight.has(d.id)) {
        void this.startPublish(d as TPostDraftSigned, { silent: true }).catch(() => {})
      }
    }
  }

  list(pubkey: string, status?: TPostDraftStatus): TPostDraft[] {
    const items: TPostDraft[] = []
    for (const d of this.map.values()) {
      if (d.pubkey !== pubkey) continue
      if (status && d.status !== status) continue
      items.push(d)
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt)
    return items
  }

  get(id: string): TPostDraft | undefined {
    return this.map.get(id)
  }

  /**
   * Find an existing unsigned draft that replies to the given parent, so opening
   * a reply composer can resume it instead of starting blank.
   */
  findDraftForParent(
    pubkey: string,
    parentStuff: NostrEvent | string
  ): TPostDraftUnsigned | undefined {
    const parentId = typeof parentStuff === 'string' ? undefined : parentStuff.id
    const parentCoordinate = typeof parentStuff === 'string' ? parentStuff : undefined
    for (const d of this.map.values()) {
      if (d.pubkey !== pubkey || d.status !== 'draft') continue
      const u = d as TPostDraftUnsigned
      // A highlight draft isn't a plain reply — don't resume it as one.
      if (u.highlightedText) continue
      if (parentId && u.parentEvent?.id === parentId) return u
      if (parentCoordinate && u.parentEventCoordinate === parentCoordinate) return u
    }
    return undefined
  }

  countByStatus(pubkey: string): Record<TPostDraftStatus, number> {
    const counts: Record<TPostDraftStatus, number> = { draft: 0, pending: 0, failed: 0 }
    for (const d of this.map.values()) {
      if (d.pubkey !== pubkey) continue
      counts[d.status]++
    }
    return counts
  }

  async saveDraft(
    input: Omit<TPostDraftUnsigned, 'status' | 'createdAt' | 'updatedAt'>
  ): Promise<TPostDraftUnsigned> {
    const now = Date.now()
    const existing = this.map.get(input.id) as TPostDraftUnsigned | undefined
    const record: TPostDraftUnsigned = {
      ...input,
      status: 'draft',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    await indexedDb.putPostDraft(record)
    this.map.set(record.id, record)
    this.emitChange()
    return record
  }

  /**
   * Persist a freshly-signed event as `pending` (the hidden outbox), then kick
   * off the publish. Awaiting this only awaits the IDB write, so the caller can
   * close the editor immediately — the broadcast runs in the background. If the
   * app is closed mid-send, the pending record survives and init() resumes it.
   */
  async enqueue(input: TSignedDraftInput): Promise<void> {
    const pending = await this.persistPending(input)
    this.startPublish(pending)
  }

  async retry(id: string): Promise<void> {
    const existing = this.map.get(id)
    if (!existing || existing.status !== 'failed') return
    if (this.inflight.has(id)) return
    const pending = await this.persistPending(existing as TPostDraftSigned)
    this.startPublish(pending)
  }

  private async persistPending(input: TSignedDraftInput): Promise<TPostDraftSigned> {
    const now = Date.now()
    const existing = this.map.get(input.id)
    const pending: TPostDraftSigned = {
      ...input,
      status: 'pending',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      error: undefined,
      failedAt: undefined
    }
    await indexedDb.putPostDraft(pending)
    this.map.set(pending.id, pending)
    this.emitChange()
    return pending
  }

  private startPublish(pending: TPostDraftSigned, { silent = false } = {}): Promise<void> {
    // Don't double-publish the same id (e.g. a foreground enqueue racing a
    // resume), and never hand an empty relay set to publishEvent — its success
    // threshold loop would never settle, wedging the record in `inflight`.
    if (this.inflight.has(pending.id)) return Promise.resolve()
    if (!pending.targetRelays.length) {
      return this.markFailed(pending, 'No relays to publish to')
    }
    this.inflight.add(pending.id)
    const promise = client.publishEvent(pending.targetRelays, pending.signedEvent)
    if (!silent) {
      this.dispatchEvent(
        new CustomEvent('publish-start', { detail: { id: pending.id, promise } })
      )
    }
    return promise
      .then(async () => {
        this.inflight.delete(pending.id)
        await indexedDb.deletePostDraft(pending.id)
        this.map.delete(pending.id)
        this.emitChange()
        // Optimistically surface the published note in any open thread, matching
        // the pre-drafts-box behavior where post() inserted the reply directly.
        threadService.addRepliesToThread([pending.signedEvent])
      })
      .catch(async (err) => {
        this.inflight.delete(pending.id)
        await this.markFailed(pending, formatError(err).join('; '))
      })
  }

  private async markFailed(pending: TPostDraftSigned, error: string): Promise<void> {
    const now = Date.now()
    const failed: TPostDraftSigned = {
      ...pending,
      status: 'failed',
      error,
      failedAt: now,
      updatedAt: now
    }
    await indexedDb.putPostDraft(failed)
    this.map.set(failed.id, failed)
    this.emitChange()
  }

  async delete(id: string): Promise<void> {
    if (this.inflight.has(id)) return
    await indexedDb.deletePostDraft(id)
    this.map.delete(id)
    this.emitChange()
  }

  private emitChange() {
    this.dispatchEvent(new Event('change'))
  }
}

const instance = PostDraftService.getInstance()
export default instance

export function useDrafts(pubkey: string | undefined): TPostDraft[] {
  const [drafts, setDrafts] = useState<TPostDraft[]>(() =>
    pubkey ? instance.list(pubkey) : []
  )
  useEffect(() => {
    if (!pubkey) {
      setDrafts([])
      return
    }
    const update = () => setDrafts(instance.list(pubkey))
    update()
    instance.addEventListener('change', update)
    return () => instance.removeEventListener('change', update)
  }, [pubkey])
  return drafts
}

export function useDraftCounts(
  pubkey: string | undefined
): Record<TPostDraftStatus, number> {
  const [counts, setCounts] = useState<Record<TPostDraftStatus, number>>(() =>
    pubkey ? instance.countByStatus(pubkey) : { draft: 0, pending: 0, failed: 0 }
  )
  useEffect(() => {
    if (!pubkey) {
      setCounts({ draft: 0, pending: 0, failed: 0 })
      return
    }
    const update = () => setCounts(instance.countByStatus(pubkey))
    update()
    instance.addEventListener('change', update)
    return () => instance.removeEventListener('change', update)
  }, [pubkey])
  return counts
}
