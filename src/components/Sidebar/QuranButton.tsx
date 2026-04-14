import { usePrimaryPage } from '@/PageManager'
import { BookOpenIcon } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function QuranButton({ collapse }: { collapse: boolean }) {
  const { navigate } = usePrimaryPage()

  return (
    <SidebarItem title="Quran" onClick={() => navigate('quran')} collapse={collapse}>
      <BookOpenIcon />
    </SidebarItem>
  )
}
