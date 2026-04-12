import PostEditor from '@/components/PostEditor'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { useNostr } from '@/providers/NostrProvider'
import mediaUpload from '@/services/media-upload.service'
import openaiService from '@/services/openai.service'
import { TPageRef } from '@/types'
import { BookOpenIcon, PencilLineIcon, RefreshCwIcon, SearchIcon, SparklesIcon, XIcon } from 'lucide-react'
import { forwardRef, useRef, useState } from 'react'

const BIBLE_VERSES = [
  { reference: 'John 3:16', text: 'For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.' },
  { reference: 'Psalm 23:1', text: 'The LORD is my shepherd, I lack nothing.' },
  { reference: 'Genesis 1:1', text: 'In the beginning God created the heavens and the earth.' },
  { reference: 'Romans 8:28', text: 'And we know that in all things God works for the good of those who love him, who have been called according to his purpose.' },
  { reference: 'Philippians 4:13', text: 'I can do all this through him who gives me strength.' },
  { reference: 'Jeremiah 29:11', text: 'For I know the plans I have for you, declares the LORD, plans to prosper you and not to harm you, plans to give you hope and a future.' },
  { reference: 'Isaiah 40:31', text: 'But those who hope in the LORD will renew their strength. They will soar on wings like eagles; they will run and not grow weary, they will walk and not be faint.' },
  { reference: 'Proverbs 3:5-6', text: 'Trust in the LORD with all your heart and lean not on your own understanding; in all your ways submit to him, and he will make your paths straight.' },
  { reference: 'Matthew 5:3', text: 'Blessed are the poor in spirit, for theirs is the kingdom of heaven.' },
  { reference: 'Psalm 46:1', text: 'God is our refuge and strength, an ever-present help in trouble.' },
  { reference: 'Romans 6:23', text: 'For the wages of sin is death, but the gift of God is eternal life in Christ Jesus our Lord.' },
  { reference: 'Matthew 11:28', text: 'Come to me, all you who are weary and burdened, and I will give you rest.' },
  { reference: '1 Corinthians 13:4-5', text: 'Love is patient, love is kind. It does not envy, it does not boast, it is not proud. It does not dishonor others, it is not self-seeking.' },
  { reference: 'Revelation 21:4', text: 'He will wipe every tear from their eyes. There will be no more death or mourning or crying or pain, for the old order of things has passed away.' },
  { reference: 'Micah 6:8', text: 'He has shown you, O mortal, what is good. And what does the LORD require of you? To act justly and to love mercy and to walk humbly with your God.' },
  { reference: 'Joshua 1:9', text: 'Have I not commanded you? Be strong and courageous. Do not be afraid; do not be discouraged, for the LORD your God will be with you wherever you go.' },
  { reference: 'Psalm 121:1-2', text: 'I lift up my eyes to the mountains — where does my help come from? My help comes from the LORD, the Maker of heaven and earth.' },
  { reference: 'John 14:6', text: 'Jesus answered, "I am the way and the truth and the life. No one comes to the Father except through me."' },
  { reference: 'Galatians 5:22-23', text: 'But the fruit of the Spirit is love, joy, peace, forbearance, kindness, goodness, faithfulness, gentleness and self-control.' },
  { reference: 'Deuteronomy 31:6', text: 'Be strong and courageous. Do not be afraid or terrified because of them, for the LORD your God goes with you; he will never leave you nor forsake you.' }
]

function randomVerse() {
  return BIBLE_VERSES[Math.floor(Math.random() * BIBLE_VERSES.length)]
}

const BiblePage = forwardRef<TPageRef>((_, ref) => {
  const { checkLogin } = useNostr()
  const [verse, setVerse] = useState(randomVerse)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageBlob, setImageBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [postOpen, setPostOpen] = useState(false)
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null)
  const [pendingUpload, setPendingUpload] = useState<Promise<string> | undefined>(undefined)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ reference: string; text: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim() || searching) return
    setSearching(true)
    setSearchError(null)
    setSearchResults([])
    try {
      const results = await openaiService.searchBibleVerses(searchQuery.trim())
      setSearchResults(results)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  const handleSelectVerse = (result: { reference: string; text: string }) => {
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setVerse(result)
    setImageUrl(null)
    setImageBlob(null)
    setUploadedImageUrl(null)
    setError(null)
    setSearchResults([])
    setSearchQuery('')
  }

  const handleClearSearch = () => {
    setSearchQuery('')
    setSearchResults([])
    setSearchError(null)
    searchInputRef.current?.focus()
  }

  const handleNewVerse = () => {
    setVerse(randomVerse())
    if (imageUrl) URL.revokeObjectURL(imageUrl)
    setImageUrl(null)
    setImageBlob(null)
    setUploadedImageUrl(null)
    setError(null)
  }

  const handleCreatePost = () => {
    checkLogin(() => {
      let upload: Promise<string> | undefined
      if (imageBlob && !uploadedImageUrl) {
        upload = (async () => {
          const file = new File([imageBlob], 'bible-verse.png', { type: 'image/png' })
          const result = await mediaUpload.upload(file)
          setUploadedImageUrl(result.url)
          return result.url
        })()
      } else if (uploadedImageUrl) {
        upload = Promise.resolve(uploadedImageUrl)
      }
      setPendingUpload(upload)
      setPostOpen(true)
    })
  }

  const handleGenerateImage = async () => {
    setLoading(true)
    setError(null)
    try {
      const prompt = `A beautiful, reverent, painterly illustration inspired by the Bible verse: "${verse.text}". Epic, cinematic lighting, oil painting style, spiritual and uplifting atmosphere. No text, no words, no letters, no writing of any kind in the image.`
      const { url, blob } = await openaiService.generateImage(prompt)
      setImageUrl(url)
      setImageBlob(blob)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate image')
    } finally {
      setLoading(false)
    }
  }

  return (
    <PrimaryPageLayout ref={ref} pageName="bible" titlebar={<BiblePageTitlebar />}>
      <div className="flex flex-col gap-6 p-4">
        <form onSubmit={handleSearch} className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search by topic or reference (e.g. "hope" or "John 3")'
              className="w-full rounded-lg border border-border bg-background pl-9 pr-9 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={!searchQuery.trim() || searching || !openaiService.isInitialized()}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            {searching ? <RefreshCwIcon className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
            Search
          </button>
        </form>

        {searchError && <p className="text-sm text-destructive">{searchError}</p>}

        {searchResults.length > 0 && (
          <div className="flex flex-col gap-2">
            {searchResults.map((result) => (
              <button
                key={result.reference}
                onClick={() => handleSelectVerse(result)}
                className="rounded-lg border border-border bg-card p-4 text-left hover:bg-muted transition-colors"
              >
                <p className="text-sm text-foreground italic mb-1">{result.text}</p>
                <p className="text-xs font-semibold text-muted-foreground">– {result.reference}</p>
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <p className="text-base leading-relaxed text-foreground italic mb-3">{verse.text}</p>
          <p className="text-sm font-semibold text-muted-foreground">– {verse.reference}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleNewVerse}
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <RefreshCwIcon className="h-4 w-4" />
            New Verse
          </button>
          <button
            onClick={handleGenerateImage}
            disabled={loading || !openaiService.isInitialized()}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <SparklesIcon className="h-4 w-4" />
            {loading ? 'Generating…' : 'Generate Image'}
          </button>
          <button
            onClick={handleCreatePost}
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
          >
            <PencilLineIcon className="h-4 w-4" />
            Create Post
          </button>
        </div>

        <PostEditor
          open={postOpen}
          setOpen={setPostOpen}
          defaultContent={`<p>${verse.text}</p><p>– ${verse.reference}</p>`}
          pendingUpload={pendingUpload}
        />

        {!openaiService.isInitialized() && (
          <p className="text-sm text-muted-foreground">Set your OpenAI API key in Settings to generate images.</p>
        )}

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}

        {loading && (
          <div className="flex h-64 items-center justify-center rounded-xl border border-border bg-muted">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <SparklesIcon className="h-8 w-8 animate-pulse" />
              <span className="text-sm">Creating your image…</span>
            </div>
          </div>
        )}

        {imageUrl && !loading && (
          <div className="overflow-hidden rounded-xl border border-border shadow-md">
            <img src={imageUrl} alt={verse.reference} className="w-full object-cover" />
            <div className="bg-card px-4 py-2">
              <p className="text-xs text-muted-foreground">{verse.reference}</p>
            </div>
          </div>
        )}
      </div>
    </PrimaryPageLayout>
  )
})
BiblePage.displayName = 'BiblePage'
export default BiblePage

function BiblePageTitlebar() {
  return (
    <div className="flex h-full items-center gap-2 pl-3">
      <BookOpenIcon />
      <div className="text-lg font-semibold">Bible</div>
    </div>
  )
}
