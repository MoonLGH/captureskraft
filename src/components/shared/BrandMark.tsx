import { Camera } from 'lucide-react'

type BrandMarkProps = {
  small?: boolean
}

export function BrandMark({ small = false }: BrandMarkProps) {
  return (
    <span className={`brand-mark ${small ? 'brand-mark-small' : ''}`}>
      <Camera size={small ? 20 : 23} strokeWidth={2.4} />
    </span>
  )
}
