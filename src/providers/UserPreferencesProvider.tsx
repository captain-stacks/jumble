import storage from '@/services/local-storage.service'
import { TEmoji, TNotificationStyle } from '@/types'
import { createContext, useContext, useEffect, useState } from 'react'
import { useScreenSize } from './ScreenSizeProvider'

type TUserPreferencesContext = {
  notificationListStyle: TNotificationStyle
  updateNotificationListStyle: (style: TNotificationStyle) => void

  muteMedia: boolean
  updateMuteMedia: (mute: boolean) => void

  sidebarCollapse: boolean
  updateSidebarCollapse: (collapse: boolean) => void

  enableSingleColumnLayout: boolean
  updateEnableSingleColumnLayout: (enable: boolean) => void

  quickReaction: boolean
  updateQuickReaction: (enable: boolean) => void

  quickReactionEmoji: string | TEmoji
  updateQuickReactionEmoji: (emoji: string | TEmoji) => void

  disableReactions: boolean
  updateDisableReactions: (disable: boolean) => void

  hideBookmarks: boolean
  updateHideBookmarks: (hide: boolean) => void

  satsToBitcoins: boolean
  updateSatsToBitcoins: (value: boolean) => void

  hideRelayExplore: boolean
  updateHideRelayExplore: (value: boolean) => void

  enableAiAgent: boolean
  updateEnableAiAgent: (value: boolean) => void

  disableSpecialFollowFeatures: boolean
  updateDisableSpecialFollowFeatures: (value: boolean) => void
}

const UserPreferencesContext = createContext<TUserPreferencesContext | undefined>(undefined)

export const useUserPreferences = () => {
  const context = useContext(UserPreferencesContext)
  if (!context) {
    throw new Error('useUserPreferences must be used within a UserPreferencesProvider')
  }
  return context
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const { isSmallScreen } = useScreenSize()
  const [notificationListStyle, setNotificationListStyle] = useState(
    storage.getNotificationListStyle()
  )
  const [muteMedia, setMuteMedia] = useState(true)
  const [sidebarCollapse, setSidebarCollapse] = useState(storage.getSidebarCollapse())
  const [enableSingleColumnLayout, setEnableSingleColumnLayout] = useState(
    storage.getEnableSingleColumnLayout()
  )
  const [quickReaction, setQuickReaction] = useState(storage.getQuickReaction())
  const [quickReactionEmoji, setQuickReactionEmoji] = useState(storage.getQuickReactionEmoji())
  const [disableReactions, setDisableReactions] = useState(storage.getDisableReactions())
  const [hideBookmarks, setHideBookmarks] = useState(storage.getHideBookmarks())
  const [satsToBitcoins, setSatsToBitcoins] = useState(storage.getSatsToBitcoins())
  const [hideRelayExplore, setHideRelayExplore] = useState(storage.getHideRelayExplore())
  const [enableAiAgent, setEnableAiAgent] = useState(storage.getEnableAiAgent())
  const [disableSpecialFollowFeatures, setDisableSpecialFollowFeatures] = useState(
    storage.getDisableSpecialFollowFeatures()
  )

  useEffect(() => {
    if (!isSmallScreen && enableSingleColumnLayout) {
      document.documentElement.style.setProperty('overflow-y', 'scroll')
    } else {
      document.documentElement.style.removeProperty('overflow-y')
    }
  }, [enableSingleColumnLayout, isSmallScreen])

  const updateNotificationListStyle = (style: TNotificationStyle) => {
    setNotificationListStyle(style)
    storage.setNotificationListStyle(style)
  }

  const updateSidebarCollapse = (collapse: boolean) => {
    setSidebarCollapse(collapse)
    storage.setSidebarCollapse(collapse)
  }

  const updateEnableSingleColumnLayout = (enable: boolean) => {
    setEnableSingleColumnLayout(enable)
    storage.setEnableSingleColumnLayout(enable)
  }

  const updateQuickReaction = (enable: boolean) => {
    setQuickReaction(enable)
    storage.setQuickReaction(enable)
  }

  const updateQuickReactionEmoji = (emoji: string | TEmoji) => {
    setQuickReactionEmoji(emoji)
    storage.setQuickReactionEmoji(emoji)
  }

  const updateDisableReactions = (disable: boolean) => {
    setDisableReactions(disable)
    storage.setDisableReactions(disable)
  }

  const updateHideBookmarks = (hide: boolean) => {
    setHideBookmarks(hide)
    storage.setHideBookmarks(hide)
  }

  const updateSatsToBitcoins = (value: boolean) => {
    setSatsToBitcoins(value)
    storage.setSatsToBitcoins(value)
  }

  const updateHideRelayExplore = (value: boolean) => {
    setHideRelayExplore(value)
    storage.setHideRelayExplore(value)
  }

  const updateEnableAiAgent = (value: boolean) => {
    setEnableAiAgent(value)
    storage.setEnableAiAgent(value)
  }

  const updateDisableSpecialFollowFeatures = (value: boolean) => {
    setDisableSpecialFollowFeatures(value)
    storage.setDisableSpecialFollowFeatures(value)
  }

  return (
    <UserPreferencesContext.Provider
      value={{
        notificationListStyle,
        updateNotificationListStyle,
        muteMedia,
        updateMuteMedia: setMuteMedia,
        sidebarCollapse,
        updateSidebarCollapse,
        enableSingleColumnLayout: isSmallScreen ? true : enableSingleColumnLayout,
        updateEnableSingleColumnLayout,
        quickReaction,
        updateQuickReaction,
        quickReactionEmoji,
        updateQuickReactionEmoji,
        disableReactions,
        updateDisableReactions,
        hideBookmarks,
        updateHideBookmarks,
        satsToBitcoins,
        updateSatsToBitcoins,
        hideRelayExplore,
        updateHideRelayExplore,
        enableAiAgent,
        updateEnableAiAgent,
        disableSpecialFollowFeatures,
        updateDisableSpecialFollowFeatures
      }}
    >
      {children}
    </UserPreferencesContext.Provider>
  )
}
