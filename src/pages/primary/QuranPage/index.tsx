import PostEditor from '@/components/PostEditor'
import PrimaryPageLayout from '@/layouts/PrimaryPageLayout'
import { useNostr } from '@/providers/NostrProvider'
import mediaUpload from '@/services/media-upload.service'
import openaiService from '@/services/openai.service'
import { TPageRef } from '@/types'
import { BookOpenIcon, PencilLineIcon, RefreshCwIcon, SearchIcon, SparklesIcon, XIcon } from 'lucide-react'
import { forwardRef, useRef, useState } from 'react'

const QURAN_VERSES = [
  { reference: 'Al-Baqarah 286', text: 'God does not burden a soul beyond that it can bear.' },
  { reference: 'Al-Imran 173', text: 'God is sufficient for us, and He is the best disposer of affairs.' },
  { reference: 'Al-Baqarah 255', text: 'God — there is no deity except Him, the Ever-Living, the Sustainer of existence.' },
  { reference: 'Ash-Sharh 5-6', text: 'For indeed, with hardship will be ease. Indeed, with hardship will be ease.' },
  { reference: 'Al-Baqarah 152', text: 'So remember Me; I will remember you. And be grateful to Me and do not deny Me.' },
  { reference: 'Al-Imran 139', text: 'So do not weaken and do not grieve, and you will be superior if you are true believers.' },
  { reference: 'Ar-Rad 28', text: 'Verily, in the remembrance of God do hearts find rest.' },
  { reference: 'Az-Zumar 53', text: 'Do not despair of the mercy of God. Indeed, God forgives all sins.' },
  { reference: 'Al-Anfal 46', text: 'And obey God and His Messenger, and do not dispute and lose courage and your strength would depart.' },
  { reference: 'Al-Baqarah 45', text: 'And seek help through patience and prayer, and indeed, it is difficult except for the humbly submissive.' },
  { reference: 'Al-Talaq 3', text: 'And whoever relies upon God — then He is sufficient for him. Indeed, God will accomplish His purpose.' },
  { reference: 'Al-Fatiha 1-2', text: 'In the name of God, the Entirely Merciful, the Especially Merciful. All praise is due to God, Lord of the worlds.' },
  { reference: 'Al-Hujurat 13', text: 'Indeed, the most noble of you in the sight of God is the most righteous of you.' },
  { reference: 'Al-Isra 44', text: 'The seven heavens and the earth and all that is therein praise Him, and there is not a thing but glorifies His praise.' },
  { reference: 'Yunus 62', text: 'Unquestionably, the allies of God will have no fear concerning them, nor will they grieve.' },
  { reference: 'Al-Mulk 2', text: 'He who created death and life to test you as to which of you is best in deed.' },
  { reference: 'Al-Qadr 3', text: 'The Night of Decree is better than a thousand months.' },
  { reference: 'Al-Ikhlas 1-2', text: 'Say: He is God, the One. God, the Eternal Refuge.' },
  { reference: 'Al-Asr 1-3', text: 'By time, indeed, mankind is in loss, except for those who have believed and done righteous deeds.' },
  { reference: 'Al-Baqarah 201', text: 'Our Lord, give us in this world good and in the Hereafter good and protect us from the punishment of the Fire.' }
]

function randomVerse() {
  return QURAN_VERSES[Math.floor(Math.random() * QURAN_VERSES.length)]
}

const QuranPage = forwardRef<TPageRef>((_, ref) => {
  const { checkLogin } = useNostr()
  const [verse, setVerse] = useState(randomVerse)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageBlob, setImageBlob] = useState<Blob | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [postOpen, setPostOpen] = useState(false)
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null)
  const [pendingUpload, setPendingUpload] = useState<Promise<string> | undefined>(undefined)
  const [hints, setHints] = useState('')

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
      const results = await openaiService.searchQuranVerses(searchQuery.trim())
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
          const file = new File([imageBlob], 'quran-verse.png', { type: 'image/png' })
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
      const hint = hints.trim() ? ` ${hints.trim()}.` : ''
      const prompt = `A beautiful, reverent, painterly illustration inspired by the Quran verse: "${verse.text}".${hint} Epic, cinematic lighting, oil painting style, spiritual and uplifting atmosphere. No text, no words, no letters, no writing of any kind in the image.`
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
    <PrimaryPageLayout ref={ref} pageName="quran" titlebar={<QuranPageTitlebar />}>
      <div className="flex flex-col gap-6 p-4">
        <form onSubmit={handleSearch} className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search by topic or reference (e.g. "patience" or "Al-Baqarah 2")'
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

        <input
          value={hints}
          onChange={(e) => setHints(e.target.value)}
          placeholder="Image hints (e.g. desert, mosque, golden light)"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        />

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
QuranPage.displayName = 'QuranPage'
export default QuranPage

function QuranPageTitlebar() {
  return (
    <div className="flex h-full items-center gap-2 pl-3">
      <BookOpenIcon />
      <div className="text-lg font-semibold">Quran</div>
    </div>
  )
}
