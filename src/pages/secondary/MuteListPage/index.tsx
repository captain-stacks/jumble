import MuteButton from '@/components/MuteButton'
import Nip05 from '@/components/Nip05'
import TrustScoreBadge from '@/components/TrustScoreBadge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import UserAvatar from '@/components/UserAvatar'
import Username from '@/components/Username'
import { useFetchProfile } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useMuteList } from '@/providers/MuteListProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useUserTrust } from '@/providers/UserTrustProvider'
import { Loader, Lock, Unlock, VolumeX } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import NotFoundPage from '../NotFoundPage'

const MuteListPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const { profile, pubkey } = useNostr()
  const { getMutePubkeys, getMuteType, bulkSwitchToPublicMute, bulkUnmutePubkeys } = useMuteList()
  const { computeTrustScore, wotReady } = useUserTrust()
  const mutePubkeys = useMemo(
    () => [...getMutePubkeys()].sort((a, b) => computeTrustScore(a) - computeTrustScore(b)),
    [pubkey, wotReady, computeTrustScore]
  )
  const [visibleMutePubkeys, setVisibleMutePubkeys] = useState<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  const [selectMode, setSelectMode] = useState(false)
  const [selectedPubkeys, setSelectedPubkeys] = useState<Set<string>>(new Set())
  const [bulkSwitching, setBulkSwitching] = useState(false)
  const lastClickedRef = useRef<string | null>(null)

  useEffect(() => {
    setVisibleMutePubkeys(mutePubkeys.slice(0, 10))
  }, [mutePubkeys])

  useEffect(() => {
    const options = { root: null, rootMargin: '10px', threshold: 1 }
    const observerInstance = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && mutePubkeys.length > visibleMutePubkeys.length) {
        setVisibleMutePubkeys((prev) => [
          ...prev,
          ...mutePubkeys.slice(prev.length, prev.length + 10)
        ])
      }
    }, options)
    const currentBottomRef = bottomRef.current
    if (currentBottomRef) observerInstance.observe(currentBottomRef)
    return () => {
      if (observerInstance && currentBottomRef) observerInstance.unobserve(currentBottomRef)
    }
  }, [visibleMutePubkeys, mutePubkeys])

  const handleToggleSelect = useCallback(
    (pk: string, shiftKey = false) => {
      setSelectedPubkeys((prev) => {
        const next = new Set(prev)

        if (shiftKey && lastClickedRef.current && lastClickedRef.current !== pk) {
          const fromIdx = mutePubkeys.indexOf(lastClickedRef.current)
          const toIdx = mutePubkeys.indexOf(pk)
          if (fromIdx !== -1 && toIdx !== -1) {
            const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx]
            const rangeSelected = !prev.has(pk)
            mutePubkeys.slice(start, end + 1).forEach((p) => {
              if (rangeSelected) next.add(p)
              else next.delete(p)
            })
            return next
          }
        }

        if (next.has(pk)) next.delete(pk)
        else next.add(pk)
        return next
      })
      lastClickedRef.current = pk
    },
    [mutePubkeys]
  )

  const allSelected = mutePubkeys.length > 0 && mutePubkeys.every((pk) => selectedPubkeys.has(pk))
  const someSelected = !allSelected && mutePubkeys.some((pk) => selectedPubkeys.has(pk))

  const handleSelectAll = () => {
    if (allSelected) setSelectedPubkeys(new Set())
    else setSelectedPubkeys(new Set(mutePubkeys))
  }

  const handleCancelSelect = () => {
    setSelectMode(false)
    setSelectedPubkeys(new Set())
    lastClickedRef.current = null
  }

  const privateSelectedCount = useMemo(
    () => [...selectedPubkeys].filter((pk) => getMuteType(pk) === 'private').length,
    [selectedPubkeys, getMuteType]
  )

  const handleMakePublic = async () => {
    if (bulkSwitching) return
    setBulkSwitching(true)
    try {
      const privatePubkeys = [...selectedPubkeys].filter((pk) => getMuteType(pk) === 'private')
      await bulkSwitchToPublicMute(privatePubkeys)
    } finally {
      setBulkSwitching(false)
      handleCancelSelect()
    }
  }

  const handleUnmuteSelected = async () => {
    if (bulkSwitching) return
    setBulkSwitching(true)
    try {
      await bulkUnmutePubkeys([...selectedPubkeys])
    } finally {
      setBulkSwitching(false)
      handleCancelSelect()
    }
  }

  if (!profile) {
    return <NotFoundPage />
  }

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={t("username's muted", { username: profile.username })}
      displayScrollToTopButton
      controls={
        selectMode ? (
          <Button variant="ghost" size="sm" onClick={handleCancelSelect}>
            {t('Cancel')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setSelectMode(true)}>
            {t('Select')}
          </Button>
        )
      }
    >
      {selectMode && (
        <div className="border-b px-4 py-3 space-y-2">
          <div
            className="flex cursor-pointer items-center gap-3 select-none"
            onClick={handleSelectAll}
          >
            <Checkbox
              checked={allSelected ? true : someSelected ? 'indeterminate' : false}
              onCheckedChange={handleSelectAll}
              onClick={(e) => e.stopPropagation()}
            />
            <span className="text-muted-foreground text-sm">
              {allSelected
                ? t('Deselect all')
                : selectedPubkeys.size > 0
                  ? t('{{count}} selected', { count: selectedPubkeys.size })
                  : t('Select all')}
            </span>
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={privateSelectedCount === 0 || bulkSwitching}
              onClick={handleMakePublic}
              variant="secondary"
              size="sm"
            >
              {bulkSwitching ? (
                <Loader className="animate-spin" />
              ) : (
                <>
                  <Unlock className="size-4" />
                  {privateSelectedCount > 0
                    ? t('Make {{count}} public', { count: privateSelectedCount })
                    : t('Make public')}
                </>
              )}
            </Button>
            <Button
              className="flex-1"
              disabled={selectedPubkeys.size === 0 || bulkSwitching}
              onClick={handleUnmuteSelected}
              variant="destructive"
              size="sm"
            >
              {bulkSwitching ? (
                <Loader className="animate-spin" />
              ) : (
                <>
                  <VolumeX className="size-4" />
                  {selectedPubkeys.size > 0
                    ? t('Unmute {{count}}', { count: selectedPubkeys.size })
                    : t('Unmute')}
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      <div className={`space-y-2 px-4 pt-2${selectMode ? ' select-none' : ''}`}>
        {visibleMutePubkeys.map((pk, i) => (
          <UserItem
            key={`${i}-${pk}`}
            pubkey={pk}
            selectMode={selectMode}
            isSelected={selectedPubkeys.has(pk)}
            onToggle={handleToggleSelect}
          />
        ))}
        {mutePubkeys.length > visibleMutePubkeys.length && <div ref={bottomRef} />}
      </div>
    </SecondaryPageLayout>
  )
})
MuteListPage.displayName = 'MuteListPage'
export default MuteListPage

function UserItem({
  pubkey,
  selectMode,
  isSelected,
  onToggle
}: {
  pubkey: string
  selectMode: boolean
  isSelected: boolean
  onToggle: (pk: string, shiftKey?: boolean) => void
}) {
  const { changing, getMuteType, switchToPrivateMute, switchToPublicMute } = useMuteList()
  const { profile } = useFetchProfile(pubkey)
  const muteType = useMemo(() => getMuteType(pubkey), [pubkey, getMuteType])
  const [switching, setSwitching] = useState(false)
  // Capture shiftKey on pointerdown so onCheckedChange (which has no MouseEvent) can read it.
  // pointerdown bubbles up from the checkbox before checkbox's onClick calls stopPropagation.
  const shiftKeyRef = useRef(false)

  return (
    <div
      className="flex items-start gap-2"
      onPointerDown={selectMode ? (e) => { shiftKeyRef.current = e.shiftKey } : undefined}
      onClick={selectMode ? (e) => onToggle(pubkey, e.shiftKey) : undefined}
    >
      {selectMode && (
        <div className="flex shrink-0 items-center pt-1">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggle(pubkey, shiftKeyRef.current)}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      <UserAvatar userId={pubkey} className="shrink-0" />
      <div className="w-full overflow-hidden">
        <div className="flex items-center gap-2">
          <Username
            userId={pubkey}
            className="w-fit max-w-full truncate font-semibold"
            skeletonClassName="h-4"
          />
          <TrustScoreBadge pubkey={pubkey} />
        </div>
        <Nip05 pubkey={pubkey} />
        <div className="truncate text-sm text-muted-foreground">{profile?.about}</div>
      </div>
      {!selectMode && (
        <div className="flex items-center gap-2">
          {switching ? (
            <Button disabled variant="ghost" size="icon">
              <Loader className="animate-spin" />
            </Button>
          ) : muteType === 'private' ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (switching) return
                setSwitching(true)
                switchToPublicMute(pubkey).finally(() => setSwitching(false))
              }}
              disabled={changing}
            >
              <Lock className="text-green-400" />
            </Button>
          ) : muteType === 'public' ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (switching) return
                setSwitching(true)
                switchToPrivateMute(pubkey).finally(() => setSwitching(false))
              }}
              disabled={changing}
            >
              <Unlock className="text-muted-foreground" />
            </Button>
          ) : null}
          <MuteButton pubkey={pubkey} />
        </div>
      )}
    </div>
  )
}
