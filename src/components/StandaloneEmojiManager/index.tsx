import Image from '@/components/Image'
import { Button } from '@/components/ui/button'
import { useEmojiCollections } from '@/components/ExpressionPicker/useEmojiCollections'
import { useEmojiPack } from '@/providers/EmojiPackProvider'
import { useNostr } from '@/providers/NostrProvider'
import { TEmoji } from '@/types'
import { Loader, Pencil, PlusIcon, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EmojiFormDialog from './EmojiFormDialog'

export default function StandaloneEmojiManager({ className }: { className?: string }) {
  const { t } = useTranslation()
  const { pubkey, checkLogin } = useNostr()
  const { standalone } = useEmojiCollections()
  const { removeStandaloneEmoji } = useEmojiPack()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TEmoji | undefined>(undefined)
  const [removingKey, setRemovingKey] = useState<string | null>(null)

  const openAdd = () =>
    checkLogin(() => {
      setEditing(undefined)
      setDialogOpen(true)
    })

  const openEdit = (emoji: TEmoji) =>
    checkLogin(() => {
      setEditing(emoji)
      setDialogOpen(true)
    })

  const handleRemove = (emoji: TEmoji) =>
    checkLogin(async () => {
      const key = `${emoji.shortcode}:${emoji.url}`
      setRemovingKey(key)
      await removeStandaloneEmoji(emoji)
      setRemovingKey(null)
    })

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-2xl font-semibold">{t('My emojis')}</h3>
        {pubkey && (
          <Button variant="outline" size="sm" onClick={openAdd} className="shrink-0">
            <PlusIcon className="me-1" />
            {t('Add emoji')}
          </Button>
        )}
      </div>

      {standalone.length === 0 ? (
        <div className="text-muted-foreground py-4 text-center text-sm">
          {t('No custom emojis yet')}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {standalone.map((emoji) => {
            const key = `${emoji.shortcode}:${emoji.url}`
            const removing = removingKey === key
            return (
              <div
                key={key}
                className="group relative flex w-20 flex-col items-center gap-1 rounded-md border p-2"
              >
                <Image
                  image={{ url: emoji.url }}
                  className="size-12 object-contain"
                  classNames={{ wrapper: 'size-12 flex items-center justify-center border-none' }}
                  hideIfError
                />
                <span className="text-muted-foreground w-full truncate text-center text-xs">
                  :{emoji.shortcode}:
                </span>
                <div className="absolute end-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    className="bg-background/80 text-muted-foreground hover:text-foreground rounded p-1"
                    onClick={() => openEdit(emoji)}
                    aria-label={t('Edit emoji')}
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    className="bg-background/80 text-muted-foreground hover:text-destructive rounded p-1"
                    onClick={() => handleRemove(emoji)}
                    disabled={removing}
                    aria-label={t('Remove')}
                  >
                    {removing ? (
                      <Loader className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <EmojiFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initial={editing}
        existing={standalone}
      />
    </div>
  )
}
