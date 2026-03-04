import { SecondaryPageLink } from '@/PageManager'
import { toNote, toProfile } from '@/lib/link'
import { Event } from 'nostr-tools'
import { useMemo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import ImageWithLightbox from '../ImageWithLightbox'
import NostrNode from '../Note/LongFormArticle/NostrNode'
import { remarkNostr } from '../Note/LongFormArticle/remarkNostr'
import { Components } from '../Note/LongFormArticle/types'

export default function MarkdownContent({
  content,
  event
}: {
  content: string
  event?: Event
}) {
  const components = useMemo(
    () =>
      ({
        nostr: ({ rawText, bech32Id }) => <NostrNode rawText={rawText} bech32Id={bech32Id} />,
        a: ({ href, children }) => {
          if (!href) return <span>{children}</span>
          if (href.startsWith('note1') || href.startsWith('nevent1') || href.startsWith('naddr1')) {
            return (
              <SecondaryPageLink to={toNote(href)} className="text-primary hover:underline">
                {children}
              </SecondaryPageLink>
            )
          }
          if (href.startsWith('npub1') || href.startsWith('nprofile1')) {
            return (
              <SecondaryPageLink to={toProfile(href)} className="text-primary hover:underline">
                {children}
              </SecondaryPageLink>
            )
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {children}
            </a>
          )
        },
        h1: ({ children }) => <p className="font-bold">{children}</p>,
        h2: ({ children }) => <p className="font-bold">{children}</p>,
        h3: ({ children }) => <p className="font-bold">{children}</p>,
        h4: ({ children }) => <p className="font-bold">{children}</p>,
        h5: ({ children }) => <p className="font-bold">{children}</p>,
        h6: ({ children }) => <p className="font-bold">{children}</p>,
        p: ({ children }) => <p>{children}</p>,
        img: ({ src }) => (
          <ImageWithLightbox
            image={{ url: src || '', pubkey: event?.pubkey }}
            className="max-h-[80vh] object-contain sm:max-h-[50vh]"
            classNames={{ wrapper: 'w-fit max-w-full mt-2' }}
          />
        ),
        pre: ({ children }) => (
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-sm">{children}</pre>
        ),
        code: ({ children, className }) => {
          // If inside a <pre>, render as block code (className contains language info)
          if (className) {
            return <code className="whitespace-pre-wrap break-words">{children}</code>
          }
          return <code className="rounded bg-muted px-1 py-0.5 text-sm">{children}</code>
        },
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground">
            {children}
          </blockquote>
        ),
        ul: ({ children }) => <ul className="list-disc pl-5">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        table: ({ children }) => (
          <div className="overflow-x-auto">
            <table className="border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="whitespace-nowrap border border-border bg-muted px-3 py-1.5 text-left font-semibold">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="whitespace-nowrap border border-border px-3 py-1.5">{children}</td>
        ),
        hr: () => <hr className="border-border" />
      }) as Components,
    [event?.pubkey]
  )

  return (
    <div className="space-y-3">
      <Markdown
        remarkPlugins={[remarkGfm, remarkNostr]}
        urlTransform={(url) => {
          if (url.startsWith('nostr:')) {
            return url.slice(6)
          }
          return url
        }}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  )
}
