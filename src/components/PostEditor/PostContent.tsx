import Note from '@/components/Note'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useMuteList } from '@/providers/MuteListProvider'
import {
  createCommentDraftEvent,
  createHighlightDraftEvent,
  createPollDraftEvent,
  createShortTextNoteDraftEvent,
  deleteDraftEventCache
} from '@/lib/draft-event'
import { getDefaultRelayUrls } from '@/lib/relay'
import { isTouchDevice } from '@/lib/utils'
import { useNostr } from '@/providers/NostrProvider'
import postEditorCache from '@/services/post-editor-cache.service'
import threadService from '@/services/thread.service'
import { TPollCreateData } from '@/types'
import { CircleHelp, Check, ImageUp, Languages, ListTodo, LoaderCircle, Settings, Smile, SpellCheck, X } from 'lucide-react'
import { Event, kinds } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import EmojiPickerDialog from '../EmojiPickerDialog'
import Mentions from './Mentions'
import PollEditor from './PollEditor'
import PostOptions from './PostOptions'
import PostRelaySelector from './PostRelaySelector'
import PostTextarea, { TPostTextareaHandle } from './PostTextarea'
import Uploader from './Uploader'
import { formatError } from '@/lib/error'
import openaiService from '@/services/openai.service'

export default function PostContent({
  defaultContent = '',
  parentStuff,
  close,
  openFrom,
  highlightedText,
  pendingUpload
}: {
  defaultContent?: string
  parentStuff?: Event | string
  close: () => void
  openFrom?: string[]
  highlightedText?: string
  pendingUpload?: Promise<string>
}) {
  const { t } = useTranslation()
  const { pubkey, publish, checkLogin } = useNostr()
  const { mutePubkeySet } = useMuteList()
  const [text, setText] = useState('')
  const textareaRef = useRef<TPostTextareaHandle>(null)
  const [posting, setPosting] = useState(false)
  const [uploadProgresses, setUploadProgresses] = useState<
    { file: File; progress: number; cancel: () => void }[]
  >([])
  const parentEvent = useMemo(
    () => (parentStuff && typeof parentStuff !== 'string' ? parentStuff : undefined),
    [parentStuff]
  )
  const [showMoreOptions, setShowMoreOptions] = useState(false)
  const [addClientTag, setAddClientTag] = useState(true)
  const [mentions, setMentions] = useState<string[]>([])
  const [isNsfw, setIsNsfw] = useState(false)
  const [isPoll, setIsPoll] = useState(false)
  const [isProtectedEvent, setIsProtectedEvent] = useState(false)
  const [additionalRelayUrls, setAdditionalRelayUrls] = useState<string[]>([])
  const [pollCreateData, setPollCreateData] = useState<TPollCreateData>({
    isMultipleChoice: false,
    options: ['', ''],
    endsAt: undefined,
    relays: []
  })
  const [minPow, setMinPow] = useState(0)
  const [translatingReply, setTranslatingReply] = useState(false)
  const [translatedReplyLang, setTranslatedReplyLang] = useState<string | null>(null)
  const [proofreading, setProofreading] = useState(false)
  const [proofreadResult, setProofreadResult] = useState<string | null>(null)

  const [openaiReady, setOpenaiReady] = useState(() => openaiService.isInitialized())
  useEffect(() => {
    return openaiService.subscribe(() => setOpenaiReady(openaiService.isInitialized()))
  }, [])

  const [pendingUploading, setPendingUploading] = useState(false)
  useEffect(() => {
    if (!pendingUpload) return
    let cancelled = false
    setPendingUploading(true)
    pendingUpload.then((url) => {
      if (!cancelled) {
        textareaRef.current?.appendText(url, true)
        setPendingUploading(false)
      }
    }).catch(() => {
      if (!cancelled) setPendingUploading(false)
    })
    return () => { cancelled = true }
  }, [pendingUpload])

const showTranslateReplyButton = !!parentEvent && openaiReady

  const handleTranslateReply = async () => {
    if (!parentEvent || !text.trim() || translatingReply) return
    setTranslatingReply(true)
    try {
      const result = await openaiService.translateReply(text, parentEvent.content)
      // Only replace if target language isn't English
      if (result.targetLanguage.toLowerCase() !== 'english') {
        textareaRef.current?.replaceText(result.translated)
        setTranslatedReplyLang(result.targetLanguage)
      }
    } catch (err) {
      toast.error('Translation failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setTranslatingReply(false)
    }
  }

  const handleProofread = async () => {
    if (!text.trim() || proofreading) return
    setProofreading(true)
    setProofreadResult(null)
    try {
      const { fixed } = await openaiService.proofread(text)
      setProofreadResult(fixed)
    } catch (err) {
      toast.error('Proofreading failed: ' + (err instanceof Error ? err.message : 'Unknown error'))
    } finally {
      setProofreading(false)
    }
  }

  const applyProofread = () => {
    if (!proofreadResult) return
    textareaRef.current?.replaceText(proofreadResult)
    setProofreadResult(null)
    if (pendingPostRef.current) {
      pendingPostRef.current = false
      doPost()
    }
  }

  const dismissProofread = () => {
    setProofreadResult(null)
    if (pendingPostRef.current) {
      pendingPostRef.current = false
      doPost()
    }
  }

  const userDismissedProtected = useRef(false)
  const handleProtectedSuggestionChange = useCallback((suggested: boolean) => {
    if (suggested && !userDismissedProtected.current) {
      setIsProtectedEvent(true)
    }
  }, [])
  const handleProtectedToggle = useCallback((checked: boolean) => {
    if (!checked) {
      userDismissedProtected.current = true
    }
    setIsProtectedEvent(checked)
  }, [])
  const isFirstRender = useRef(true)
  const canPost = useMemo(() => {
    return (
      !!pubkey &&
      (!!text || !!highlightedText) &&
      !posting &&
      !uploadProgresses.length &&
      (!isPoll || pollCreateData.options.filter((option) => !!option.trim()).length >= 2) &&
      (!isProtectedEvent || additionalRelayUrls.length > 0)
    )
  }, [
    pubkey,
    text,
    highlightedText,
    posting,
    uploadProgresses,
    isPoll,
    pollCreateData,
    isProtectedEvent,
    additionalRelayUrls
  ])

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      const cachedSettings = postEditorCache.getPostSettingsCache({
        defaultContent,
        parentStuff
      })
      if (cachedSettings) {
        setIsNsfw(cachedSettings.isNsfw ?? false)
        setIsPoll(cachedSettings.isPoll ?? false)
        setPollCreateData(
          cachedSettings.pollCreateData ?? {
            isMultipleChoice: false,
            options: ['', ''],
            endsAt: undefined,
            relays: []
          }
        )
        setAddClientTag(cachedSettings.addClientTag ?? false)
      }
      return
    }
    postEditorCache.setPostSettingsCache(
      { defaultContent, parentStuff },
      {
        isNsfw,
        isPoll,
        pollCreateData,
        addClientTag
      }
    )
  }, [defaultContent, parentStuff, isNsfw, isPoll, pollCreateData, addClientTag])

  const postingRef = useRef(false)
  const pendingPostRef = useRef(false)

  const post = async (e?: React.MouseEvent) => {
    e?.stopPropagation()
    checkLogin(async () => {
      if (!canPost || !pubkey || postingRef.current) return

      if (openaiReady && text.trim() && !pendingPostRef.current) {
        pendingPostRef.current = true
        setProofreading(true)
        setProofreadResult(null)
        try {
          const { fixed } = await openaiService.proofread(text)
          setProofreadResult(fixed)
        } catch {
          // proofreading failed, proceed with post
          pendingPostRef.current = false
          doPost()
        } finally {
          setProofreading(false)
        }
        return
      }

      pendingPostRef.current = false
      doPost()

    })
  }

  const doPost = () => {
    checkLogin(async () => {
      if (!canPost || !pubkey || postingRef.current) return
      postingRef.current = true
      setPosting(true)
      try {
        const draftEvent = await createDraftEvent({
          parentStuff,
          highlightedText,
          text,
          mentions,
          isPoll,
          pollCreateData,
          pubkey,
          addClientTag,
          isProtectedEvent,
          isNsfw
        })

        const _additionalRelayUrls = [...additionalRelayUrls]
        if (parentStuff && typeof parentStuff === 'string') {
          _additionalRelayUrls.push(...getDefaultRelayUrls())
        }

        const newEvent = await publish(draftEvent, {
          specifiedRelayUrls: isProtectedEvent ? additionalRelayUrls : undefined,
          additionalRelayUrls: isPoll ? pollCreateData.relays : _additionalRelayUrls,
          minPow
        })
        postEditorCache.clearPostCache({ defaultContent, parentStuff })
        deleteDraftEventCache(draftEvent)
        threadService.addRepliesToThread([newEvent])
        toast.success(t('Post successful'), { duration: 2000 })
        close()
      } catch (error) {
        const errors = formatError(error)
        errors.forEach((err) => {
          toast.error(`${t('Failed to post')}: ${err}`, { duration: 10_000 })
        })
      } finally {
        setPosting(false)
        postingRef.current = false
      }
    })
  }

  const handlePollToggle = () => {
    if (parentStuff) return

    setIsPoll((prev) => !prev)
  }

  const handleUploadStart = (file: File, cancel: () => void) => {
    setUploadProgresses((prev) => [...prev, { file, progress: 0, cancel }])
  }

  const handleUploadProgress = (file: File, progress: number) => {
    setUploadProgresses((prev) =>
      prev.map((item) => (item.file === file ? { ...item, progress } : item))
    )
  }

  const handleUploadEnd = (file: File) => {
    setUploadProgresses((prev) => prev.filter((item) => item.file !== file))
  }

  return (
    <div className="space-y-2">
      {parentEvent && (
        <ScrollArea className="flex max-h-48 flex-col overflow-y-auto rounded-lg border bg-muted/40">
          <div className="pointer-events-none p-2 sm:p-3">
            {highlightedText ? (
              <div className="flex gap-4">
                <div className="my-1 w-1 flex-shrink-0 rounded-md bg-primary/60" />
                <div className="whitespace-pre-line italic">{highlightedText}</div>
              </div>
            ) : (
              <Note size="small" event={parentEvent} hideParentNotePreview showMutedContent={mutePubkeySet.has(parentEvent.pubkey)} />
            )}
          </div>
        </ScrollArea>
      )}
      <PostTextarea
        ref={textareaRef}
        text={text}
        setText={setText}
        defaultContent={defaultContent}
        parentStuff={parentStuff}
        onSubmit={() => post()}
        className={isPoll ? 'min-h-20' : 'min-h-52'}
        onUploadStart={handleUploadStart}
        onUploadProgress={handleUploadProgress}
        onUploadEnd={handleUploadEnd}
        placeholder={highlightedText ? t('Write your thoughts about this highlight...') : undefined}
      />
      {proofreadResult !== null && (
        <ProofreadPanel
          original={text}
          fixed={proofreadResult}
          onApply={applyProofread}
          onDismiss={dismissProofread}
        />
      )}
      {isPoll && (
        <PollEditor
          pollCreateData={pollCreateData}
          setPollCreateData={setPollCreateData}
          setIsPoll={setIsPoll}
        />
      )}
      {uploadProgresses.length > 0 &&
        uploadProgresses.map(({ file, progress, cancel }, index) => (
          <div key={`${file.name}-${index}`} className="mt-2 flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-1 truncate text-xs text-muted-foreground">
                {file.name ?? t('Uploading...')}
              </div>
              <div className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width] duration-200 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                cancel?.()
                handleUploadEnd(file)
              }}
              className="text-muted-foreground hover:text-foreground"
              title={t('Cancel')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      {!isPoll && (
        <div className="flex items-center gap-3">
          <div className="min-w-0">
          <PostRelaySelector
            onProtectedSuggestionChange={handleProtectedSuggestionChange}
            setAdditionalRelayUrls={setAdditionalRelayUrls}
            parentEvent={parentEvent}
            openFrom={openFrom}
          />
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Switch
              id="protected-event"
              checked={isProtectedEvent}
              onCheckedChange={handleProtectedToggle}
            />
            <Label
              htmlFor="protected-event"
              className="cursor-pointer text-xs text-muted-foreground"
            >
              {t('Protected')}
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="flex shrink-0">
                  <CircleHelp className="!size-3.5 text-muted-foreground" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="text-sm">
                {t('Protected event hint')}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Uploader
            onUploadSuccess={({ url }) => {
              textareaRef.current?.appendText(url, true)
            }}
            onUploadStart={handleUploadStart}
            onUploadEnd={handleUploadEnd}
            onProgress={handleUploadProgress}
            accept="image/*,video/*,audio/*"
          >
            <Button variant="ghost" size="icon" disabled={pendingUploading}>
              {pendingUploading ? <LoaderCircle className="animate-spin" /> : <ImageUp />}
            </Button>
          </Uploader>
          {/* I'm not sure why, but after triggering the virtual keyboard,
              opening the emoji picker drawer causes an issue,
              the emoji I tap isn't the one that gets inserted. */}
          {!isTouchDevice() && (
            <EmojiPickerDialog
              onEmojiClick={(emoji) => {
                if (!emoji) return
                textareaRef.current?.insertEmoji(emoji)
              }}
            >
              <Button variant="ghost" size="icon">
                <Smile />
              </Button>
            </EmojiPickerDialog>
          )}
          {!parentStuff && (
            <Button
              variant="ghost"
              size="icon"
              title={t('Create Poll')}
              className={isPoll ? 'bg-accent' : ''}
              onClick={handlePollToggle}
            >
              <ListTodo />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={showMoreOptions ? 'bg-accent' : ''}
            onClick={() => setShowMoreOptions((pre) => !pre)}
          >
            <Settings />
          </Button>
          {showTranslateReplyButton && (
            <Button
              variant="ghost"
              size="icon"
              disabled={translatingReply || !text.trim()}
              onClick={handleTranslateReply}
              title={translatedReplyLang ? `Translated to ${translatedReplyLang}` : 'Translate reply to match original language'}
            >
              {translatingReply ? <LoaderCircle className="animate-spin" /> : <Languages className={translatedReplyLang ? 'text-pink-400' : ''} />}
            </Button>
          )}
          {openaiReady && (
            <Button
              variant="ghost"
              size="icon"
              disabled={proofreading || !text.trim()}
              onClick={handleProofread}
              title={t('Proofread')}
            >
              {proofreading ? <LoaderCircle className="animate-spin" /> : <SpellCheck className={proofreadResult !== null ? 'text-primary' : ''} />}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Mentions
            content={text}
            parentEvent={parentEvent}
            mentions={mentions}
            setMentions={setMentions}
          />
          <div className="flex items-center gap-2 max-sm:hidden">
            <Button
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation()
                close()
              }}
            >
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!canPost} onClick={post}>
              {posting && <LoaderCircle className="animate-spin" />}
              {parentStuff ? (highlightedText ? t('Publish Highlight') : t('Reply')) : t('Post')}
            </Button>
          </div>
        </div>
      </div>
      <PostOptions
        posting={posting}
        show={showMoreOptions}
        addClientTag={addClientTag}
        setAddClientTag={setAddClientTag}
        isNsfw={isNsfw}
        setIsNsfw={setIsNsfw}
        minPow={minPow}
        setMinPow={setMinPow}
      />
      <div className="flex items-center justify-around gap-2 sm:hidden">
        <Button
          className="w-full"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation()
            close()
          }}
        >
          {t('Cancel')}
        </Button>
        <Button className="w-full" type="submit" disabled={!canPost} onClick={post}>
          {posting && <LoaderCircle className="animate-spin" />}
          {parentStuff ? t('Reply') : t('Post')}
        </Button>
      </div>
    </div>
  )
}

type TDiffToken = { text: string; type: 'same' | 'added' | 'removed' }

function wordDiff(original: string, fixed: string): TDiffToken[] {
  const a = original.split(/(\s+)/)
  const b = fixed.split(/(\s+)/)

  // LCS table
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const tokens: TDiffToken[] = []
  let i = 0, j = 0
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      tokens.push({ text: a[i], type: 'same' })
      i++; j++
    } else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) {
      tokens.push({ text: b[j], type: 'added' })
      j++
    } else {
      tokens.push({ text: a[i], type: 'removed' })
      i++
    }
  }
  return tokens
}

function ProofreadPanel({
  original,
  fixed,
  onApply,
  onDismiss
}: {
  original: string
  fixed: string
  onApply: () => void
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const tokens = wordDiff(original, fixed)
  const hasChanges = tokens.some((t) => t.type !== 'same')

  return (
    <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{hasChanges ? t('Suggested corrections') : t('No mistakes found')}</span>
        <button type="button" onClick={onDismiss} className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {hasChanges && (
        <>
          <div className="leading-relaxed whitespace-pre-wrap break-words">
            {tokens.map((token, i) => {
              if (token.type === 'same') return <span key={i}>{token.text}</span>
              if (token.type === 'removed') return <span key={i} className="bg-red-500/20 text-red-600 dark:text-red-400 line-through">{token.text}</span>
              return <span key={i} className="bg-green-500/20 text-green-700 dark:text-green-400">{token.text}</span>
            })}
          </div>
          <Button size="sm" onClick={onApply} className="gap-1.5">
            <Check className="h-3.5 w-3.5" />
            {t('Apply')}
          </Button>
        </>
      )}
    </div>
  )
}

async function createDraftEvent({
  parentStuff,
  text,
  mentions,
  isPoll,
  pollCreateData,
  pubkey,
  addClientTag,
  isProtectedEvent,
  isNsfw,
  highlightedText
}: {
  parentStuff: Event | string | undefined
  text: string
  mentions: string[]
  isPoll: boolean
  pollCreateData: TPollCreateData
  pubkey: string
  addClientTag: boolean
  isProtectedEvent: boolean
  isNsfw: boolean
  highlightedText?: string
}) {
  const { parentEvent, externalContent } =
    typeof parentStuff === 'string'
      ? { parentEvent: undefined, externalContent: parentStuff }
      : { parentEvent: parentStuff, externalContent: undefined }

  if (highlightedText && parentEvent) {
    return createHighlightDraftEvent(highlightedText, text, parentEvent, mentions, {
      addClientTag,
      protectedEvent: isProtectedEvent,
      isNsfw
    })
  }

  if (parentStuff && (externalContent || parentEvent?.kind !== kinds.ShortTextNote)) {
    return await createCommentDraftEvent(text, parentStuff, mentions, {
      addClientTag,
      protectedEvent: isProtectedEvent,
      isNsfw
    })
  }

  if (isPoll) {
    return await createPollDraftEvent(pubkey, text, mentions, pollCreateData, {
      addClientTag,
      isNsfw
    })
  }

  return await createShortTextNoteDraftEvent(text, mentions, {
    parentEvent,
    addClientTag,
    protectedEvent: isProtectedEvent,
    isNsfw
  })
}
