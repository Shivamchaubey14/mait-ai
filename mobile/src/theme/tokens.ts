/**
 * Design tokens for the Mait mobile app.
 *
 * Source of truth: docs/SCREEN_INVENTORY.md. Mirrored for the admin portal in
 * `admin-web/assets/css/tokens.css` — a completed AI event must be the same green in the
 * app, the admin table and the dashboard chart, because field users learn colour faster than
 * they learn labels.
 *
 * This palette supersedes the one in SRS §10.2.
 *
 * Import the semantic role (`colors.success`), never a raw hex or a scale step. A role can be
 * re-pointed in one place; `#3BB77E` scattered across forty screens cannot.
 */

// --------------------------------------------------------------------------------------
// Scales — reach for these only when a role does not already exist
// --------------------------------------------------------------------------------------
export const green = {
  50: '#EAF7F1',
  100: '#CDECDE',
  200: '#9FDCC0',
  300: '#71CCA1',
  400: '#52C08D',
  500: '#3BB77E',
  600: '#329C6B',
  700: '#287D56',
  800: '#1E5E41',
  900: '#143E2B',
} as const;

export const yolk = {
  50: '#FFF8E9',
  100: '#FEEDC4',
  200: '#FEE19E',
  300: '#FED578',
  400: '#FDCB5C',
  500: '#FDC040',
  600: '#E0A52F',
  700: '#B98421',
  800: '#8C6315',
  900: '#5E420C',
} as const;

export const ink = {
  50: '#EEF1F3',
  100: '#D4DBE0',
  200: '#AEB9C1',
  300: '#8897A3',
  400: '#5E7180',
  500: '#3D566A',
  600: '#253D4E',
  700: '#1D303D',
  800: '#15232D',
  900: '#0C151B',
} as const;

// --------------------------------------------------------------------------------------
// Roles
// --------------------------------------------------------------------------------------
export const colors = {
  /** Nest Green. One green screen-owning action per screen — never two competing. */
  primary: green[500],
  primaryPressed: green[600],
  primaryDark: green[700],
  primaryWash: green[50],

  /** Cream Yolk. An accent only: notices, badges, pending state. Never a primary button. */
  secondary: yolk[500],
  secondaryPressed: yolk[600],
  secondaryWash: yolk[50],

  /** Ink carries all text and every dark surface — splash, hero headers, nav. */
  ink: ink[600],

  // Status — identical meanings everywhere in the product.
  success: green[500],
  warning: yolk[500],
  error: '#E54D42',
  info: '#3E92E5',

  text: ink[600],
  textMuted: '#7A8893',
  textDisabled: ink[300],

  border: '#E3E7E9',
  surface: '#FFFFFF',
  background: '#F4F5F3',
  disabledFill: ink[100],
} as const;

/**
 * Cream Yolk fails contrast against white. It is a fill, a border or a badge with
 * `colors.text` on top — never light text on yellow, never yellow text on a pale surface.
 */
export const unsafeForTextOnLight = [colors.warning, colors.secondary];

// --------------------------------------------------------------------------------------
// Typography
// --------------------------------------------------------------------------------------
/**
 * Loaded via @expo-google-fonts in App.tsx. These are the variant names the loader
 * registers — a bare "Quicksand" resolves to nothing and silently falls back to the system
 * font, which looks almost right and is therefore easy to miss.
 *
 * Two families only. No third face anywhere.
 */
export const fonts = {
  headingBold: 'Quicksand_700Bold',
  heading: 'Quicksand_600SemiBold',
  body: 'NunitoSans_400Regular',
  bodyStrong: 'NunitoSans_600SemiBold',
} as const;

/**
 * Numbers, the +91 prefix and OTP digits use the heading face so they read as display
 * rather than copy.
 */
export const typography = {
  display: { fontSize: 32, lineHeight: 40, fontFamily: fonts.headingBold },
  h1: { fontSize: 24, lineHeight: 32, fontFamily: fonts.headingBold },
  h2: { fontSize: 20, lineHeight: 28, fontFamily: fonts.headingBold },
  h3: { fontSize: 17, lineHeight: 24, fontFamily: fonts.heading },
  body: { fontSize: 15, lineHeight: 22, fontFamily: fonts.body },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontFamily: fonts.bodyStrong },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bodyStrong },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: fonts.body },
} as const;

// --------------------------------------------------------------------------------------
// Spacing, radius, elevation
// --------------------------------------------------------------------------------------
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
  sm: 10,
  md: 12,
  lg: 18,
  xl: 30,
  pill: 999,
} as const;

export const shadows = {
  card: {
    shadowColor: '#253D4E',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 3,
    elevation: 2,
  },
  raised: {
    shadowColor: '#253D4E',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 40,
    elevation: 8,
  },
} as const;

/**
 * Minimum touch target. Field users tap with cold, wet or gloved hands, often in sunlight —
 * anything smaller than this gets mis-tapped.
 */
export const MIN_TOUCH_TARGET = 48;

/** Status colour for an AI event, keyed by the server-side state machine (SRS §11). */
export const aiEventStatusColor: Record<string, string> = {
  draft: colors.textMuted,
  straw_verified: colors.info,
  photo_captured: colors.info,
  payment_pending: colors.warning,
  completed: colors.success,
  cancelled: colors.error,
};

export const theme = {
  colors,
  fonts,
  typography,
  spacing,
  radius,
  shadows,
} as const;

export type Theme = typeof theme;
