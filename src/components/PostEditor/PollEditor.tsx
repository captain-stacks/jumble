import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { normalizeUrl } from '@/lib/url'
import { TPollCreateData } from '@/types'
import dayjs from 'dayjs'
import { ChevronRight, Eraser, ListTodo, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { Dispatch, SetStateAction, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function PollEditor({
  pollCreateData,
  setPollCreateData,
  setIsPoll
}: {
  pollCreateData: TPollCreateData
  setPollCreateData: Dispatch<SetStateAction<TPollCreateData>>
  setIsPoll: Dispatch<SetStateAction<boolean>>
}) {
  const { t } = useTranslation()
  const [isMultipleChoice, setIsMultipleChoice] = useState(pollCreateData.isMultipleChoice)
  const [options, setOptions] = useState(pollCreateData.options)
  const [endsAt, setEndsAt] = useState(
    pollCreateData.endsAt ? dayjs(pollCreateData.endsAt * 1000).format('YYYY-MM-DDTHH:mm') : ''
  )
  const [relayUrls, setRelayUrls] = useState(pollCreateData.relays.join(', '))
  const [showAdvanced, setShowAdvanced] = useState(pollCreateData.relays.length > 0)

  useEffect(() => {
    setPollCreateData({
      isMultipleChoice,
      options,
      endsAt: endsAt ? dayjs(endsAt).startOf('minute').unix() : undefined,
      relays: relayUrls
        ? relayUrls
            .split(',')
            .map((url) => normalizeUrl(url.trim()))
            .filter(Boolean)
        : []
    })
  }, [isMultipleChoice, options, endsAt, relayUrls])

  const handleAddOption = () => {
    setOptions([...options, ''])
  }

  const handleRemoveOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index))
    }
  }

  const handleOptionChange = (index: number, value: string) => {
    const newOptions = [...options]
    newOptions[index] = value
    setOptions(newOptions)
  }

  return (
    <div className="bg-muted/10 space-y-5 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ListTodo className="text-primary size-4" />
          <span>{t('Poll')}</span>
        </div>
        <Button
          type="button"
          variant="ghost-destructive"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => setIsPoll(false)}
        >
          <Trash2 />
          {t('Remove poll')}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-muted-foreground text-xs font-medium">{t('Options')}</div>
        {options.map((option, index) => (
          <div key={index} className="group relative">
            <div className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 flex items-center text-xs font-medium tabular-nums">
              {index + 1}.
            </div>
            <Input
              value={option}
              onChange={(e) => handleOptionChange(index, e.target.value)}
              placeholder={t('Option {{number}}', { number: index + 1 })}
              className="ps-9 pe-10"
              maxLength={200}
            />
            {options.length > 2 && (
              <button
                type="button"
                onClick={() => handleRemoveOption(index)}
                title={t('Remove')}
                className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive absolute inset-y-0 end-2 my-auto flex h-7 w-7 items-center justify-center rounded-md opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={handleAddOption}
          className="border-input bg-background text-muted-foreground hover:border-ring/50 hover:bg-accent/40 hover:text-foreground flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm transition-all duration-200"
        >
          <Plus className="size-4" />
          {t('Add Option')}
        </button>
      </div>

      <div className="bg-background overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <Label htmlFor="multiple-choice" className="cursor-pointer text-sm">
            {t('Allow multiple choices')}
          </Label>
          <Switch
            id="multiple-choice"
            checked={isMultipleChoice}
            onCheckedChange={setIsMultipleChoice}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-3 px-3 py-2.5">
          <Label htmlFor="ends-at" className="cursor-pointer text-sm">
            {t('End date')}
          </Label>
          <div className="flex items-center gap-1">
            <Input
              id="ends-at"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="h-8 w-auto text-sm"
            />
            {endsAt && (
              <button
                type="button"
                onClick={() => setEndsAt('')}
                title={t('Clear end date')}
                className="text-muted-foreground hover:bg-destructive/15 hover:text-destructive flex h-7 w-7 items-center justify-center rounded-md transition"
              >
                <Eraser className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium transition"
        >
          <ChevronRight
            className={cn(
              'size-3 transition-transform rtl:-scale-x-100',
              showAdvanced && 'rotate-90'
            )}
          />
          {t('Advanced options')}
        </button>
        {showAdvanced && (
          <div className="mt-2 grid gap-1.5">
            <Label htmlFor="relay-urls" className="text-muted-foreground text-xs">
              {t('Relay URLs (optional, comma-separated)')}
            </Label>
            <Input
              id="relay-urls"
              value={relayUrls}
              onChange={(e) => setRelayUrls(e.target.value)}
              placeholder="wss://relay1.com, wss://relay2.com"
              className="text-sm"
            />
          </div>
        )}
      </div>

      <div className="text-muted-foreground flex items-start gap-2 text-xs">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
        <span>{t('Polls may not display on clients that don’t support them.')}</span>
      </div>
    </div>
  )
}
