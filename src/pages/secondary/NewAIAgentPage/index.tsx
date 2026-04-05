import SecondaryPageLayout from '@/layouts/SecondaryPageLayout'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Send, AlertCircle, Settings, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import openaiService from '@/services/openai.service'
import { executeCode, formatExecutionResult } from '@/lib/code-executor'
import { forwardRef } from 'react'
import { toast } from 'sonner'

interface Message {
  role: 'user' | 'assistant'
  content: string
  executionResult?: string
}

const NewAIAgentPage = forwardRef(({ index }: { index?: number }, ref) => {
  const { t } = useTranslation()
  const [apiKeyConfigured, setApiKeyConfigured] = useState(openaiService.isInitialized())
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: t('Ask me anything about Nostr.'),
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showSettingsDialog, setShowSettingsDialog] = useState(false)
  const [activeTab, setActiveTab] = useState<'api' | 'prompt'>('api')
  const [tempApiKey, setTempApiKey] = useState('')
  const [tempSystemPrompt, setTempSystemPrompt] = useState('')
  const [, setExecutingIndex] = useState<number | null>(null)
  const [consoleLogs, setConsoleLogs] = useState<string[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const consoleEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Subscribe to API key changes
    const unsubscribe = openaiService.subscribe(() => {
      setApiKeyConfigured(openaiService.isInitialized())
    })

    return () => unsubscribe()
  }, [])

  useEffect(() => {
    // Auto-scroll to bottom when messages change
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    // Auto-scroll console to bottom when logs change
    consoleEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [consoleLogs])

  const handleSendMessage = async () => {
    if (input.trim() === '') return
    if (!apiKeyConfigured) {
      toast.error(t('OpenAI API key not configured'))
      setShowSettingsDialog(true)
      setActiveTab('api')
      return
    }

    const userMessage = input.trim()
    const newMessages: Message[] = [...messages, { role: 'user', content: userMessage }]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const response = await openaiService.sendMessage(userMessage)
      setMessages([
        ...newMessages,
        {
          role: 'assistant',
          content: response,
        },
      ])
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to get response'
      toast.error(errorMessage)
      setMessages(newMessages)
    } finally {
      setLoading(false)
    }
  }

  const handleExecuteCode = async (messageIndex: number) => {
    if (messages[messageIndex].role === 'assistant') {
      const code = messages[messageIndex].content
      setExecutingIndex(messageIndex)
      setConsoleLogs((prev) => [...prev, `\n--- Executing Code ---`])
      try {
        const result = await executeCode(code, (log) => {
          setConsoleLogs((prev) => [...prev, log])
        })
        const formatted = formatExecutionResult(result)

        // Update message with execution result
        const updatedMessages = [...messages]
        updatedMessages[messageIndex] = {
          ...updatedMessages[messageIndex],
          executionResult: formatted,
        }
        setMessages(updatedMessages)
        setConsoleLogs((prev) => [...prev, `--- Execution Complete ---\n`])
        toast.success('Code executed successfully')
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to execute code'
        setConsoleLogs((prev) => [...prev, `ERROR: ${errorMessage}`])
        toast.error(errorMessage)
      } finally {
        setExecutingIndex(null)
      }
    }
  }

  const handleOpenSettings = () => {
    setTempApiKey('')
    setTempSystemPrompt(openaiService.getSystemPrompt())
    setShowSettingsDialog(true)
  }

  const handleSaveApiKey = () => {
    if (!tempApiKey.trim()) {
      toast.error('API key cannot be empty')
      return
    }

    openaiService.setApiKey(tempApiKey)
    setTempApiKey('')
    toast.success('API key saved successfully')
  }

  const handleSaveSystemPrompt = () => {
    if (!tempSystemPrompt.trim()) {
      toast.error('System prompt cannot be empty')
      return
    }

    openaiService.setSystemPrompt(tempSystemPrompt)
    toast.success('System prompt saved successfully')
  }

  const handleResetSystemPrompt = () => {
    openaiService.resetSystemPrompt()
    setTempSystemPrompt(openaiService.getDefaultSystemPrompt())
    toast.success('System prompt reset to default')
  }

  return (
    <SecondaryPageLayout ref={ref} index={index} title={t('AI Agent')}>
      {!apiKeyConfigured && (
        <div className="flex items-start gap-3 border-b bg-amber-50 p-4 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-50">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold">{t('OpenAI API key not configured')}</p>
            <p className="text-xs opacity-80">
              {t('Click the settings icon or enter your API key to get started.')}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-amber-900/30 bg-amber-100 text-amber-900 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-900/50 dark:text-amber-50 dark:hover:bg-amber-900/70"
            onClick={() => {
              setActiveTab('api')
              handleOpenSettings()
            }}
          >
            {t('Configure')}
          </Button>
        </div>
      )}
      <div className="flex h-full flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.map((message, messageIndex) => (
            <div key={messageIndex}>
              <div
                className={`flex items-start gap-2 ${
                  message.role === 'user' ? 'justify-end' : ''
                }`}
              >
                {message.role === 'assistant' && (
                  <Bot className="mt-1 h-5 w-5 flex-shrink-0 text-primary" />
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
                    message.role === 'user'
                      ? 'rounded-tr-sm bg-primary text-primary-foreground'
                      : 'rounded-tl-sm bg-muted'
                  }`}
                >
                  {message.content}
                </div>
              </div>

              {message.role === 'assistant' && (
                <div className="mt-2 ml-7">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    onClick={() => handleExecuteCode(messageIndex)}
                  >
                    <Play className="h-3 w-3" />
                    {t('Execute')}
                  </Button>
                </div>
              )}

              {message.executionResult && (
                <div className="mt-2 flex items-start gap-2">
                  <div className="ml-7 w-[calc(80%-28px)] rounded-lg border border-dashed border-green-500/50 bg-green-50 p-3 font-mono text-xs dark:bg-green-950/30">
                    <div className="mb-2 text-green-700 dark:text-green-400">Result:</div>
                    <pre className="whitespace-pre-wrap break-words text-foreground">
                      {message.executionResult}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-start gap-2">
              <Bot className="mt-1 h-5 w-5 flex-shrink-0 text-primary" />
              <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-3.5 py-2.5 text-sm">
                ...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {consoleLogs.length > 0 && (
          <div className="border-t bg-black/10 dark:bg-black/50">
            <div className="flex items-center justify-between border-b bg-background/50 px-3 py-2">
              <div className="text-xs font-semibold text-foreground">Console Output</div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-xs"
                onClick={() => setConsoleLogs([])}
              >
                Clear
              </Button>
            </div>
            <div className="max-h-48 overflow-y-auto p-3">
              {consoleLogs.map((log, i) => (
                <div key={i} className="font-mono text-xs text-foreground whitespace-pre-wrap break-words">
                  {log}
                </div>
              ))}
              <div ref={consoleEndRef} />
            </div>
          </div>
        )}

        <div className="border-t bg-background p-4">
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              placeholder={t('Type a message...')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendMessage()
                }
              }}
              disabled={loading || !apiKeyConfigured}
            />
            {apiKeyConfigured && (
              <Button
                size="icon"
                variant="ghost"
                onClick={handleOpenSettings}
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="icon"
              onClick={handleSendMessage}
              disabled={loading || !input.trim() || !apiKeyConfigured}
            >
              {loading ? (
                <Bot className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('Settings')}</DialogTitle>
            <DialogDescription>
              {t('Manage your OpenAI API key and system prompt')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Tab Navigation */}
            <div className="flex gap-2 border-b">
              <button
                onClick={() => setActiveTab('api')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'api'
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('API Key')}
              </button>
              <button
                onClick={() => setActiveTab('prompt')}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'prompt'
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('System Prompt')}
              </button>
            </div>

            {/* API Key Tab */}
            {activeTab === 'api' && (
              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium">{t('OpenAI API Key')}</label>
                  <p className="text-xs text-muted-foreground">
                    {t('Get your key from https://platform.openai.com/api-keys')}
                  </p>
                </div>
                <Input
                  type="password"
                  placeholder="sk-..."
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveApiKey()
                    }
                  }}
                />
              </div>
            )}

            {/* System Prompt Tab */}
            {activeTab === 'prompt' && (
              <div className="space-y-4 py-4">
                <div>
                  <label className="text-sm font-medium">{t('System Prompt')}</label>
                  <p className="text-xs text-muted-foreground">
                    {t('Customize how the AI assistant behaves and responds')}
                  </p>
                </div>
                <textarea
                  className="min-h-[150px] w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                  placeholder={t('Enter system prompt...')}
                  value={tempSystemPrompt}
                  onChange={(e) => setTempSystemPrompt(e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            {activeTab === 'prompt' && (
              <Button
                variant="outline"
                onClick={handleResetSystemPrompt}
              >
                {t('Reset to Default')}
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowSettingsDialog(false)}>
              {t('Cancel')}
            </Button>
            <Button onClick={activeTab === 'api' ? handleSaveApiKey : handleSaveSystemPrompt}>
              {t('Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SecondaryPageLayout>
  )
})

NewAIAgentPage.displayName = 'NewAIAgentPage'
export default NewAIAgentPage
