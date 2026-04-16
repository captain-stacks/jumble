import Content from '@/components/Content'
import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useMarmot } from '@/providers/MarmotProvider'
import { useNostr } from '@/providers/NostrProvider'
import {
  extractMarmotGroupData,
  getNostrGroupIdHex,
  getGroupMembers,
  getMediaAttachments,
  deserializeApplicationRumor
} from '@internet-privacy/marmot-ts'
import type { MarmotGroup, MediaAttachment } from '@internet-privacy/marmot-ts'
import type { GroupHistory } from '@/services/marmot-history.service'
import client from '@/services/client.service'
import { BlossomClient } from 'blossom-client-sdk'
import { ImagePlus, Send } from 'lucide-react'
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SimpleUserAvatar } from '@/components/UserAvatar'
import { SimpleUsername } from '@/components/Username'
import dayjs from 'dayjs'

type TMessage = {
  id: string
  pubkey: string
  content: string
  tags: string[][]
  createdAt: number
}

function rumorToMessage(bytes: Uint8Array): TMessage | null {
  try {
    const rumor = deserializeApplicationRumor(bytes)
    if (typeof rumor.content !== 'string') return null
    return {
      id: rumor.id,
      pubkey: rumor.pubkey,
      content: rumor.content,
      tags: rumor.tags ?? [],
      createdAt: rumor.created_at
    }
  } catch {
    return null
  }
}

function addMessage(prev: TMessage[], msg: TMessage): TMessage[] {
  if (prev.some((m) => m.id === msg.id)) return prev
  return [...prev, msg].sort((a, b) => a.createdAt - b.createdAt)
}

/** Builds a MIP-04 v2 imeta tag array from a fully-populated MediaAttachment. */
function buildMip04ImetaTag(attachment: MediaAttachment): string[] {
  const tag: string[] = ['imeta']
  if (attachment.url) tag.push(`url ${attachment.url}`)
  if (attachment.type) tag.push(`m ${attachment.type}`)
  tag.push(`x ${attachment.sha256}`)
  if (attachment.size !== undefined) tag.push(`size ${attachment.size}`)
  tag.push(`filename ${attachment.filename}`)
  tag.push(`n ${attachment.nonce}`)
  tag.push(`v ${attachment.version}`)
  if (attachment.dimensions) tag.push(`dim ${attachment.dimensions}`)
  if (attachment.blurhash) tag.push(`blurhash ${attachment.blurhash}`)
  if (attachment.alt) tag.push(`alt ${attachment.alt}`)
  return tag
}

const MessageThreadPage = forwardRef(({ groupId, index }: { groupId?: string; index?: number }, ref) => {
  const { t } = useTranslation()
  const { pubkey, signEvent } = useNostr()
  const { marmotClient, getHistory } = useMarmot()
  const [group, setGroup] = useState<MarmotGroup<GroupHistory> | null>(null)
  const [messages, setMessages] = useState<TMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<MarmotGroup<GroupHistory> | null>(null)
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    if (!groupId || !marmotClient) {
      setLoading(false)
      return
    }

    let cancelled = false

    const handleAppMessage = (bytes: Uint8Array) => {
      const msg = rumorToMessage(bytes)
      if (!msg) return
      setMessages((prev) => addMessage(prev, msg))
      setTimeout(scrollToBottom, 50)
    }

    const runIngest = async (g: MarmotGroup<GroupHistory>, events: Parameters<MarmotGroup<GroupHistory>['ingest']>[0]) => {
      for await (const _result of g.ingest(events)) {
        // applicationMessage events fire as a side-effect
      }
    }

    const load = async () => {
      try {
        const g = await marmotClient.getGroup(groupId)
        if (cancelled) return

        groupRef.current = g
        setGroup(g)
        g.on('applicationMessage', handleAppMessage)

        const history = getHistory(g.idStr)
        if (history) {
          const stored = await history.loadMessages()
          if (!cancelled) {
            const decoded = stored.flatMap((b) => {
              const m = rumorToMessage(b)
              return m ? [m] : []
            })
            if (decoded.length > 0) {
              setMessages(decoded.sort((a, b) => a.createdAt - b.createdAt))
            }
          }
        }

        const nostrGroupIdHex = getNostrGroupIdHex(g.state)
        const relays = g.relays ?? []

        if (relays.length > 0) {
          const sub = marmotClient.network.subscription(relays, {
            kinds: [445],
            '#h': [nostrGroupIdHex]
          })
          subscriptionRef.current = sub.subscribe({
            next: (event) => {
              runIngest(g, [event]).catch((err) =>
                console.warn('[Marmot] ingest error:', err)
              )
            }
          })

          try {
            const history = await marmotClient.network.request(relays, {
              kinds: [445],
              '#h': [nostrGroupIdHex],
              limit: 50
            })
            if (!cancelled && history.length > 0) {
              await runIngest(g, history)
            }
          } catch (err) {
            console.warn('[Marmot] fetch history error:', err)
          }
        }

        setLoading(false)
      } catch (err) {
        console.error('[Marmot] getGroup error:', err)
        if (!cancelled) setLoading(false)
      }
    }

    load()

    return () => {
      cancelled = true
      subscriptionRef.current?.unsubscribe()
      subscriptionRef.current = null
      groupRef.current?.off('applicationMessage', handleAppMessage)
      groupRef.current = null
    }
  }, [groupId, marmotClient])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async () => {
    if (!group || !input.trim() || sending) return
    const text = input.trim()
    setInput('')
    setSending(true)
    try {
      await group.sendChatMessage(text)
      if (pubkey) {
        const now = Math.floor(Date.now() / 1000)
        const msg: TMessage = {
          id: `sent-${Date.now()}`,
          pubkey,
          content: text,
          tags: [],
          createdAt: now
        }
        setMessages((prev) => addMessage(prev, msg))
        setTimeout(scrollToBottom, 50)
        const history = getHistory(group.idStr)
        if (history) {
          const bytes = new TextEncoder().encode(
            JSON.stringify({ id: msg.id, pubkey, content: text, created_at: now, kind: 9, tags: [] })
          )
          history.saveMessage(bytes).catch(() => {})
        }
      }
    } catch (err) {
      console.error('[Marmot] sendChatMessage error:', err)
      toast.error(t('Failed to send message'))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  const handleImageFile = async (file: File) => {
    if (!group || !pubkey) return
    setUploadingImage(true)
    try {
      // 1. Encrypt the image using the current MLS epoch key
      const { encrypted, attachment } = await group.encryptMedia(file, {
        filename: file.name,
        type: file.type,
        size: file.size
      })

      // 2. Upload the encrypted bytes to the user's Blossom server
      const servers = await client.fetchBlossomServerList(pubkey)
      if (servers.length === 0) throw new Error('No Blossom servers configured')
      const [mainServer] = servers
      const encryptedBlob = new File([encrypted], file.name, { type: 'application/octet-stream' })
      const blossomSigner = async (draft: Parameters<typeof signEvent>[0]) => signEvent(draft)
      const auth = await BlossomClient.createUploadAuth(blossomSigner, encryptedBlob, {
        message: 'Upload encrypted media'
      })
      const result = await BlossomClient.uploadBlob(mainServer, encryptedBlob, { auth })

      // 3. Attach the URL and build the MIP-04 imeta tag
      attachment.url = result.url
      const imetaTag = buildMip04ImetaTag(attachment)

      // 4. Send as a chat message with empty content and the imeta tag
      await group.sendChatMessage('', [imetaTag])

      // 5. Optimistic local state (self-echo suppressed by marmot)
      const now = Math.floor(Date.now() / 1000)
      const msg: TMessage = {
        id: `sent-img-${Date.now()}`,
        pubkey,
        content: '',
        tags: [imetaTag],
        createdAt: now
      }
      setMessages((prev) => addMessage(prev, msg))
      setTimeout(scrollToBottom, 50)
    } catch (err) {
      console.error('[Marmot] image send error:', err)
      toast.error(t('Failed to send image'))
    } finally {
      setUploadingImage(false)
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleImageFile(file)
    e.target.value = ''
  }

  const groupData = group ? extractMarmotGroupData(group.state) : null
  const members = group ? getGroupMembers(group.state) : []
  const otherPubkey = members.length === 2 ? members.find((m) => m !== pubkey) ?? null : null
  const groupName = otherPubkey ? undefined : (groupData?.name ?? t('Encrypted group'))

  return (
    <SecondaryPageLayout
      ref={ref}
      index={index}
      title={
        otherPubkey ? (
          <div className="flex items-center gap-2">
            <SimpleUserAvatar userId={otherPubkey} size="small" />
            <SimpleUsername userId={otherPubkey} />
          </div>
        ) : groupName
      }
    >
      <div className="flex flex-col h-full">
        {loading ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </div>
        ) : !group ? (
          <div className="flex flex-1 items-center justify-center p-8 text-muted-foreground text-sm">
            {t('Group not found')}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-8">
                  {t('No messages yet. Say hello!')}
                </p>
              )}
              {messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isOwn={msg.pubkey === pubkey}
                  group={group}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-border p-3 flex gap-2 items-end">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileInputChange}
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                disabled={uploadingImage || sending}
                onClick={() => fileInputRef.current?.click()}
                title={t('Send image')}
              >
                {uploadingImage ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <ImagePlus className="size-5" />
                )}
              </Button>
              <Textarea
                className="min-h-[40px] max-h-[120px] resize-none"
                placeholder={t('Message…')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                rows={1}
              />
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="shrink-0"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </SecondaryPageLayout>
  )
})
MessageThreadPage.displayName = 'MessageThreadPage'
export default MessageThreadPage

function MessageBubble({
  message,
  isOwn,
  group
}: {
  message: TMessage
  isOwn: boolean
  group: MarmotGroup<GroupHistory>
}) {
  const encryptedAttachments = getMediaAttachments(message.tags)

  // Strip encrypted blob URLs from content so Content doesn't try to render
  // them as plain images (they are ciphertext and would render broken)
  const encryptedUrls = new Set(encryptedAttachments.map((a) => a.url).filter(Boolean) as string[])
  const visibleContent = encryptedUrls.size > 0
    ? message.content
        .split('\n')
        .map((line) => (encryptedUrls.has(line.trim()) ? '' : line))
        .join('\n')
        .trim()
    : message.content

  return (
    <div className={`flex gap-2 ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
      {!isOwn && message.pubkey && (
        <div className="shrink-0 self-end">
          <SimpleUserAvatar userId={message.pubkey} size="small" />
        </div>
      )}
      <div className={`flex flex-col gap-1 max-w-[70%] ${isOwn ? 'items-end' : 'items-start'}`}>
        {!isOwn && message.pubkey && (
          <SimpleUsername
            className="text-xs text-muted-foreground px-1"
            userId={message.pubkey}
          />
        )}
        <div
          className={`rounded-2xl px-3 py-2 text-sm break-words ${
            isOwn
              ? 'bg-primary text-primary-foreground rounded-br-sm'
              : 'bg-muted rounded-bl-sm'
          }`}
        >
          {visibleContent && <Content content={visibleContent} mustLoadMedia />}
          {encryptedAttachments.map((attachment) => (
            <DecryptedImage key={attachment.sha256} attachment={attachment} group={group} />
          ))}
        </div>
        <span className="text-[10px] text-muted-foreground px-1">
          {dayjs.unix(message.createdAt).format('HH:mm')}
        </span>
      </div>
    </div>
  )
}

function DecryptedImage({
  attachment,
  group
}: {
  attachment: MediaAttachment
  group: MarmotGroup<GroupHistory>
}) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!attachment.url) {
      setError(true)
      return
    }

    let objectUrl: string | null = null
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(attachment.url!)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const encryptedBytes = new Uint8Array(await res.arrayBuffer())
        const { data } = await group.decryptMedia(encryptedBytes, attachment)
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([data], { type: attachment.type }))
        setSrc(objectUrl)
      } catch (err) {
        console.warn('[Marmot] Failed to decrypt media:', err)
        if (!cancelled) setError(true)
      }
    }

    load()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [attachment.sha256])

  if (error) {
    return <span className="text-xs opacity-60">[encrypted image]</span>
  }

  if (!src) {
    return (
      <div
        className="mt-2 rounded-lg bg-muted/50 animate-pulse"
        style={{ width: 160, height: 120 }}
      />
    )
  }

  return (
    <img
      src={src}
      alt={attachment.alt ?? attachment.filename}
      className="mt-2 max-w-full rounded-lg"
      style={{ maxHeight: 400 }}
    />
  )
}
