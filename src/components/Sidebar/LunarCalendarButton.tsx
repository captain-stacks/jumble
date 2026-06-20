import { usePrimaryPage } from '@/PageManager'
import { MoonIcon } from 'lucide-react'
import SidebarItem from './SidebarItem'

export default function LunarCalendarButton({ collapse }: { collapse: boolean }) {
  const { navigate } = usePrimaryPage()

  return (
    <SidebarItem title="Lunar Calendar" onClick={() => navigate('lunarCalendar')} collapse={collapse}>
      <MoonIcon />
    </SidebarItem>
  )
}
