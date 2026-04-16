import { usePrimaryPage } from '@/PageManager'
import { MessageSquare } from 'lucide-react'
import BottomNavigationBarItem from './BottomNavigationBarItem'

export default function MessagesButton() {
  const { navigate, current, display } = usePrimaryPage()

  return (
    <BottomNavigationBarItem
      active={current === 'messages' && display}
      onClick={() => navigate('messages')}
    >
      <MessageSquare />
    </BottomNavigationBarItem>
  )
}
