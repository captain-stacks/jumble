import { Button } from '@/components/ui/button'
import { JUMBLE_PUBKEY } from '@/constants'
import { cn } from '@/lib/utils'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ZapDialog from '../ZapDialog'
import PlatinumSponsors from './PlatinumSponsors'
import RecentSupporters from './RecentSupporters'

const DONATION_AMOUNTS = [
  { amount: 1000, text: '☕️ 1k' },
  { amount: 10000, text: '🍜 10k' },
  { amount: 100000, text: '🍣 100k' },
  { amount: 1000000, text: '✈️ 1M' }
]

export default function Donation({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [donationAmount, setDonationAmount] = useState<number | undefined>(undefined)

  return (
    <div className={cn('space-y-8', className)}>
      <section className="space-y-4">
        <div className="space-y-1.5 text-center">
          <div className="text-lg font-semibold">{t('Enjoying Jumble?')}</div>
          <div className="text-sm text-muted-foreground">
            {t('Your donation helps me maintain Jumble and make it better! 😊')}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {DONATION_AMOUNTS.map(({ amount, text }) => (
            <Button
              variant="secondary"
              key={amount}
              onClick={() => {
                setDonationAmount(amount)
                setOpen(true)
              }}
            >
              {text}
            </Button>
          ))}
        </div>
      </section>

      <PlatinumSponsors />
      <RecentSupporters />

      <ZapDialog
        open={open}
        setOpen={setOpen}
        pubkey={JUMBLE_PUBKEY}
        defaultAmount={donationAmount}
      />
    </div>
  )
}
