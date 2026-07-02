import type { LucideIcon } from 'lucide-react'

interface IconProps {
  /** A Lucide icon component, e.g. imported as `import { Sparkles } from 'lucide-react'`. */
  icon: LucideIcon
  /** Pixel size (width and height). Defaults to 16. */
  size?: number
  /** Stroke width. Defaults to 2 to match the Primer/Lucide look. */
  strokeWidth?: number
  className?: string
  /** Explicit color; defaults to `currentColor` (inherits text color). */
  color?: string
  /** Accessible label. When omitted the icon is decorative and hidden from a11y. */
  label?: string
}

/**
 * Thin wrapper around Lucide icons that standardizes size and stroke so every
 * icon in the app looks consistent. Import the specific icon and pass it in,
 * which keeps Lucide tree-shakeable.
 */
export function Icon({ icon: LucideComponent, size = 16, strokeWidth = 2, className, color, label }: IconProps): JSX.Element {
  return (
    <LucideComponent
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      color={color}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
