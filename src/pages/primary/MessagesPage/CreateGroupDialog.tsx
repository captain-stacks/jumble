import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getDefaultRelayUrls } from '@/lib/relay'
import type { MarmotClient } from '@internet-privacy/marmot-ts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export default function CreateGroupDialog({
  open,
  onOpenChange,
  marmotClient
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  marmotClient: MarmotClient
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      const relays = getDefaultRelayUrls().slice(0, 3)
      await marmotClient.createGroup(name.trim(), {
        description: description.trim() || undefined,
        relays
      })
      toast.success(t('Group created'))
      onOpenChange(false)
      setName('')
      setDescription('')
    } catch (err) {
      console.error('[Marmot] createGroup failed:', err)
      toast.error(t('Failed to create group'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('New encrypted group')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-name">{t('Name')}</Label>
            <Input
              id="group-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Group name')}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-description">{t('Description')} ({t('optional')})</Label>
            <Input
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('What is this group about?')}
            />
          </div>
          <Button onClick={handleCreate} disabled={!name.trim() || loading}>
            {loading ? t('Creating…') : t('Create group')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
