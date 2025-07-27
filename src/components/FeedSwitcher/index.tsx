import { toRelaySettings } from '@/lib/link'
import { simplifyUrl } from '@/lib/url'
import { SecondaryPageLink } from '@/PageManager'
import { useFavoriteRelays } from '@/providers/FavoriteRelaysProvider'
import { useFeed } from '@/providers/FeedProvider'
import { useNostr } from '@/providers/NostrProvider'
import { BookmarkIcon, UsersRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import RelayIcon from '../RelayIcon'
import RelaySetCard from '../RelaySetCard'
import SaveRelayDropdownMenu from '../SaveRelayDropdownMenu'
import { useFeedAlgorithms } from '@/providers/FeedAlgorithmsProvider'

export default function FeedSwitcher({ close }: { close?: () => void }) {
  const { t } = useTranslation()
  const { pubkey } = useNostr()
  const { relaySets, favoriteRelays } = useFavoriteRelays()
  const { feedInfo, switchFeed, temporaryRelayUrls } = useFeed()
  const {
    postThreshold,
    setPostThreshold,
    inactivityThreshold,
    setInactivityThreshold,
  } = useFeedAlgorithms()

  return (
    <div className="flex gap-6">
      {/* Left: Feed Switcher List */}
      <div className="flex-1 min-w-[250px] space-y-4">
        {pubkey && (
          <FeedSwitcherItem
            isActive={feedInfo.feedType === 'following'}
            onClick={() => {
              if (!pubkey) return
              switchFeed('following', { pubkey })
              close?.()
            }}
          >
            <div className="flex gap-2 items-center">
              <div className="flex justify-center items-center w-6 h-6 shrink-0">
                <UsersRound className="size-4" />
              </div>
              <div>{t('Following')}</div>
            </div>
          </FeedSwitcherItem>
        )}

        {pubkey && (
          <FeedSwitcherItem
            isActive={feedInfo.feedType === 'bookmarks'}
            onClick={() => {
              if (!pubkey) return
              switchFeed('bookmarks', { pubkey })
              close?.()
            }}
          >
            <div className="flex gap-2 items-center">
              <div className="flex justify-center items-center w-6 h-6 shrink-0">
                <BookmarkIcon className="size-4" />
              </div>
              <div>{t('Bookmarks')}</div>
            </div>
          </FeedSwitcherItem>
        )}

        {pubkey && (
          <FeedSwitcherItem
            isActive={feedInfo.feedType === 'algo'}
            onClick={() => {
              if (!pubkey) return
              switchFeed('algo', { pubkey })
              close?.()
            }}
          >
            <div className="flex gap-2 items-center">
              <div className="flex justify-center items-center w-6 h-6 shrink-0">
              </div>
              <div>{t('algo')}</div>
            </div>
          </FeedSwitcherItem>
        )}

        {pubkey && (
          <FeedSwitcherItem
            isActive={feedInfo.feedType === 'notstr'}
            onClick={() => {
              if (!pubkey) return
              switchFeed('notstr', { pubkey })
              close?.()
            }}
          >
            <div className="flex gap-2 items-center">
              <div className="flex justify-center items-center w-6 h-6 shrink-0">
              </div>
              <div>{t('notstr')}</div>
            </div>
          </FeedSwitcherItem>
        )}

        {temporaryRelayUrls.length > 0 && (
          <FeedSwitcherItem
            key="temporary"
            isActive={feedInfo.feedType === 'temporary'}
            temporary
            onClick={() => {
              switchFeed('temporary')
              close?.()
            }}
            controls={<SaveRelayDropdownMenu urls={temporaryRelayUrls} />}
          >
            {temporaryRelayUrls.length === 1 ? simplifyUrl(temporaryRelayUrls[0]) : t('Temporary')}
          </FeedSwitcherItem>
        )}
        <div className="space-y-2">
          <div className="flex justify-end items-center text-sm">
            <SecondaryPageLink
              to={toRelaySettings()}
              className="text-primary font-semibold"
              onClick={() => close?.()}
            >
              {t('edit')}
            </SecondaryPageLink>
          </div>
          {relaySets
            .filter((set) => set.relayUrls.length > 0)
            .map((set) => (
              <RelaySetCard
                key={set.id}
                relaySet={set}
                select={feedInfo.feedType === 'relays' && set.id === feedInfo.id}
                onSelectChange={(select) => {
                  if (!select) return
                  switchFeed('relays', { activeRelaySetId: set.id })
                  close?.()
                }}
              />
            ))}
          {favoriteRelays.map((relay) => (
            <FeedSwitcherItem
              key={relay}
              isActive={feedInfo.feedType === 'relay' && feedInfo.id === relay}
              onClick={() => {
                switchFeed('relay', { relay })
                close?.()
              }}
            >
              <div className="flex gap-2 items-center w-full">
                <RelayIcon url={relay} />
                <div className="flex-1 w-0 truncate">{simplifyUrl(relay)}</div>
              </div>
            </FeedSwitcherItem>
          ))}
        </div>
      </div>
      {/* Right: Settings Area */}
      <div className="w-64 flex flex-col items-end gap-4">
        {/* Algo Settings Panel */}
        <div className="border rounded-lg p-4 w-full bg-muted">
          <div className="font-semibold mb-2">algo settings</div>
          <label className="block text-sm mb-1" htmlFor="postThresholdSlider">
            interaction threshold: <span className="font-bold">{postThreshold + 1}</span>
          </label>
          <input
            id="postThresholdSlider"
            type="range"
            min={0}
            max={9}
            step={1}
            value={postThreshold}
            onChange={e => setPostThreshold(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>show more notes</span>
            <span>show fewer notes</span>
          </div>
        </div>
        {/* Notstr Settings Panel */}
        <div className="border rounded-lg p-4 w-full bg-muted">
          <div className="font-semibold mb-2">notstr settings</div>
          <label className="block text-sm mb-1" htmlFor="notstrSettingSlider">
            show notes after days of inactivity: <span className="font-bold">{inactivityThreshold}</span>
          </label>
          <input
            id="notstrSettingSlider"
            type="range"
            min={1}
            max={30}
            step={1}
            value={inactivityThreshold}
            onChange={e => setInactivityThreshold(Number(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>show more notes</span>
            <span>show fewer notes</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function FeedSwitcherItem({
  children,
  isActive,
  temporary = false,
  onClick,
  controls
}: {
  children: React.ReactNode
  isActive: boolean
  temporary?: boolean
  onClick: () => void
  controls?: React.ReactNode
}) {
  return (
    <div
      className={`w-full border rounded-lg p-4 ${isActive ? 'border-primary bg-primary/5' : 'clickable'} ${temporary ? 'border-dashed' : ''}`}
      onClick={onClick}
    >
      <div className="flex justify-between items-center">
        <div className="font-semibold flex-1">{children}</div>
        {controls}
      </div>
    </div>
  )
}
