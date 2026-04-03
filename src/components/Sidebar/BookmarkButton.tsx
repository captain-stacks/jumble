import { usePrimaryPage } from '@/PageManager'
import { useNostr } from '@/providers/NostrProvider'
import { useUserPreferences } from '@/providers/UserPreferencesProvider'
import { Bookmark } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function BookmarkButton({ collapse }: { collapse: boolean }) {
  const { navigate, current, display } = usePrimaryPage()
  const { checkLogin } = useNostr()
  const { hideBookmarks } = useUserPreferences()

  if (hideBookmarks) return null

  return (
    <SidebarItem
      title="Bookmarks"
      onClick={() => checkLogin(() => navigate('bookmark'))}
      active={display && current === 'bookmark'}
      collapse={collapse}
    >
      <Bookmark />
    </SidebarItem>
  )
}
