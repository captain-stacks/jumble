import PostEditor from '@/components/PostEditor'
import { DEFAULT_RELAY_URL } from '@/constants'
import { cn } from '@/lib/utils'
import { useFeed } from '@/providers/FeedProvider'
import { useNostr } from '@/providers/NostrProvider'
import { PencilLine } from 'lucide-react'
import { useMemo, useState } from 'react'
import SidebarItem from './SidebarItem'

export default function PostButton({ collapse }: { collapse: boolean }) {
  const { checkLogin } = useNostr()
  const { feedInfo } = useFeed()
  const [open, setOpen] = useState(false)
  const openFrom = useMemo(
    () =>
      feedInfo?.feedType === 'relay' && feedInfo.id === DEFAULT_RELAY_URL
        ? [DEFAULT_RELAY_URL]
        : undefined,
    [feedInfo?.feedType, feedInfo?.id]
  )

  return (
    <div className="pt-4">
      <SidebarItem
        title="New post"
        description="Post"
        onClick={(e) => {
          e.stopPropagation()
          checkLogin(() => {
            setOpen(true)
          })
        }}
        variant="default"
        className={cn('bg-primary gap-2', !collapse && 'justify-center')}
        collapse={collapse}
      >
        <PencilLine />
      </SidebarItem>
      <PostEditor open={open} setOpen={setOpen} openFrom={openFrom} />
    </div>
  )
}
