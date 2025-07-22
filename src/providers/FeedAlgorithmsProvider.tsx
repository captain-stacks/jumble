import client from '@/services/client.service'
import { createContext, useContext, useEffect, useState, useRef } from 'react'
import { useUserTrust } from './UserTrustProvider'
import { useNostr } from './NostrProvider'
import { BIG_RELAY_URLS } from '@/constants'
import { Event, kinds } from 'nostr-tools'
import { SubCloser } from 'nostr-tools/abstract-pool'
import { useMuteList } from './MuteListProvider'

type TFeedAlgorithmsContext = {
  eventLastPostTimes: Map<string, number>
  events: Event[]
  notstrEvents: Event[],
  postThreshold: number,
  setPostThreshold: (value: number) => void,
  inactivityThreshold: number,
  setInactivityThreshold: (value: number) => void,
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
  const mounted = useRef(false)
  const queue = useRef(new Queue())
  const eventLastPostTimes = useRef<Map<string, number>>(new Map())
  const shownEvents = useRef(new Set(JSON.parse(localStorage.getItem('shownEvents') || '[]')))
  const eventMentionCount = useRef<Map<string, Set<string>>>(new Map())
  const eventMentionCountFollowed = useRef<Map<string, Set<string>>>(new Map())
  const eventMap = useRef<Map<string, Event>>(new Map())
  let sub: SubCloser | undefined
  const [events, setEvents] = useState<Event[]>([])
  const [notstrEvents, setNostrEvents] = useState<Event[]>([])
  const [postThreshold, setPostThreshold] = useState(0)
  const [inactivityThreshold, setInactivityThreshold] = useState(30)
  const inactivityThresholdRef = useRef(inactivityThreshold)
  const postThresholdRef = useRef(postThreshold)
  ;(window as any).pool = client.getPool()
  useEffect(() => {
    postThresholdRef.current = postThreshold
  }, [postThreshold])
  useEffect(() => {
    inactivityThresholdRef.current = inactivityThreshold
  }, [inactivityThreshold])

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
      kinds: [kinds.ShortTextNote, kinds.Repost, kinds.Reaction],
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
          if (event.pubkey === currentPubkey) continue

          for (const [tag, eventId] of event.tags) {
            if (tag === 'e') {
              if (!shownEvents.current.has(eventId)) {
                if (eventMap.current.has(eventId)) {
                  let pubkeySet = eventMentionCount.current.get(eventId)
                  if (!pubkeySet) pubkeySet = new Set<string>()
                  pubkeySet.add(event.pubkey)
                  eventMentionCount.current.set(eventId, pubkeySet)
                  
                  if (isUserFollowed(event.pubkey)) {
                    let followedSet = eventMentionCountFollowed.current.get(eventId)
                    if (!followedSet) followedSet = new Set<string>()
                    followedSet.add(event.pubkey)
                    eventMentionCountFollowed.current.set(eventId, followedSet)
                  }
                  continue
                }
                const referencedEvent = (await client.getPool().querySync(BIG_RELAY_URLS, {
                  ids: [eventId]
                }))[0]
                if (!referencedEvent) continue
                eventMap.current.set(eventId, referencedEvent)
                //if (mutePubkeys.includes(referencedEvent.pubkey)) continue
                
                const mentioningEvents = await client.getPool().querySync(BIG_RELAY_URLS, {
                  kinds: [kinds.ShortTextNote, kinds.Repost, kinds.Reaction],
                  '#e': [eventId]
                })
                const uniquePubkeys = new Set<string>(
                  mentioningEvents.map(e => e.pubkey).filter(pubkey =>
                    isUserTrusted(pubkey) &&
                    pubkey !== referencedEvent.pubkey &&
                    pubkey !== currentPubkey)
                  )
                eventMentionCount.current.set(eventId, uniquePubkeys)
                const followedPubkeys = new Set<string>(
                  mentioningEvents.filter(e => isUserFollowed(e.pubkey)).map(e => e.pubkey)
                )
                eventMentionCountFollowed.current.set(eventId, followedPubkeys)
                if (
                  Math.pow(uniquePubkeys.size - postThresholdRef.current, 1.3) >
                    userTrustScore(referencedEvent.pubkey)
                  || followedPubkeys.size >= 2
                ) {
                  if (!shownEvents.current.has(eventId)) {
                    shownEvents.current.add(eventId)
                    localStorage.setItem('shownEvents', JSON.stringify(Array.from(shownEvents.current)))

                    if (isUserTrusted(referencedEvent.pubkey)) {
                      setEvents(prev => [referencedEvent, ...prev])
                    } else {
                      const pubkey = referencedEvent.pubkey
                      const followers = client.fetchFollowedBy(pubkey)
                      const muters = client.fetchMutedBy(pubkey)
                      
                      Promise.all([followers, muters]).then(([followers, muters]) => {
                        const trustedFollowers = followers.filter(isUserTrusted)
                        const trustedMuters = muters.filter(isUserTrusted)

                        const F = trustedFollowers.length
                        const M = trustedMuters.length
                        let score = -1
                        if (F > 0) {
                          score = 100 * F / (F + M)
                        }
                        if (score < 0 || score > 90) {
                          setEvents(prev => [referencedEvent, ...prev])
                        }
                      })
                    }
                  }
                }
              }
            }
          }
        }
        const authors = new Set(eventListFromQueue
          .filter(event =>
            event.kind === kinds.ShortTextNote &&
            isUserTrusted(event.pubkey))
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
              if (timeElapsedSinceLastPost > inactivityThresholdRef.current) {
                eventLastPostTimes.current.set(event.id, timeElapsedSinceLastPost)
                setNostrEvents(prev => [event, ...prev])
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
        notstrEvents,
        postThreshold,
        setPostThreshold,
        inactivityThreshold,
        setInactivityThreshold,
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