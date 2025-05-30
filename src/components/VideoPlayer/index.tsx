import { cn, isInViewport } from '@/lib/utils'
import videoManager from '@/services/video-manager.service'
import { useEffect, useRef } from 'react'
import NsfwOverlay from '../NsfwOverlay'

export default function VideoPlayer({
  src,
  className,
  isNsfw = false,
  size = 'normal'
}: {
  src: string
  className?: string
  isNsfw?: boolean
  size?: 'normal' | 'small'
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const video = videoRef.current
    const container = containerRef.current

    if (!video || !container) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            if (isInViewport(container)) {
              videoManager.autoPlay(video)
            }
          }, 200)
        } else {
          videoManager.pause(video)
        }
      },
      { threshold: 1 }
    )

    observer.observe(container)

    return () => {
      observer.unobserve(container)
    }
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <video
        ref={videoRef}
        controls
        playsInline
        className={cn('rounded-lg', size === 'small' ? 'max-h-[30vh]' : 'max-h-[50vh]', className)}
        src={src}
        onClick={(e) => e.stopPropagation()}
        onPlay={(event) => {
          videoManager.play(event.currentTarget)
        }}
        muted
      />
      {isNsfw && <NsfwOverlay className="rounded-lg" />}
    </div>
  )
}
