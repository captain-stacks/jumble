import PostEditor from '@/components/PostEditor'
import { DEFAULT_RELAY_URL } from '@/constants'
import { useFeed } from '@/providers/FeedProvider'
import { useNostr } from '@/providers/NostrProvider'
import { PlusCircleIcon } from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function PostButton() {
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
    <>
      <BottomNavigationBarItem
        onClick={() => {
          checkLogin(() => {
            setOpen(true)
          })
        }}
      >
        <PlusCircleIcon weight="regular" className="size-7!" />
      </BottomNavigationBarItem>
      <PostEditor open={open} setOpen={setOpen} openFrom={openFrom} />
    </>
  )
}
