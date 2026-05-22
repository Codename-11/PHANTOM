// PHANTOM SEC — line icons (React port of kit/icons.jsx).
//
// 16px, single-stroke geometric icons, stroke 1.5, no flourishes — the
// kit's icon language. Each icon takes { size, className, ...svgProps }
// and inherits color via `currentColor`, so callers set color with text-*
// utilities or a `color` style. Used by the sidebar nav and screen
// toolbars to replace the text-glyph placeholders from the A8 migration.
import * as React from 'react';

import { cn } from '@/lib/utils';

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, 'children'> {
  size?: number;
}

// Shared frame: matches the kit's `I` helper (viewBox 0 0 16 16, round caps).
function Icon({
  size = 16,
  className,
  fill = 'none',
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={fill}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0', className)}
      {...rest}
    >
      {children}
    </svg>
  );
}

type Ic = (p: IconProps) => React.ReactElement;

// ── Navigation ───────────────────────────────────────────────────────
export const IcCockpit: Ic = (p) => (
  <Icon {...p}><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v2M8 11.5v2M2.5 8h2M11.5 8h2M8 8l3-3" /></Icon>
);
export const IcRuns: Ic = (p) => (
  <Icon {...p}><path d="M2 4h12M2 8h12M2 12h8" /><circle cx="13" cy="12" r="1.2" /></Icon>
);
export const IcGraph: Ic = (p) => (
  <Icon {...p}><circle cx="3.5" cy="3.5" r="1.6" /><circle cx="12.5" cy="3.5" r="1.6" /><circle cx="8" cy="12.5" r="1.6" /><path d="M4.6 4.6l2.6 6.4M11.4 4.6L8.8 11M4.5 3.5h7" /></Icon>
);
export const IcArtifact: Ic = (p) => (
  <Icon {...p}><path d="M2.5 5l5.5-2.5L13.5 5v6L8 13.5 2.5 11z" /><path d="M2.5 5L8 7.5 13.5 5M8 7.5v6" /></Icon>
);
export const IcAssets: Ic = (p) => (
  <Icon {...p}><rect x="2.5" y="2.5" width="4.5" height="4.5" /><rect x="9" y="2.5" width="4.5" height="4.5" /><rect x="2.5" y="9" width="4.5" height="4.5" /><rect x="9" y="9" width="4.5" height="4.5" /></Icon>
);
export const IcAlert: Ic = (p) => (
  <Icon {...p}><path d="M8 2L1.5 13.5h13z" /><path d="M8 6.5v3M8 11.5v.01" /></Icon>
);
export const IcSettings: Ic = (p) => (
  <Icon {...p}><circle cx="8" cy="8" r="2" /><path d="M8 1.5v1.5M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4" /></Icon>
);

// ── Status / actions ─────────────────────────────────────────────────
export const IcSearch: Ic = (p) => (
  <Icon {...p}><circle cx="7" cy="7" r="4.5" /><path d="M13.5 13.5l-3.2-3.2" /></Icon>
);
export const IcFilter: Ic = (p) => <Icon {...p}><path d="M2 3h12l-4.5 6V13l-3 1V9z" /></Icon>;
export const IcChev: Ic = (p) => <Icon {...p}><path d="M5 6l3 3 3-3" /></Icon>;
export const IcChevR: Ic = (p) => <Icon {...p}><path d="M6 4l3 4-3 4" /></Icon>;
export const IcX: Ic = (p) => <Icon {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></Icon>;
export const IcCheck: Ic = (p) => <Icon {...p}><path d="M3 8.5l3 3 7-7" /></Icon>;
export const IcPlay: Ic = (p) => <Icon {...p}><polygon points="4,3 13,8 4,13" /></Icon>;
export const IcPause: Ic = (p) => <Icon {...p}><rect x="4" y="3" width="3" height="10" /><rect x="9" y="3" width="3" height="10" /></Icon>;
export const IcStep: Ic = (p) => <Icon {...p}><polygon points="4,4 9,8 4,12" /><path d="M11 4v8" /></Icon>;
export const IcReplay: Ic = (p) => <Icon {...p}><path d="M2.5 8a5.5 5.5 0 1 0 1.7-4" /><path d="M2.5 3v3.5h3.5" /></Icon>;
export const IcMore: Ic = (p) => (
  <Icon {...p}><circle cx="3.5" cy="8" r="1" fill="currentColor" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="12.5" cy="8" r="1" fill="currentColor" /></Icon>
);
export const IcPlus: Ic = (p) => <Icon {...p}><path d="M8 3v10M3 8h10" /></Icon>;
export const IcShield: Ic = (p) => (
  <Icon {...p}><path d="M8 1.5L2.5 3.5V8c0 3.5 2.5 5.5 5.5 6.5 3-1 5.5-3 5.5-6.5V3.5z" /><path d="M5.5 8l1.7 1.7 3.3-3.4" /></Icon>
);
export const IcLock: Ic = (p) => <Icon {...p}><rect x="3" y="7" width="10" height="6.5" rx="1" /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></Icon>;
export const IcEye: Ic = (p) => <Icon {...p}><path d="M1.5 8s2.5-4.5 6.5-4.5 6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" /><circle cx="8" cy="8" r="1.8" /></Icon>;
export const IcEyeOff: Ic = (p) => <Icon {...p}><path d="M2 8s2.5-4.5 6.5-4.5c1.3 0 2.5.4 3.5 1" /><path d="M14 8s-1 1.8-2.6 3.2" /><path d="M2 14L14 2" /></Icon>;
export const IcTerminal: Ic = (p) => <Icon {...p}><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><path d="M4 6l2.5 2L4 10M8 10.5h4" /></Icon>;
export const IcTarget: Ic = (p) => <Icon {...p}><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.5" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2" /></Icon>;
export const IcDoc: Ic = (p) => <Icon {...p}><path d="M3.5 1.5h6L13 5v9.5h-9.5z" /><path d="M9.5 1.5V5H13M5.5 8h5M5.5 10.5h5" /></Icon>;
export const IcExport: Ic = (p) => <Icon {...p}><path d="M3 11v2.5h10V11" /><path d="M8 2v9M5 5l3-3 3 3" /></Icon>;
export const IcCopy: Ic = (p) => <Icon {...p}><rect x="2.5" y="4.5" width="8" height="9" /><path d="M5.5 4.5v-2h8v9h-2" /></Icon>;
export const IcUser: Ic = (p) => <Icon {...p}><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5" /></Icon>;
export const IcBolt: Ic = (p) => <Icon {...p}><polygon points="8.5,1.5 3,9 7,9 6,14.5 12,7 8,7" /></Icon>;
export const IcGlobe: Ic = (p) => <Icon {...p}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.8 2 3 4 3 6s-1.2 4-3 6c-1.8-2-3-4-3-6s1.2-4 3-6z" /></Icon>;
export const IcChain: Ic = (p) => <Icon {...p}><path d="M6.5 9.5L9.5 6.5" /><path d="M5 11l-1 1a2.5 2.5 0 0 1-3.5-3.5l2-2A2.5 2.5 0 0 1 6 7" /><path d="M11 5l1-1a2.5 2.5 0 0 1 3.5 3.5l-2 2A2.5 2.5 0 0 1 10 9" /></Icon>;
export const IcHash: Ic = (p) => <Icon {...p}><path d="M5 2l-1 12M11 2l-1 12M2 5.5h12M2 10.5h12" /></Icon>;
export const IcDanger: Ic = (p) => <Icon {...p}><circle cx="8" cy="8" r="6" /><path d="M8 4.5v4M8 11v.01" /></Icon>;
export const IcRedact: Ic = (p) => <Icon {...p}><rect x="2" y="6" width="12" height="4" /><path d="M3 8h2M7 8h2M11 8h2" /></Icon>;
export const IcSparkle: Ic = (p) => <Icon {...p}><path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l1.5 1.5M10.5 10.5L12 12M4 12l1.5-1.5M10.5 5.5L12 4" /></Icon>;
export const IcAi: Ic = (p) => (
  <Icon {...p}><rect x="3" y="4" width="10" height="8" rx="1.5" /><path d="M6 4V2.5M10 4V2.5M3 7h-1M14 7h-1M3 10h-1M14 10h-1" /><circle cx="6.5" cy="8" r="0.7" fill="currentColor" /><circle cx="9.5" cy="8" r="0.7" fill="currentColor" /></Icon>
);
export const IcFolder: Ic = (p) => <Icon {...p}><path d="M2 4.5h4l1.5 1.5h6.5v8h-12z" /></Icon>;
export const IcPaperclip: Ic = (p) => <Icon {...p}><path d="M11.5 7L7 11.5a2.5 2.5 0 0 1-3.5-3.5L8 3.5a1.5 1.5 0 0 1 2 2L6 9.5" /></Icon>;
export const IcSend: Ic = (p) => <Icon {...p}><path d="M14 2L2 7l4.5 1.5L14 2zM14 2L8 14l-1.5-5.5" /></Icon>;
export const IcRefresh: Ic = (p) => <Icon {...p}><path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L14 6" /><path d="M14 2.5V6h-3.5" /><path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2 10" /><path d="M2 13.5V10h3.5" /></Icon>;
export const IcGrid: Ic = (p) => <Icon {...p}><rect x="2" y="2" width="5" height="5" /><rect x="9" y="2" width="5" height="5" /><rect x="2" y="9" width="5" height="5" /><rect x="9" y="9" width="5" height="5" /></Icon>;
export const IcList: Ic = (p) => (
  <Icon {...p}><path d="M5 4h9M5 8h9M5 12h9" /><circle cx="2.5" cy="4" r="0.5" fill="currentColor" /><circle cx="2.5" cy="8" r="0.5" fill="currentColor" /><circle cx="2.5" cy="12" r="0.5" fill="currentColor" /></Icon>
);
export const IcGov: Ic = (p) => <Icon {...p}><path d="M2 13.5h12M3 13.5V7M13 13.5V7M5.5 13.5V7M10.5 13.5V7M2 7h12L8 2.5z" /></Icon>;
