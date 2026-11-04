import Image from 'next/image'
import { ONEPASS_CARD_IMAGES, type DongiImageVariant } from '@/lib/dongi/card-design'

export type { DongiImageVariant }

export default function DongiImage({
  variant,
  alt,
  className,
  priority = false,
}: {
  variant: DongiImageVariant
  alt: string
  className?: string
  priority?: boolean
}) {
  const image = ONEPASS_CARD_IMAGES[variant]
  return (
    <Image
      src={image.src}
      alt={alt}
      width={image.width}
      height={image.height}
      className={className}
      sizes="(max-width: 520px) 100vw, 520px"
      priority={priority}
    />
  )
}
