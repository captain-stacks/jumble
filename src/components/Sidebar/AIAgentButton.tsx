import { toAIAgent } from '@/lib/link'
import { useSecondaryPage } from '@/PageManager'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import SidebarItem from './SidebarItem'

export default function AIAgentButton({ collapse }: { collapse: boolean }) {
  const { t } = useTranslation()
  const { push } = useSecondaryPage()

  return (
    <SidebarItem title={t('AI Agent')} onClick={() => push(toAIAgent())} collapse={collapse}>
      <Bot />
    </SidebarItem>
  )
}
