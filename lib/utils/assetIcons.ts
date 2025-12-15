export interface AssetIconProps {
  /** Tailwind background color class for the icon circle */
  bgClass: string
  /** Text/emoji shown inside the circle */
  label: string
  /** Optional text color override for inline ticker icon */
  textClass?: string
}

const DEFAULT_ICON: AssetIconProps = {
  bgClass: 'bg-[#4b5563]', // gray
  label: '?',
  textClass: 'text-[#9ca3af]',
}

// Basic mapping for the main assets we trade on Avantis.
// These colors/styles are chosen to closely match the Avantis dashboard.
const ASSET_ICON_MAP: Record<string, AssetIconProps> = {
  BTC: { bgClass: 'bg-[#f7931a]', label: '₿', textClass: 'text-[#f7931a]' },
  WBTC: { bgClass: 'bg-[#f7931a]', label: '₿', textClass: 'text-[#f7931a]' },
  ETH: { bgClass: 'bg-[#627eea]', label: 'Ξ', textClass: 'text-[#627eea]' },
  SOL: { bgClass: 'bg-[#9945FF]', label: 'S', textClass: 'text-[#9945FF]' },
  AVAX: { bgClass: 'bg-[#E84142]', label: 'A', textClass: 'text-[#E84142]' },
  MATIC: { bgClass: 'bg-[#8247e5]', label: 'M', textClass: 'text-[#8247e5]' },
  ARB: { bgClass: 'bg-[#28A0F0]', label: 'A', textClass: 'text-[#28A0F0]' },
  OP: { bgClass: 'bg-[#FF0420]', label: 'OP', textClass: 'text-[#FF0420]' },
  LINK: { bgClass: 'bg-[#2A5ADA]', label: 'L', textClass: 'text-[#2A5ADA]' },
  UNI: { bgClass: 'bg-[#ff007a]', label: 'U', textClass: 'text-[#ff007a]' },
  AAVE: { bgClass: 'bg-[#B6509E]', label: 'A', textClass: 'text-[#B6509E]' },
  ATOM: { bgClass: 'bg-[#2E3148]', label: 'A', textClass: 'text-[#9ca3af]' },
  DOT: { bgClass: 'bg-[#E6007A]', label: 'P', textClass: 'text-[#E6007A]' },
  ADA: { bgClass: 'bg-[#0033ad]', label: 'A', textClass: 'text-[#0033ad]' },
  XRP: { bgClass: 'bg-[#23292F]', label: 'X', textClass: 'text-[#9ca3af]' },
  DOGE: { bgClass: 'bg-[#C2A633]', label: 'Ð', textClass: 'text-[#C2A633]' },
  BNB: { bgClass: 'bg-[#f3ba2f]', label: 'B', textClass: 'text-[#f3ba2f]' },
}

/**
 * Returns display properties for an asset icon.
 *
 * Accepts symbols like "BTC", "BTC-USD", "BTCUSD", "BTC/USDC", etc.
 */
export function getAssetIcon(symbol?: string | null): AssetIconProps {
  if (!symbol) return DEFAULT_ICON

  const normalized = symbol
    .toUpperCase()
    // Strip common suffixes / separators
    .replace(/[-/]*USD[C]?$/i, '')
    .replace(/[-/]*USDT$/i, '')
    .trim()

  return ASSET_ICON_MAP[normalized] ?? {
    ...DEFAULT_ICON,
    // Show first letter of unknown asset for a nicer fallback
    label: normalized.charAt(0) || DEFAULT_ICON.label,
  }
}


