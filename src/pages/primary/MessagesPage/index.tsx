import { Button } from '@/components/ui/button'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { SimpleUsername } from '@/components/Username'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { toMessageThread } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { useMarmot } from '@/providers/MarmotProvider'
import { useNostr } from '@/providers/NostrProvider'
import { TPageRef } from '@/types'
import { extractMarmotGroupData, getMemberCount, getGroupMembers } from '@internet-privacy/marmot-ts'
import { Lock, MessageSquare, Plus, Users } from 'lucide-react'
import { forwardRef, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MarmotGroup } from '@internet-privacy/marmot-ts'
import type { GroupHistory } from '@/services/marmot-history.service'
import CreateGroupDialog from './CreateGroupDialog'

const MessagesPage = forwardRef<TPageRef>((_, ref) => {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const { marmotClient, isReady } = useMarmot()
  const { push } = useSecondaryPage()
  const [groups, setGroups] = useState<MarmotGroup<GroupHistory>[]>([])
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  useEffect(() => {
    if (!marmotClient) {
      setGroups([])
      return
    }

    const update = () => setGroups([...marmotClient.groups])
    update()

    marmotClient.on('groupsUpdated', update)
    marmotClient.on('groupCreated', update)
    marmotClient.on('groupJoined', update)
    marmotClient.on('groupDestroyed', update)
    marmotClient.on('groupLeft', update)

    return () => {
      marmotClient.off('groupsUpdated', update)
      marmotClient.off('groupCreated', update)
      marmotClient.off('groupJoined', update)
      marmotClient.off('groupDestroyed', update)
      marmotClient.off('groupLeft', update)
    }
  }, [marmotClient])

  const handleNewGroup = () => {
    checkLogin(() => setCreateDialogOpen(true))
  }

  return (
    <PrimaryPageLayout
      ref={ref}
      pageName="messages"
      titlebar={
        <div className="flex items-center justify-between w-full pr-2">
          <span className="font-semibold">{t('Messages')}</span>
          <Button variant="ghost" size="icon" onClick={handleNewGroup}>
            <Plus className="size-5" />
          </Button>
        </div>
      }
    >
      {!pubkey ? (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-muted-foreground">
          <Lock className="size-10" />
          <p className="text-center text-sm">{t('Sign in to use encrypted group messaging')}</p>
        </div>
      ) : !isReady ? (
        <div className="flex items-center justify-center p-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 p-8 text-muted-foreground">
          <MessageSquare className="size-10" />
          <p className="text-center text-sm">
            {t('No encrypted groups yet. Create one or ask to be invited.')}
          </p>
          <Button variant="outline" size="sm" onClick={handleNewGroup}>
            <Plus className="mr-1 size-4" />
            {t('Create group')}
          </Button>
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {groups.map((group) => (
            <GroupRow
              key={group.idStr}
              group={group}
              currentPubkey={pubkey!}
              onClick={() => push(toMessageThread(group.idStr))}
            />
          ))}
        </div>
      )}

      {marmotClient && (
        <CreateGroupDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          marmotClient={marmotClient}
        />
      )}
    </PrimaryPageLayout>
  )
})
MessagesPage.displayName = 'MessagesPage'
export default MessagesPage

function GroupRow({
  group,
  currentPubkey,
  onClick
}: {
  group: MarmotGroup<GroupHistory>
  currentPubkey: string
  onClick: () => void
}) {
  const members = getGroupMembers(group.state)
  const otherPubkey = members.length === 2 ? members.find((m) => m !== currentPubkey) ?? null : null

  if (otherPubkey) {
    return (
      <button
        className="clickable flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={onClick}
      >
        <SimpleUserAvatar userId={otherPubkey} size="normal" />
        <SimpleUsername userId={otherPubkey} className="font-medium" />
      </button>
    )
  }

  const groupData = extractMarmotGroupData(group.state)
  const memberCount = getMemberCount(group.state)
  const name = groupData?.name || 'Unnamed group'

  return (
    <button
      className="clickable flex w-full items-center gap-3 px-4 py-3 text-left"
      onClick={onClick}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <MessageSquare className="size-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        {groupData?.description && (
          <p className="truncate text-sm text-muted-foreground">{groupData.description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Users className="size-3" />
        {memberCount}
      </div>
    </button>
  )
}
