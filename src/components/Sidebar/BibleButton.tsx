import { usePrimaryPage } from '@/PageManager'
import { BookOpenIcon } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function BibleButton({ collapse }: { collapse: boolean }) {
  const { navigate } = usePrimaryPage()

  return (
    <SidebarItem title="Bible" onClick={() => navigate('bible')} collapse={collapse}>
      <BookOpenIcon />
    </SidebarItem>
  )
}
