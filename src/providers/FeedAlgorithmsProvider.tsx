import client from '@/services/client.service'
import storage from '@/services/local-storage.service'
import { createContext, useCallback, useContext, useEffect, useState, useRef } from 'react'
import { useUserTrust } from './UserTrustProvider'
import { useNostr } from './NostrProvider'
import { BIG_RELAY_URLS } from '@/constants'
import { Event, kinds, VerifiedEvent } from 'nostr-tools'
import { SubCloser } from 'nostr-tools/abstract-pool'
import { useMuteList } from './MuteListProvider'

type TFeedAlgorithmsContext = {
  eventLastPostTimes: Map<string, number>
  events: Event[]
}

const FeedAlgorithmsContext = createContext<TFeedAlgorithmsContext | undefined>(undefined)

export const useFeedAlgorithms = () => {
  const context = useContext(FeedAlgorithmsContext)
  if (!context) {
    throw new Error('useUserTrust must be used within a UserTrustProvider')
  }
  return context
}

export function FeedAlgorithmsProvider({ children }: { children: React.ReactNode }) {
  const { pubkey: currentPubkey } = useNostr()
  const { userTrustScore, isUserTrusted, isUserFollowed } = useUserTrust()
  const { mutePubkeys } = useMuteList()
  const mutedPubkeysRef = useRef<string[]>([])
  useEffect(() => {
    mutedPubkeysRef.current = mutePubkeys
  }, [mutePubkeys])
  const mounted = useRef(false)
  const queue = useRef(new Queue())
  const eventLastPostTimes = useRef<Map<string, number>>(new Map())
  const shownEvents = useRef(new Set(JSON.parse(localStorage.getItem('shownEvents') || '[]')))
  const eventMentionCount = useRef<Map<string, Set<string>>>(new Map())
  const eventMentionCountFollowed = useRef<Map<string, Set<string>>>(new Map())
  const eventMap = useRef<Map<string, Event>>(new Map())
  let sub: SubCloser | undefined
  const [events, setEvents] = useState<Event[]>([])

  useEffect(() => {
    if (!currentPubkey) return
    if (mounted.current) return
    mounted.current = true
    
    if (!window.location.host.startsWith('localhost')) return
    mentionProducer()
    mentionConsumer()

    return () => {
      mounted.current = false
      if (sub) {
        sub.close()
        sub = undefined
      }
    }
  }, [currentPubkey])

  const mentionProducer = async () => {
    const now = Math.floor(Date.now() / 1000)
    sub = client.getPool().subscribeMany(BIG_RELAY_URLS, [{
      kinds: [1],
      since: now
    },
    {
      kinds: [6],
      since: now
    },
    {
      kinds: [7],
      since: now
    }], { 
      onevent(event) {
        queue.current.enqueue(event)
      }
    })
  }

  const mentionConsumer = async () => {
    while (true) {
      try {
        const eventListFromQueue: Event[] = []

        do {
          const event = await queue.current.dequeue()
          eventListFromQueue.push(event)
        } while (!queue.current.isEmpty())

        for (const event of eventListFromQueue) {
          if (!isUserTrusted(event.pubkey)) continue
          for (const [tag, eventId] of event.tags) {
            if (tag === 'e') {
              if (!shownEvents.current.has(eventId)) {

                // If the event is already in eventMap, just update the mention counts
                if (eventMap.current.has(eventId)) {
                  // All unique pubkeys
                  let pubkeySet = eventMentionCount.current.get(eventId)
                  if (!pubkeySet) pubkeySet = new Set<string>()
                  pubkeySet.add(event.pubkey)
                  eventMentionCount.current.set(eventId, pubkeySet)

                  // Only pubkeys I follow
                  if (isUserFollowed(event.pubkey)) {
                    let followedSet = eventMentionCountFollowed.current.get(eventId)
                    if (!followedSet) followedSet = new Set<string>()
                    followedSet.add(event.pubkey)
                    eventMentionCountFollowed.current.set(eventId, followedSet)
                  }
                  continue // Skip fetching and publishing logic
                }

                // If not in eventMap, look up all mentioning events
                const referencedEvent = (await client.getPool().querySync(BIG_RELAY_URLS, {
                  ids: [eventId]
                }))[0]
                if (referencedEvent) {
                  eventMap.current.set(eventId, referencedEvent)
                  // skip if muted
                  if (mutedPubkeysRef.current.includes(referencedEvent.pubkey)) {
                    console.warn(`Skipping muted event from ${referencedEvent.pubkey}`)
                    continue
                  }
                  // Now look up all mentioning events
                  const mentioningEvents = await client.getPool().querySync(BIG_RELAY_URLS, {
                    kinds: [1, 6, 7],
                    '#e': [eventId]
                  })
                  // All unique pubkeys, excluding the original poster
                  const uniquePubkeys = new Set<string>(
                    mentioningEvents
                      .map(e => e.pubkey)
                      .filter(pubkey => isUserTrusted(pubkey) && pubkey !== referencedEvent.pubkey)
                  )
                  eventMentionCount.current.set(eventId, uniquePubkeys)

                  // Only pubkeys I follow
                  const followedPubkeys = new Set<string>(
                    mentioningEvents.filter(e => isUserFollowed(e.pubkey)).map(e => e.pubkey)
                  )
                  eventMentionCountFollowed.current.set(eventId, followedPubkeys)

                  const exponent = 1.75
                  if (
                    Math.pow(uniquePubkeys.size - 0, exponent) > userTrustScore(referencedEvent.pubkey) ||
                    followedPubkeys.size >= 2
                  ) {
                    // Publish if not already shown
                    if (!shownEvents.current.has(eventId)) {
                      const existingEvent = (await client.getPool().querySync(['ws://localhost:4848'], {
                        ids: [referencedEvent.id]
                      }))[0]
                      console.log(JSON.parse(localStorage.shownEvents).length, existingEvent)
                      console.log(
                        `|event ${eventId} mentioned by ${uniquePubkeys.size} distinct pubkeys ` +
                        `(${followedPubkeys.size} by followed users) ` +
                        `with trust score ${userTrustScore(referencedEvent.pubkey)}`,
                        referencedEvent
                      )
                      if (existingEvent) {
                        console.log(`|Event already exists, skipping publish`)
                        continue
                      }
                      shownEvents.current.add(eventId)
                      setEvents(prev => [referencedEvent, ...prev])
                      localStorage.setItem('shownEvents', JSON.stringify(Array.from(shownEvents.current)))
                      const result = client.getPool().publish(['ws://localhost:4848'], referencedEvent)
                      Promise.all(result).then(resolved => console.log('|',resolved))
                      ;(window as any).pool = client.getPool()
                    }
                  } else {
                    // console.log(
                    //   `event ${eventId} only mentioned by ${uniquePubkeys.size} pubkey(s) ` +
                    //   `(${followedPubkeys.size} by followed users), not publishing ` +
                    //   `exponent: ${exponent}, `
                    // )
                  }
                } else {
                  console.warn(`Referenced event ${eventId} not found`)
                }
              }
            }
          }
        }

        const authors = new Set(
          eventListFromQueue
            .filter(event => event.kind === 1 && isUserTrusted(event.pubkey))
            .map(event => event.pubkey))

        for (const pubkey of authors) {
          if (mutePubkeys.includes(pubkey)) continue

          try {
            const events = await client.getPool().querySync(BIG_RELAY_URLS, {
              kinds: [1],
              authors: [pubkey],
              limit: 2
            })
            if (events.length > 1) {
              events.sort((a, b) => b.created_at - a.created_at);
              const event = events[0]
              const timeElapsedSinceLastPost =
                (Math.floor(Date.now() / 1000) - events[1].created_at) / (60 * 60 * 24)
              if (timeElapsedSinceLastPost > 20) {
                eventLastPostTimes.current.set(event.id, timeElapsedSinceLastPost)
                client.getPool().publish(['ws://localhost:4848'], event)
              } else if (timeElapsedSinceLastPost > 2) {
                // console.log('|event', event)
                // console.log(`|Skipping event due to recent activity (${timeElapsedSinceLastPost.toFixed(2)} days ago)`)
              }
            }
          } catch (error) {
            console.error(`Error fetching history for ${pubkey}:`, error)
          }
        }
      } catch (error) {
        Promise.reject(error)
      }
    }
  }

  return (
    <FeedAlgorithmsContext.Provider
      value={{
        eventLastPostTimes: eventLastPostTimes.current,
        events,
      }}
    >
      {children}
    </FeedAlgorithmsContext.Provider>
  )
}

class Queue {
  private queue: any[];
  private resolvers: any[];

  constructor() {
    this.queue = []
    this.resolvers = []
  }

  enqueue(item: any) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()
      resolve(item)
    } else {
      this.queue.push(item)
    }
  }

  dequeue() {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift())
    }
    return new Promise(resolve => this.resolvers.push(resolve))
  }

  isEmpty() {
    return this.queue.length === 0
  }
}