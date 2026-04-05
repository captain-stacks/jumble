import { Button } from '@/components/ui/button'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { SPECIAL_TRUST_SCORE_FILTER_ID } from '@/constants'
import { useMuteList } from '@/providers/MuteListProvider'
import { EyeOff } from 'lucide-react'
import { Event } from 'nostr-tools'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import QuoteList from '../QuoteList'
import ReactionList from '../ReactionList'
import ReplyNoteList from '../ReplyNoteList'
import RepostList from '../RepostList'
import TrustScoreFilter from '../TrustScoreFilter'
import ZapList from '../ZapList'
import { Tabs, TTabValue } from './Tabs'

export default function NoteInteractions({ event }: { event: Event }) {
  const { t } = useTranslation()
  const [type, setType] = useState<TTabValue>('replies')
  const [showMutedReplies, setShowMutedReplies] = useState(false)
  const { mutePubkeySet } = useMuteList()
  const isAuthorMuted = mutePubkeySet.has(event.pubkey)

  let list
  switch (type) {
    case 'replies':
      list = <ReplyNoteList stuff={event} showMutedContent={isAuthorMuted || showMutedReplies} />
      break
    case 'quotes':
      list = <QuoteList stuff={event} />
      break
    case 'reactions':
      list = <ReactionList stuff={event} />
      break
    case 'reposts':
      list = <RepostList event={event} />
      break
    case 'zaps':
      list = <ZapList event={event} />
      break
    default:
      break
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <ScrollArea className="w-0 flex-1">
          <Tabs selectedTab={type} onTabChange={setType} />
          <ScrollBar orientation="horizontal" className="pointer-events-none opacity-0" />
        </ScrollArea>
        <Separator orientation="vertical" className="h-6" />
        {type === 'replies' && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className={showMutedReplies ? 'text-foreground' : 'text-muted-foreground'}
              title={showMutedReplies ? t('Hide muted replies') : t('Show muted replies')}
              onClick={() => setShowMutedReplies((v) => !v)}
            >
              <EyeOff className="!size-4" />
            </Button>
            <Separator orientation="vertical" className="h-6" />
          </>
        )}
        <TrustScoreFilter filterId={SPECIAL_TRUST_SCORE_FILTER_ID.INTERACTIONS} />
      </div>
      <Separator />
      {list}
    </>
  )
}
