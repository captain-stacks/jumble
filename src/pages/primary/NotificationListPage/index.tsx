import NotificationList from '@/components/NotificationList'
import { Button } from '@/components/ui/button'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { cn } from '@/lib/utils'
import { usePrimaryPage } from '@/PageManager'
import {
  NotificationUserPreferenceContext,
  useNotificationUserPreference
} from '@/providers/NotificationUserPreferenceProvider'
import localStorage from '@/services/local-storage.service'
import { TNotificationType, TPageRef } from '@/types'
import { Bell } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const NotificationListPage = forwardRef<TPageRef>((_, ref) => {
  const { current } = usePrimaryPage()
  const [hideIndirect, setHideIndirect] = useState(localStorage.getHideIndirectNotifications())
  const [notificationType, setNotificationType] = useState<TNotificationType>('all')
  const firstRenderRef = useRef(true)
  const notificationListRef = useRef<{ refresh: () => void }>(null)

  const showMuted = useMemo(() => notificationType === 'muted', [notificationType])

  useEffect(() => {
    if (current === 'notifications' && !firstRenderRef.current) {
      notificationListRef.current?.refresh()
    }
    firstRenderRef.current = false
  }, [current])

  const updateHideIndirect = useCallback(
    (enable: boolean) => {
      setHideIndirect(enable)
      localStorage.setHideIndirectNotifications(enable)
    },
    [setHideIndirect]
  )

  return (
    <NotificationUserPreferenceContext.Provider
      value={{
        hideIndirect,
        updateHideIndirect,
        showMuted
      }}
    >
      <PrimaryPageLayout
        ref={ref}
        pageName="notifications"
        titlebar={<NotificationListPageTitlebar />}
        displayScrollToTopButton
      >
        <NotificationList
          ref={notificationListRef}
          notificationType={notificationType}
          onNotificationTypeChange={setNotificationType}
        />
      </PrimaryPageLayout>
    </NotificationUserPreferenceContext.Provider>
  )
})
NotificationListPage.displayName = 'NotificationListPage'
export default NotificationListPage

function NotificationListPageTitlebar() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full items-center justify-between gap-2 pl-3">
      <div className="flex items-center gap-2">
        <Bell />
        <div className="text-lg font-semibold">{t('Notifications')}</div>
      </div>
      <HideUnrelatedNotificationsToggle />
    </div>
  )
}

function HideUnrelatedNotificationsToggle() {
  const { t } = useTranslation()
  const { hideIndirect, updateHideIndirect } = useNotificationUserPreference()

  return (
    <Button
      variant="ghost"
      className={cn(
        'h-10 shrink-0 rounded-xl px-3 [&_svg]:size-5',
        hideIndirect ? 'bg-muted/40 text-foreground' : 'text-muted-foreground'
      )}
      onClick={() => updateHideIndirect(!hideIndirect)}
    >
      {t('Hide indirect')}
    </Button>
  )
}
