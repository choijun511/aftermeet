import React from 'react'

// 轻量内联 SVG 图标(stroke 风格,currentColor 上色)。避免引第三方图标库。
type P = { size?: number; className?: string; strokeWidth?: number; style?: React.CSSProperties }
const svg = (
  path: React.ReactNode,
  { size = 18, className, strokeWidth = 2, style }: P,
  fill = false
): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flex: 'none', ...style }}
  >
    {path}
  </svg>
)

export const IcMic = (p: P): React.JSX.Element =>
  svg(
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
    </>,
    p
  )
export const IcHome = (p: P): React.JSX.Element =>
  svg(<path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />, p)
export const IcLibrary = (p: P): React.JSX.Element =>
  svg(
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M9 4v16" />
    </>,
    p
  )
export const IcCheckSquare = (p: P): React.JSX.Element =>
  svg(
    <>
      <path d="M9 11.5l2.2 2.2L15.5 9" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    </>,
    p
  )
export const IcSettings = (p: P): React.JSX.Element =>
  svg(
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>,
    p
  )
export const IcSearch = (p: P): React.JSX.Element =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </>,
    p
  )
export const IcPlay = (p: P): React.JSX.Element => svg(<path d="M7 4.5v15l12-7.5z" />, p, true)
export const IcStop = (p: P): React.JSX.Element =>
  svg(<rect x="6" y="6" width="12" height="12" rx="2.5" />, p, true)
export const IcPlus = (p: P): React.JSX.Element => svg(<path d="M12 5v14M5 12h14" />, p)
export const IcChevronLeft = (p: P): React.JSX.Element => svg(<path d="m15 5-7 7 7 7" />, p)
export const IcChevronRight = (p: P): React.JSX.Element => svg(<path d="m9 5 7 7-7 7" />, p)
export const IcArrowLeft = (p: P): React.JSX.Element =>
  svg(<path d="M19 12H5M11 6l-6 6 6 6" />, p)
export const IcRefresh = (p: P): React.JSX.Element =>
  svg(<path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" />, p)
export const IcCalendar = (p: P): React.JSX.Element =>
  svg(
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>,
    p
  )
export const IcClock = (p: P): React.JSX.Element =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </>,
    p
  )
export const IcCheck = (p: P): React.JSX.Element => svg(<path d="M5 12.5 10 17 19 7" />, p)
export const IcAlert = (p: P): React.JSX.Element =>
  svg(<path d="M12 3 2 20h20L12 3zM12 9v5M12 17.5v.5" />, p)
export const IcSparkles = (p: P): React.JSX.Element =>
  svg(
    <>
      <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
      <path d="M18 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </>,
    p,
    true
  )
export const IcSend = (p: P): React.JSX.Element =>
  svg(<path d="M4 12 20 4l-6 16-3.5-6.5L4 12z" />, p)
export const IcFolder = (p: P): React.JSX.Element =>
  svg(<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5H20A1 1 0 0 1 21 9.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" />, p)
export const IcTrash = (p: P): React.JSX.Element =>
  svg(<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />, p)
export const IcEdit = (p: P): React.JSX.Element =>
  svg(<path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />, p)
export const IcX = (p: P): React.JSX.Element => svg(<path d="M6 6l12 12M18 6 6 18" />, p)
export const IcVideo = (p: P): React.JSX.Element =>
  svg(
    <>
      <rect x="3" y="6" width="12.5" height="12" rx="2.5" />
      <path d="M15.5 10l5.5-3v10l-5.5-3z" />
    </>,
    p
  )
export const IcDoc = (p: P): React.JSX.Element =>
  svg(
    <>
      <path d="M6 2.5h8l4 4V21a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 21z" />
      <path d="M14 2.5V7h4M9 12h6M9 16h6" />
    </>,
    p
  )
