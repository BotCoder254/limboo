/**
 * Provider glyphs for the model pickers. Claude Code is served by Anthropic, so
 * today there is a single provider mark. Rendered as inline SVG using
 * `currentColor` so it always stays on-palette (no background, no gradient) per
 * the product's visual rules. Keyed by the `AgentProvider` union from constants.
 */
import type { AgentProvider } from '@shared/constants';

/**
 * Anthropic's radial "burst" mark, simplified to clean geometry and drawn with
 * the current text color so it inherits the surrounding token.
 */
export function AnthropicMark({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      {/* Stylised "A" of the Anthropic / Claude mark. */}
      <path d="M14.6 3.5h-3.6L4.4 20.5h3.8l1.36-3.62h6.96L17.86 20.5h3.78L15.02 3.5h-.42Zm-3.7 9.96 2.3-6.12 2.3 6.12h-4.6Z" />
    </svg>
  );
}

export function ProviderIcon({
  provider,
  size = 14,
  className,
}: {
  provider: AgentProvider;
  size?: number;
  className?: string;
}) {
  switch (provider) {
    case 'anthropic':
    default:
      return <AnthropicMark size={size} className={className} />;
  }
}
