import { getEventKey, isMentioningMutedUsers } from '@/lib/event'
import { useContentPolicy } from '@/providers/ContentPolicyProvider'
import { useFollowList } from '@/providers/FollowListProvider'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { NostrEvent } from 'nostr-tools'
import { useEffect, useState } from 'react'
import { useAllDescendantThreads } from './useThread'
import { SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'

export function useFilteredReplies(stuffKey: string, showMutedContent = false) {
  const { pubkey } = useNostr()
  const { getMinTrustScore, meetsMinTrustScore } = useUserTrust()
  const { mutePubkeySet } = useMuteList()
  const { followingSet } = useFollowList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const allThreads = useAllDescendantThreads(stuffKey)
  const [replies, setReplies] = useState<NostrEvent[]>([])
  const [hasReplied, setHasReplied] = useState(false)

  useEffect(() => {
    const filterReplies = async () => {
      const replyKeySet = new Set<string>()
      const thread = allThreads.get(stuffKey) || []
      const filtered: NostrEvent[] = []

      const trustScoreThreshold = getMinTrustScore(SPECIAL_TRUST_SCORE_FILTER_ID.INTERACTIONS)
      await Promise.all(
        thread.map(async (evt) => {
          const key = getEventKey(evt)
          if (replyKeySet.has(key)) return
          replyKeySet.add(key)

          const isFollowed = followingSet.has(evt.pubkey)
          // Followed users always appear in replies even if muted; mute only blocks feeds
          if (!showMutedContent && !isFollowed && mutePubkeySet.has(evt.pubkey)) return
          if (!showMutedContent && hideContentMentioningMutedUsers && isMentioningMutedUsers(evt, mutePubkeySet)) return

          // Followed users bypass trust score filter
          const meetsTrust = isFollowed || (await meetsMinTrustScore(evt.pubkey, trustScoreThreshold))
          if (!meetsTrust) {
            const replyKey = getEventKey(evt)
            const repliesForThisReply = allThreads.get(replyKey)
            // If the reply is not trusted, check if there are any trusted replies for this reply
            if (repliesForThisReply && repliesForThisReply.length > 0) {
              let hasTrustedReply = false
              for (const reply of repliesForThisReply) {
                if (followingSet.has(reply.pubkey) || await meetsMinTrustScore(reply.pubkey, trustScoreThreshold)) {
                  hasTrustedReply = true
                  break
                }
              }
              if (!hasTrustedReply) return
            } else {
              return
            }
          }
          filtered.push(evt)
        })
      )

      filtered.sort((a, b) => b.created_at - a.created_at)
      setReplies(filtered)
    }

    filterReplies()
  }, [
    stuffKey,
    allThreads,
    mutePubkeySet,
    followingSet,
    hideContentMentioningMutedUsers,
    getMinTrustScore,
    meetsMinTrustScore,
    showMutedContent
  ])

  useEffect(() => {
    let replied = false
    for (const reply of replies) {
      if (reply.pubkey === pubkey) {
        replied = true
        break
      }
    }
    setHasReplied(replied)
  }, [replies, pubkey])

  return { replies, hasReplied }
}

export function useFilteredAllReplies(stuffKey: string) {
  const { pubkey } = useNostr()
  const allThreads = useAllDescendantThreads(stuffKey)
  const { getMinTrustScore, meetsMinTrustScore } = useUserTrust()
  const { mutePubkeySet } = useMuteList()
  const { followingSet } = useFollowList()
  const { hideContentMentioningMutedUsers } = useContentPolicy()
  const [replies, setReplies] = useState<NostrEvent[]>([])
  const [hasReplied, setHasReplied] = useState(false)

  useEffect(() => {
    const filterReplies = async () => {
      const replyKeySet = new Set<string>()
      const replyEvents: NostrEvent[] = []
      const trustScoreThreshold = getMinTrustScore(SPECIAL_TRUST_SCORE_FILTER_ID.INTERACTIONS)

      let parentKeys = [stuffKey]
      while (parentKeys.length > 0) {
        const events = parentKeys.flatMap((key) => allThreads.get(key) ?? [])
        await Promise.all(
          events.map(async (evt) => {
            const key = getEventKey(evt)
            if (replyKeySet.has(key)) return
            replyKeySet.add(key)

            const isFollowed = followingSet.has(evt.pubkey)
            // Followed users always appear in replies even if muted; mute only blocks feeds
            if (!isFollowed && mutePubkeySet.has(evt.pubkey)) return
            if (hideContentMentioningMutedUsers && isMentioningMutedUsers(evt, mutePubkeySet))
              return

            // Followed users bypass trust score filter
            const meetsTrust = isFollowed || (await meetsMinTrustScore(evt.pubkey, trustScoreThreshold))
            if (!meetsTrust) {
              const replyKey = getEventKey(evt)
              const repliesForThisReply = allThreads.get(replyKey)
              // If the reply is not trusted, check if there are any trusted replies for this reply
              if (repliesForThisReply && repliesForThisReply.length > 0) {
                let hasTrustedReply = false
                for (const reply of repliesForThisReply) {
                  if (followingSet.has(reply.pubkey) || await meetsMinTrustScore(reply.pubkey, trustScoreThreshold)) {
                    hasTrustedReply = true
                    break
                  }
                }
                if (!hasTrustedReply) return
              } else {
                return
              }
            }

            replyEvents.push(evt)
          })
        )
        parentKeys = events.map((evt) => getEventKey(evt))
      }
      setReplies(replyEvents.sort((a, b) => a.created_at - b.created_at))
    }

    filterReplies()
  }, [
    stuffKey,
    allThreads,
    mutePubkeySet,
    followingSet,
    hideContentMentioningMutedUsers,
    getMinTrustScore,
    meetsMinTrustScore
  ])

  useEffect(() => {
    let replied = false
    for (const reply of replies) {
      if (reply.pubkey === pubkey) {
        replied = true
        break
      }
    }
    setHasReplied(replied)
  }, [replies, pubkey])

  return { replies, hasReplied }
}
