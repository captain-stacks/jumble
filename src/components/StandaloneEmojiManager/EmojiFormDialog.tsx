import Image from '@/components/Image'
import Uploader from '@/components/PostEditor/Uploader'
import ResponsiveDialog from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { normalizeShortcode, validateEmojiUrl, validateShortcode } from '@/lib/emoji'
import { cn } from '@/lib/utils'
import { useEmojiPack } from '@/providers/EmojiPackProvider'
import { TEmoji } from '@/types'
import { ImagePlus, Loader } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function EmojiFormDialog({
  open,
  onOpenChange,
  initial,
  existing
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial?: TEmoji
  existing: TEmoji[]
}) {
  const { t } = useTranslation()
  const { addStandaloneEmoji, editStandaloneEmoji } = useEmojiPack()
  const isEditing = !!initial
  const [shortcode, setShortcode] = useState('')
  const [url, setUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setShortcode(initial?.shortcode ?? '')
      setUrl(initial?.url ?? '')
      setError('')
    }
  }, [open, initial])

  const save = async () => {
    const code = normalizeShortcode(shortcode)
    const trimmedUrl = url.trim()

    const shortcodeError = validateShortcode(code)
    if (shortcodeError) {
      setError(t(shortcodeError))
      return
    }
    const urlError = validateEmojiUrl(trimmedUrl)
    if (urlError) {
      setError(t(urlError))
      return
    }
    const duplicated = existing.some(
      (e) =>
        e.shortcode === code &&
        !(initial && e.shortcode === initial.shortcode && e.url === initial.url)
    )
    if (duplicated) {
      setError(t('Duplicate shortcode: {{shortcode}}', { shortcode: code }))
      return
    }

    setSaving(true)
    if (isEditing && initial) {
      await editStandaloneEmoji(initial, code)
    } else {
      await addStandaloneEmoji({ shortcode: code, url: trimmedUrl })
    }
    setSaving(false)
    onOpenChange(false)
  }

  const thumbnail = (
    <div
      className={cn(
        'group bg-muted/30 relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border',
        !isEditing && 'hover:bg-muted cursor-pointer'
      )}
      title={isEditing ? undefined : t('Upload')}
    >
      {uploading ? (
        <Loader className="text-muted-foreground size-5 animate-spin" />
      ) : url ? (
        <>
          <Image
            image={{ url }}
            className="size-12 object-contain"
            classNames={{ wrapper: 'size-12 border-none' }}
            hideIfError
          />
          {!isEditing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <ImagePlus className="size-5 text-white" />
            </div>
          )}
        </>
      ) : (
        <ImagePlus className="text-muted-foreground size-5" />
      )}
    </div>
  )

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <h3 className="mb-4 text-lg font-semibold">{isEditing ? t('Edit emoji') : t('Add emoji')}</h3>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {isEditing ? (
            thumbnail
          ) : (
            <Uploader
              className="shrink-0"
              accept="image/*"
              onUploadStart={() => setUploading(true)}
              onUploadEnd={() => setUploading(false)}
              onUploadSuccess={({ url }) => {
                setError('')
                setUrl(url)
                setUploading(false)
              }}
            >
              {thumbnail}
            </Uploader>
          )}
          <div className="grid flex-1 gap-2">
            <Label htmlFor="standalone-emoji-shortcode">{t('shortcode')}</Label>
            <Input
              id="standalone-emoji-shortcode"
              value={shortcode}
              placeholder="my_emoji"
              onChange={(e) => {
                setError('')
                setShortcode(e.target.value)
              }}
            />
          </div>
        </div>

        {!isEditing && (
          <div className="grid gap-2">
            <Label htmlFor="standalone-emoji-url">{t('Image URL')}</Label>
            <Input
              id="standalone-emoji-url"
              value={url}
              placeholder="https://..."
              onChange={(e) => {
                setError('')
                setUrl(e.target.value)
              }}
            />
          </div>
        )}

        {error && <div className="text-destructive text-sm">{error}</div>}

        <Button onClick={save} disabled={saving || uploading}>
          {saving ? <Loader className="animate-spin" /> : t('Save')}
        </Button>
      </div>
    </ResponsiveDialog>
  )
}
