import OpenAI from 'openai'

interface AIMessage {
  role: 'user' | 'assistant'
  content: string
}

const STORAGE_KEY_API = 'openai_api_key'
const STORAGE_KEY_SYSTEM_PROMPT = 'openai_system_prompt'

const DEFAULT_SYSTEM_PROMPT =
  `You are a helpful assistant for a Nostr decentralized social network platform. Provide clear, concise, and accurate answers about Nostr, its protocol, features, and how to use them. Keep responses conversational and friendly.

USER INFORMATION:
- User's npub: npub1vlprg9j8u5l92az0zd6yd8ks7tl560v8ssepdkn07nwekdl9rs4saccfwp

CRITICAL - JavaScript Code Execution Rules:
1. NEVER use import, export, require, or any module syntax - NOT ALLOWED
2. NEVER use top-level await or async/await at root level - use synchronous code or return promises
3. Write ONLY vanilla JavaScript that runs in a browser
4. Available APIs: console.log/error/warn, Math, Date, JSON, fetch(), Array, Object, String, etc.
5. DO NOT wrap code in backticks or markdown code blocks - just plain JavaScript
6. ALL code must be executable as-is with no pre-processing
7. If the user asks for code, provide it inline without any markdown formatting
8. Use console.log() to output any results or intermediate values

Example of GOOD code:
const sum = (1 + 2 + 3 + 4 + 5);
console.log('Sum: ' + sum);

Example of BAD code (DO NOT DO THIS):
import { something } from 'library';
const result = await someFunction();
export default result;

Always remember: The code runs in a sandboxed browser environment with NO module support.`

function parseJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  return JSON.parse(fenced ? fenced[1].trim() : raw)
}

class OpenAIService {
  static instance: OpenAIService

  private client: OpenAI | null = null
  private conversationHistory: AIMessage[] = []
  private listeners: Set<() => void> = new Set()

  constructor() {
    if (!OpenAIService.instance) {
      OpenAIService.instance = this
      this.initializeClient()
    }
    return OpenAIService.instance
  }

  private initializeClient() {
    const apiKey = this.getApiKey()

    if (!apiKey) {
      return
    }

    this.client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true, // Required for browser-based requests
    })
  }

  private getApiKey(): string | null {
    // Check localStorage first
    const storedKey = localStorage.getItem(STORAGE_KEY_API)
    if (storedKey) {
      return storedKey
    }

    // Fall back to environment variable
    const envKey = import.meta.env.VITE_OPENAI_API_KEY
    if (envKey) {
      return envKey
    }

    return null
  }

  setApiKey(apiKey: string): void {
    if (!apiKey.trim()) {
      this.removeApiKey()
      return
    }

    localStorage.setItem(STORAGE_KEY_API, apiKey.trim())
    this.initializeClient()
    this.notifyListeners()
  }

  removeApiKey(): void {
    localStorage.removeItem(STORAGE_KEY_API)
    this.client = null
    this.notifyListeners()
  }

  getSystemPrompt(): string {
    return localStorage.getItem(STORAGE_KEY_SYSTEM_PROMPT) || DEFAULT_SYSTEM_PROMPT
  }

  setSystemPrompt(prompt: string): void {
    if (!prompt.trim()) {
      this.resetSystemPrompt()
      return
    }

    localStorage.setItem(STORAGE_KEY_SYSTEM_PROMPT, prompt.trim())
    this.notifyListeners()
  }

  resetSystemPrompt(): void {
    localStorage.removeItem(STORAGE_KEY_SYSTEM_PROMPT)
    this.notifyListeners()
  }

  getDefaultSystemPrompt(): string {
    return DEFAULT_SYSTEM_PROMPT
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener())
  }

  async sendMessage(userMessage: string, systemPrompt?: string): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set your OpenAI API key.')
    }

    const promptToUse = systemPrompt || this.getSystemPrompt()

    // Add user message to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
    })

    try {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: promptToUse },
        ...this.conversationHistory,
      ]

      const requestPayload = {
        model: 'gpt-5',
        messages,
      }

      console.log('OpenAI Request:', JSON.stringify(requestPayload, null, 2))

      const response = await this.client.chat.completions.create(requestPayload)

      console.log('OpenAI Response:', JSON.stringify(response, null, 2))

      const assistantMessage = response.choices[0].message.content

      if (!assistantMessage) {
        throw new Error('No response from OpenAI')
      }

      // Add assistant message to history
      this.conversationHistory.push({
        role: 'assistant',
        content: assistantMessage,
      })

      return assistantMessage
    } catch (error) {
      // Remove the user message from history if request failed
      this.conversationHistory.pop()

      if (error instanceof OpenAI.APIError) {
        throw new Error(`OpenAI API Error: ${error.message}`)
      }

      throw error
    }
  }

  async translateText(text: string, targetLanguage: string): Promise<{ translated: string; sourceLang: string }> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set your OpenAI API key.')
    }

    const response = await this.client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        {
          role: 'system',
          content: `You are a translator. Translate the following text to ${targetLanguage}. Respond with JSON: {"translated": "<translated text>", "sourceLang": "<full language name in English, e.g. Spanish>"}`
        },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' }
    })

    const raw = response.choices[0].message.content
    if (!raw) {
      throw new Error('No translation returned from OpenAI')
    }
    const parsed = JSON.parse(raw)
    if (!parsed.translated) {
      throw new Error('Invalid translation response from OpenAI')
    }
    return { translated: parsed.translated, sourceLang: parsed.sourceLang ?? '' }
  }

  async detectLanguage(text: string): Promise<{ language: string; isEnglish: boolean }> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set your OpenAI API key.')
    }

    const response = await this.client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        {
          role: 'system',
          content:
            'Detect the language of the following text. Respond with JSON: {"language": "<full language name in English, e.g. Spanish>", "isEnglish": <true|false>}'
        },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' }
    })

    const raw = response.choices[0].message.content
    if (!raw) throw new Error('No response from OpenAI')
    return JSON.parse(raw)
  }

  async translateReply(replyText: string, parentNoteContent: string): Promise<{ translated: string; targetLanguage: string }> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set your OpenAI API key.')
    }

    const response = await this.client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        {
          role: 'system',
          content:
            'You are a translator helping a user reply to a social media post. The user wrote their reply in English. Translate it into the same language as the original post. Preserve the tone and meaning. Respond with JSON: {"translated": "<translated reply>", "targetLanguage": "<full language name in English>"}'
        },
        {
          role: 'user',
          content: `Original post:\n${parentNoteContent}\n\nReply to translate:\n${replyText}`
        }
      ],
      response_format: { type: 'json_object' }
    })

    const raw = response.choices[0].message.content
    if (!raw) throw new Error('No response from OpenAI')
    const parsed = JSON.parse(raw)
    if (!parsed.translated) throw new Error('Invalid response from OpenAI')
    return parsed
  }

  async proofread(text: string): Promise<{ fixed: string }> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set your OpenAI API key.')
    }

    const response = await this.client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a proofreader. Fix spelling, grammar, and punctuation mistakes in the given text. Preserve the author\'s voice, style, tone, and intent — do not rewrite or improve phrasing beyond correcting errors. Do not flag or change the capitalization of the first word of a sentence — that is intentional. Do not add or enforce punctuation at the end of sentences — missing periods or other terminal punctuation is intentional. If the text has no mistakes, return it unchanged. Respond with JSON: {"fixed": "<corrected text>"}'
        },
        { role: 'user', content: text }
      ],
      response_format: { type: 'json_object' }
    })

    const raw = response.choices[0].message.content
    if (!raw) throw new Error('No response from OpenAI')
    const parsed = JSON.parse(raw)
    return { fixed: parsed.fixed ?? text }
  }

  async summarizeNote(content: string): Promise<string> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set your OpenAI API key.')
    }

    const response = await this.client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        {
          role: 'system',
          content:
            'You are a concise summarizer. Summarize the following Nostr note in 1-2 sentences. Be brief and neutral.'
        },
        { role: 'user', content }
      ]
    })

    const summary = response.choices[0].message.content
    if (!summary) {
      throw new Error('No summary returned from OpenAI')
    }
    return summary
  }

  async searchBibleVerses(query: string): Promise<{ reference: string; text: string }[]> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set your OpenAI API key.')
    }

    const response = await this.client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        {
          role: 'system',
          content:
            'You are a Bible reference assistant. Given a search query — either a topic/keyword or a book/chapter/verse reference — return up to 8 relevant Bible verses from the NIV translation. Respond with JSON: {"verses": [{"reference": "<Book Chapter:Verse>", "text": "<verse text>"}]}'
        },
        { role: 'user', content: query }
      ],
    })

    console.log('searchBibleVerses response:', JSON.stringify(response))
    const raw = response.choices[0].message.content
    if (!raw) throw new Error('No response from OpenAI')
    let parsed: { verses?: { reference: string; text: string }[] }
    try {
      parsed = parseJson(raw) as typeof parsed
    } catch (e) {
      console.error('searchBibleVerses parse error, raw:', raw, e)
      throw new Error('Could not parse search results — please try again')
    }
    return parsed.verses ?? []
  }

  async searchQuranVerses(query: string): Promise<{ reference: string; text: string }[]> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set your OpenAI API key.')
    }

    const response = await this.client.chat.completions.create({
      model: 'gpt-5',
      messages: [
        {
          role: 'system',
          content:
            'You are a Quran reference assistant. Given a search query — either a topic/keyword or a surah/ayah reference — return up to 8 relevant Quran verses in English. Use "God" instead of "Allah" in all translations. Format references as "<Surah Name> <Verse>" (e.g. "Al-Baqarah 286") — surah name only, no chapter number. Respond with JSON: {"verses": [{"reference": "<Surah Name>:<Verse>", "text": "<verse text in English>"}]}'
        },
        { role: 'user', content: query }
      ],
    })

    console.log('searchQuranVerses response:', JSON.stringify(response))
    const raw = response.choices[0].message.content
    if (!raw) throw new Error('No response from OpenAI')
    let parsed: { verses?: { reference: string; text: string }[] }
    try {
      parsed = parseJson(raw) as typeof parsed
    } catch (e) {
      console.error('searchQuranVerses parse error, raw:', raw, e)
      throw new Error('Could not parse search results — please try again')
    }
    return parsed.verses ?? []
  }

  async generateImage(prompt: string): Promise<{ url: string; blob: Blob }> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Please set your OpenAI API key.')
    }

    const response = await this.client.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      quality: 'standard',
      response_format: 'b64_json'
    })

    const b64 = response.data?.[0]?.b64_json
    if (!b64) {
      throw new Error('No image data returned from OpenAI')
    }

    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: 'image/png' })
    const url = URL.createObjectURL(blob)
    return { url, blob }
  }

  clearHistory() {
    this.conversationHistory = []
  }

  getHistory(): AIMessage[] {
    return [...this.conversationHistory]
  }

  isInitialized(): boolean {
    return this.client !== null
  }
}

const instance = new OpenAIService()

export default instance
