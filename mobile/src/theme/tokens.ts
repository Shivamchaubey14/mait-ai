/**
 * Design tokens for the Mait mobile app (SRS §10, docs/DESIGN_SYSTEM.md).
 *
 * The mirror of `admin-web/assets/css/tokens.css`. Both files carry the same palette, so a
 * completed AI event is the same green in the app and on the admin dashboard — field users
 * learn colour faster than they learn labels.
 *
 * Import the semantic role (`colors.success`), never the raw hex. A role can be re-pointed
 * in one place; `#66BB6A` scattered across forty screens cannot.
 */

export const colors = {
  // Brand
  primary: '#43637E',
  primaryDark: '#325E6A',
  secondary: '#8FA28A',

  // Status — used consistently everywhere (docs/DESIGN_SYSTEM.md)
  success: '#66BB6A', // completed AI, payment success
  successAlt: '#249D8F', // inventory OK, positive KPI
  error: '#BD4444', // validation errors, low stock
  errorDark: '#B34A44', // critical alerts
  warning: '#FFF449', // pending OTP, low straw count
  info: '#78A4CB', // informational banners, links

  // Accents
  accent: '#E98B50', // the step-advancing CTA in the AI flow
  accentAlt: '#EC5B38', // badges, tags
  highlight: '#C8A96B',
  highlightAlt: '#BA6A4C',

  // Text & surfaces
  text: '#2C3639',
  textMuted: '#524646',
  neutral: '#464858', // borders, dividers, icons
  surface: '#FFFFFF',
  background: '#F7F8F9',
} as const;

/**
 * `warning` is a bright yellow that fails contrast against white. Never put text on it on a
 * light surface — use it as a fill or a status dot with `colors.text` on top.
 */
export const unsafeForTextOnLight = [colors.warning];

/**
 * Loaded via @expo-google-fonts in App.tsx. These are the variant names the loader
 * registers — referring to a bare "Lexend" silently falls back to the system font, which
 * looks almost right and is therefore easy to miss.
 */
export const fonts = {
  heading: 'Lexend_600SemiBold',
  headingBold: 'Lexend_700Bold',
  headingRegular: 'Lexend_400Regular',
  body: 'Quicksand_500Medium',
  bodyRegular: 'Quicksand_400Regular',
  bodySemibold: 'Quicksand_600SemiBold',
} as const;

export const fontWeights = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Body text never goes below 15px — the user base is semi-literate and often outdoors. */
export const typography = {
  display: { fontSize: 32, lineHeight: 40, fontFamily: fonts.heading },
  h1: { fontSize: 24, lineHeight: 32, fontFamily: fonts.heading },
  h2: { fontSize: 20, lineHeight: 28, fontFamily: fonts.heading },
  h3: { fontSize: 17, lineHeight: 24, fontFamily: fonts.heading },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fonts.body },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fonts.body },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fonts.body },
} as const;

/** 4px base scale. */
export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 24,
  6: 32,
  7: 40,
  8: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const shadows = {
  card: {
    shadowColor: '#2C3639',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  },
  raised: {
    shadowColor: '#2C3639',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

/**
 * Minimum touch target. Field users tap with cold, wet or gloved hands, often in sunlight —
 * anything smaller than this gets mis-tapped (SRS §7 Usability).
 */
export const MIN_TOUCH_TARGET = 48;

/** Status colour for an AI event, keyed by the server-side state machine (SRS §11). */
export const aiEventStatusColor: Record<string, string> = {
  draft: colors.neutral,
  straw_verified: colors.info,
  photo_captured: colors.info,
  payment_pending: colors.warning,
  completed: colors.success,
  cancelled: colors.error,
};

export const theme = {
  colors,
  fonts,
  fontWeights,
  typography,
  spacing,
  radius,
  shadows,
} as const;

export type Theme = typeof theme;
