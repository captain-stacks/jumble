import { Button } from '@/components/ui/button'
import { useMuteList } from '@/providers/MuteListProvider'
import { Bell, Eye } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function MutedNote({ pubkey, show }: { pubkey: string; show: () => void }) {
  const { t } = useTranslation()
  const { unmutePubkey } = useMuteList()
  const [unmuting, setUnmuting] = useState(false)

  return (
    <div className="my-4 flex flex-col items-center gap-2 font-medium text-muted-foreground">
      <div>{t('This user has been muted')}</div>
      <div className="flex gap-2">
        <Button
          onClick={(e) => {
            e.stopPropagation()
            show()
          }}
          variant="outline"
        >
          <Eye />
          {t('Temporarily display this note')}
        </Button>
        <Button
          variant="outline"
          disabled={unmuting}
          onClick={async (e) => {
            e.stopPropagation()
            setUnmuting(true)
            try {
              await unmutePubkey(pubkey)
            } finally {
              setUnmuting(false)
            }
          }}
        >
          <Bell />
          {t('Unmute')}
        </Button>
      </div>
    </div>
  )
}
