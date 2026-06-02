import Image from '@/components/Image'
import Uploader from '@/components/PostEditor/Uploader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useFetchEvent } from '@/hooks'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { normalizeShortcode, validateEmojiUrl, validateShortcode } from '@/lib/emoji'
import { getEmojiPackInfoFromEvent } from '@/lib/event-metadata'
import { cn } from '@/lib/utils'
import { useSecondaryPage } from '@/PageManager'
import { useEmojiPack } from '@/providers/EmojiPackProvider'
import { useNostr } from '@/providers/NostrProvider'
import { useScreenSize } from '@/providers/ScreenSizeProvider'
import { ImagePlus, Loader, Plus, Trash2 } from 'lucide-react'
import { forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type TRow = { shortcode: string; url: string; uploading?: boolean }

const emptyRow = (): TRow => ({ shortcode: '', url: '' })

const EmojiSetEditorPage = forwardRef(({ id, index }: { id?: string; index?: number }, ref) => {
  const { t } = useTranslation()
  const { pop } = useSecondaryPage()
  const { isSmallScreen } = useScreenSize()
  const { pubkey } = useNostr()
  const { createEmojiSet, editEmojiSet } = useEmojiPack()
  const isEditing = !!id
  const { event, isFetching } = useFetchEvent(id)

  const [title, setTitle] = useState('')
  const [rows, setRows] = useState<TRow[]>([emptyRow()])
  const [prefilled, setPrefilled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isOwner = !isEditing || (!!event && !!pubkey && event.pubkey === pubkey)

  useEffect(() => {
    if (!isEditing || prefilled || !event) return
    const { title, emojis } = getEmojiPackInfoFromEvent(event)
    setTitle(title ?? '')
    setRows(
      emojis.length > 0 ? emojis.map((e) => ({ shortcode: e.shortcode, url: e.url })) : [emptyRow()]
    )
    setPrefilled(true)
  }, [isEditing, prefilled, event])

  const updateRow = (i: number, patch: Partial<TRow>) => {
    setError('')
    setRows((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))
  }

  const addRow = () => setRows((prev) => [...prev, emptyRow()])

  const removeRow = (i: number) =>
    setRows((prev) => (prev.length === 1 ? [emptyRow()] : prev.filter((_, idx) => idx !== i)))

  const canSave = useMemo(
    () => title.trim().length > 0 && rows.some((r) => r.shortcode && r.url),
    [title, rows]
  )

  const save = async () => {
    const cleaned = rows
      .map((r) => ({ shortcode: normalizeShortcode(r.shortcode), url: r.url.trim() }))
      .filter((r) => r.shortcode || r.url)

    if (!title.trim()) {
      setError(t('Title is required'))
      return
    }
    if (cleaned.length === 0) {
      setError(t('At least one emoji is required'))
      return
    }
    const seen = new Set<string>()
    for (const r of cleaned) {
      const shortcodeError = validateShortcode(r.shortcode)
      if (shortcodeError) {
        setError(t(shortcodeError))
        return
      }
      const urlError = validateEmojiUrl(r.url)
      if (urlError) {
        setError(t(urlError))
        return
      }
      if (seen.has(r.shortcode)) {
        setError(t('Duplicate shortcode: {{shortcode}}', { shortcode: r.shortcode }))
        return
      }
      seen.add(r.shortcode)
    }

    setSaving(true)
    const result =
      isEditing && event
        ? await editEmojiSet(event, title.trim(), cleaned)
        : await createEmojiSet(title.trim(), cleaned)
    setSaving(false)
    if (result) pop()
  }

  const controls = (
    <div className="pe-3">
      <Button className="rounded-full" onClick={save} disabled={saving || !canSave}>
        {saving ? <Loader className="animate-spin" /> : t('Save')}
      </Button>
    </div>
  )

  const pageTitle = isEditing ? t('Edit emoji set') : t('Create emoji set')

  if (isEditing && isFetching) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={pageTitle}>
        <div className="flex justify-center py-8">
          <Loader className="animate-spin" />
        </div>
      </SecondaryPageLayout>
    )
  }

  if (isEditing && (!event || !isOwner)) {
    return (
      <SecondaryPageLayout ref={ref} index={index} title={pageTitle}>
        <div className="text-muted-foreground p-4 text-center">
          {!event ? t('Emoji set not found') : t('You can only edit your own emoji sets')}
        </div>
      </SecondaryPageLayout>
    )
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={pageTitle} controls={controls}>
      <div className="flex flex-col gap-4 px-4 py-3">
        <div className="grid gap-2">
          <Label htmlFor="emoji-set-title">{t('Title')}</Label>
          <Input
            id="emoji-set-title"
            value={title}
            placeholder={t('My emoji set')}
            onChange={(e) => {
              setError('')
              setTitle(e.target.value)
            }}
          />
        </div>

        <div className="grid gap-2">
          <Label>{t('Emojis')}</Label>
          <div className="flex flex-col gap-3">
            {rows.map((row, i) => (
              <div
                key={i}
                className={cn('flex gap-2', isSmallScreen ? 'items-start' : 'items-center')}
              >
                <Uploader
                  className="shrink-0"
                  accept="image/*"
                  onUploadStart={() => updateRow(i, { uploading: true })}
                  onUploadEnd={() => updateRow(i, { uploading: false })}
                  onUploadSuccess={({ url }) => updateRow(i, { url, uploading: false })}
                >
                  <div
                    className="group bg-muted/30 hover:bg-muted relative flex size-10 cursor-pointer items-center justify-center overflow-hidden rounded-md border"
                    title={t('Upload')}
                  >
                    {row.uploading ? (
                      <Loader className="text-muted-foreground size-4 animate-spin" />
                    ) : row.url ? (
                      <>
                        <Image
                          image={{ url: row.url }}
                          className="size-9 object-contain"
                          classNames={{ wrapper: 'size-9 border-none' }}
                          hideIfError
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <ImagePlus className="size-4 text-white" />
                        </div>
                      </>
                    ) : (
                      <ImagePlus className="text-muted-foreground size-5" />
                    )}
                  </div>
                </Uploader>
                <div
                  className={cn(
                    'flex min-w-0 flex-1 gap-2',
                    isSmallScreen ? 'flex-col' : 'flex-row items-center'
                  )}
                >
                  <Input
                    value={row.shortcode}
                    placeholder={t('shortcode')}
                    className={cn('min-w-0', isSmallScreen ? '' : 'w-40 shrink-0')}
                    onChange={(e) => updateRow(i, { shortcode: e.target.value })}
                  />
                  <Input
                    value={row.url}
                    placeholder="https://..."
                    className="min-w-0 flex-1"
                    onChange={(e) => updateRow(i, { url: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground shrink-0"
                  onClick={() => removeRow(i)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" className="w-fit" onClick={addRow}>
            <Plus className="me-1 size-4" />
            {t('Add emoji')}
          </Button>
        </div>

        {error && <div className="text-destructive text-sm">{error}</div>}
      </div>
    </SecondaryPageLayout>
  )
})
EmojiSetEditorPage.displayName = 'EmojiSetEditorPage'
export default EmojiSetEditorPage
