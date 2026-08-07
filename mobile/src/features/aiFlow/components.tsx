/**
 * The capture flow's shared furniture (docs/DESIGN_SYSTEM.md — "Capture-flow screen
 * pattern").
 *
 * Every one of the six steps is the same three bands: a green hero carrying the step, the
 * progress and the question; a white body; one CTA in the footer. Building that once means a
 * Mait learns the shape on step 1 and it never moves under them — and it means a new step is
 * a body, not a screen.
 */

import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { BrandMark, HeroDecoration } from '@/components/brand';
import { AI_FLOW_STEPS } from '@/config/env';
import { colors, MIN_TOUCH_TARGET, radius, shadows, spacing, typography } from '@theme/tokens';

// --------------------------------------------------------------------------------------
// Progress
// --------------------------------------------------------------------------------------
/**
 * All six segments, always.
 *
 * Hiding the steps that are still ahead would make the flow feel open-ended, and a Mait
 * standing in a yard needs to know how much is left before they start.
 */
function ProgressSegments({ step }: { step: number }): React.JSX.Element {
  return (
    <View style={styles.track}>
      {AI_FLOW_STEPS.map((name, index) => (
        <View key={name} style={[styles.segment, index <= step && styles.segmentDone]} />
      ))}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Screen scaffold
// --------------------------------------------------------------------------------------
interface FlowScreenProps {
  /** Zero-based step index, or null for a screen outside the numbered six. */
  step: number | null;
  /** Overrides the "Step n of 6" label — used by the screens that are not numbered steps. */
  stepLabel?: string;
  /** The question, asked as a question. */
  title: string;
  subtitle?: string;
  onBack?: () => void;
  /** Shown as a tick instead of a back arrow on the terminal screen. */
  done?: boolean;
  children: React.ReactNode;
  /** The footer CTA. Absent, the footer is not rendered at all. */
  cta?: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    busy?: boolean;
    testID?: string;
  };
  /** A secondary route out of the step. A text link, never a second button. */
  link?: { label: string; onPress: () => void; testID?: string };
  /** Pins the hero and scrolls only the body. For forms longer than a screen. */
  stickyHero?: boolean;
  /** A line above the CTA — a running total, a readiness note. */
  footerNote?: React.ReactNode;
}

export function FlowScreen({
  step,
  stepLabel,
  title,
  subtitle,
  onBack,
  done = false,
  children,
  cta,
  link,
  stickyHero = false,
  footerNote,
}: FlowScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const label =
    stepLabel ??
    (step === null ? '' : t('aiFlow.stepOf', { current: step + 1, total: AI_FLOW_STEPS.length }));

  /* The inset is padding rather than a SafeAreaView: that component measures its own frame,
     and inside a ScrollView the measurement is unreliable. */
  const hero = (
    <View style={[styles.hero, { paddingTop: insets.top + spacing[3] }]}>
      <HeroDecoration size={200} top={-80} right={-60} />

      <View style={styles.heroTop}>
        {done ? (
          <View style={[styles.backButton, styles.doneMark]}>
            <Ionicons name="checkmark" size={20} color={colors.surface} />
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
            onPress={onBack}
            disabled={!onBack}
            style={({ pressed }) => [styles.backButton, pressed && styles.backPressed]}
            testID="flow-back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.surface} />
          </Pressable>
        )}
        {!!label && <Text style={styles.stepLabel}>{label}</Text>}
        {/* The mark rides here too, so the flow is visibly the same app as the tabs
                  it is layered over. */}
        <View style={styles.heroMark}>
          <BrandMark size="small" />
        </View>
      </View>

      {(step !== null || done) && (
        <ProgressSegments step={done ? AI_FLOW_STEPS.length : (step ?? -1)} />
      )}

      <Text style={styles.heroTitle}>{title}</Text>
      {!!subtitle && <Text style={styles.heroSubtitle}>{subtitle}</Text>}
    </View>
  );

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Pinned above the scroll view when asked for: on a form longer than a screen the
            title is the one thing worth keeping in view, because it says what the fields
            below belong to. */}
        {stickyHero && hero}

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!stickyHero && hero}

          <View
            style={[
              styles.body,
              { paddingLeft: spacing[5] + insets.left, paddingRight: spacing[5] + insets.right },
            ]}
          >
            {children}
          </View>

          {(cta || link || footerNote) && (
            <View
              style={[
                styles.footer,
                {
                  paddingLeft: spacing[5] + insets.left,
                  paddingRight: spacing[5] + insets.right,
                  paddingBottom: spacing[4] + insets.bottom,
                },
              ]}
            >
              {footerNote}

              {!!link && (
                <Pressable
                  accessibilityRole="button"
                  onPress={link.onPress}
                  style={styles.link}
                  testID={link.testID}
                >
                  <Text style={styles.linkLabel}>{link.label}</Text>
                </Pressable>
              )}

              {!!cta && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !!cta.disabled || !!cta.busy, busy: cta.busy }}
                  onPress={cta.onPress}
                  disabled={cta.disabled || cta.busy}
                  style={({ pressed }) => [
                    styles.cta,
                    cta.disabled || cta.busy ? styles.ctaDisabled : styles.ctaEnabled,
                    pressed && !cta.disabled && !cta.busy && styles.ctaPressed,
                  ]}
                  testID={cta.testID}
                >
                  <Text
                    style={[styles.ctaLabel, (cta.disabled || cta.busy) && styles.ctaLabelDisabled]}
                  >
                    {cta.label}
                  </Text>
                  <Ionicons
                    name="arrow-forward"
                    size={18}
                    color={cta.disabled || cta.busy ? colors.textDisabled : colors.surface}
                  />
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** Pushes the footer to the foot of the screen when the body is short. */
export function FlowSpacer(): React.JSX.Element {
  return <View style={styles.spacer} />;
}

// --------------------------------------------------------------------------------------
// Selectable row
// --------------------------------------------------------------------------------------
type Tone = 'primary' | 'accent' | 'info' | 'neutral';

const SWATCH: Record<Tone, string> = {
  primary: colors.primaryWash,
  accent: colors.secondaryWash,
  info: colors.infoWash,
  neutral: colors.background,
};

const SWATCH_TINT: Record<Tone, string> = {
  primary: colors.primaryDark,
  accent: colors.secondaryPressed,
  info: colors.info,
  neutral: colors.textMuted,
};

interface OptionCardProps {
  title: string;
  subtitle?: string;
  /** Drawn inside the swatch. Without one the swatch is a plain colour block. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** Right-hand qualifier, e.g. "Nearest". */
  pill?: string;
  selected?: boolean;
  /**
   * Blocked rows stay on screen rather than disappearing: a Mait who cannot find a farmer
   * they know is registered will assume the app is broken. The reason replaces the subtitle.
   */
  blockedReason?: string;
  tone?: Tone;
  /** Renders the right-hand radio dot, for a one-of-N choice. */
  radio?: boolean;
  onPress?: () => void;
  testID?: string;
}

export function OptionCard({
  title,
  subtitle,
  icon,
  pill,
  selected = false,
  blockedReason,
  tone = 'primary',
  radio = false,
  onPress,
  testID,
}: OptionCardProps): React.JSX.Element {
  const blocked = !!blockedReason;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: blocked, selected }}
      onPress={onPress}
      disabled={blocked || !onPress}
      style={({ pressed }) => [
        styles.card,
        selected && styles.cardSelected,
        blocked && styles.cardBlocked,
        pressed && !blocked && !selected && styles.cardPressed,
      ]}
      testID={testID}
    >
      <View
        style={[styles.swatch, { backgroundColor: blocked ? colors.disabledFill : SWATCH[tone] }]}
      >
        {!!icon && (
          <Ionicons
            name={icon}
            size={16}
            color={blocked ? colors.textDisabled : SWATCH_TINT[tone]}
          />
        )}
      </View>

      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, blocked && styles.blockedText]} numberOfLines={1}>
          {title}
        </Text>
        {blocked ? (
          <Text style={styles.cardReason}>{blockedReason}</Text>
        ) : (
          !!subtitle && (
            <Text style={styles.cardSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )
        )}
      </View>

      {!!pill && (
        <View style={[styles.pill, blocked && styles.pillBlocked]}>
          <Text style={[styles.pillLabel, blocked && styles.pillLabelBlocked]}>{pill}</Text>
        </View>
      )}

      {radio && <View style={[styles.radio, selected && styles.radioOn]} />}
    </Pressable>
  );
}

// --------------------------------------------------------------------------------------
// Field card
// --------------------------------------------------------------------------------------
/**
 * A labelled input, in the same card shape as everything else on the screen.
 *
 * The label sits above the value and stays there. A placeholder-as-label vanishes exactly
 * when a hesitant user needs it, and this flow is used by people who are hesitant by
 * definition — they are doing it for the first time, standing in someone's yard.
 */
export function FieldCard({
  label,
  hint,
  error,
  tone = 'primary',
  ...inputProps
}: {
  label: string;
  hint?: string;
  error?: string | null;
  tone?: Tone;
} & TextInputProps): React.JSX.Element {
  return (
    <View style={styles.fieldWrap}>
      <View style={[styles.card, !!error && styles.cardError]}>
        <View style={[styles.swatch, { backgroundColor: SWATCH[tone] }]} />
        <View style={styles.cardBody}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={styles.fieldInput}
            placeholderTextColor={colors.textDisabled}
            accessibilityLabel={label}
            {...inputProps}
          />
        </View>
      </View>
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
      {!error && !!hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Info tile
// --------------------------------------------------------------------------------------
/** A single figure that matters — an amount, a stock count — with its qualifier. */
export function InfoTile({
  label,
  value,
  pill,
  testID,
}: {
  label: string;
  value: string;
  pill?: string;
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.tile} testID={testID}>
      <View style={styles.cardBody}>
        <Text style={styles.tileLabel}>{label}</Text>
        <Text style={styles.tileValue}>{value}</Text>
      </View>
      {!!pill && (
        <View style={styles.tilePill}>
          <Text style={styles.pillLabel}>{pill}</Text>
        </View>
      )}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Notice
// --------------------------------------------------------------------------------------
/** Yellow to do something, blue to know something, red for something wrong. */
export function FlowNotice({
  tone,
  title,
  body,
  /** Overrides the tone's default glyph when the notice means something more specific. */
  icon,
  testID,
}: {
  tone: 'accent' | 'info' | 'error';
  title: string;
  body?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  testID?: string;
}): React.JSX.Element {
  const { swatch, wash, glyph } = {
    accent: {
      swatch: colors.secondary,
      wash: colors.secondaryWash,
      glyph: 'warning' as const,
    },
    info: {
      swatch: colors.info,
      wash: colors.infoWash,
      glyph: 'information-circle' as const,
    },
    error: {
      swatch: colors.error,
      wash: colors.errorWash,
      glyph: 'alert-circle' as const,
    },
  }[tone];

  return (
    <View style={[styles.notice, { backgroundColor: wash }]} testID={testID}>
      {/* A glyph, not a blank square. A coloured block asks the reader to remember what the
          colour meant; a warning triangle does not. */}
      <View style={[styles.noticeSwatch, { backgroundColor: swatch }]}>
        <Ionicons name={icon ?? glyph} size={15} color={colors.surface} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        {!!body && <Text style={styles.cardSubtitle}>{body}</Text>}
      </View>
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Section heading
// --------------------------------------------------------------------------------------
export function FlowLabel({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}): React.JSX.Element {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },

  // -- hero -----------------------------------------------------------------------------
  hero: {
    backgroundColor: colors.primary,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
    overflow: 'hidden',
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  heroMark: { marginLeft: 'auto' },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: { backgroundColor: 'rgba(255,255,255,0.34)' },
  doneMark: { backgroundColor: 'rgba(255,255,255,0.3)' },
  stepLabel: { ...typography.label, color: colors.surface },

  track: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] },
  segment: {
    flex: 1,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  segmentDone: { backgroundColor: colors.surface },

  heroTitle: { ...typography.h1, color: colors.surface },
  heroSubtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.92,
    marginTop: spacing[2],
  },

  // -- body -----------------------------------------------------------------------------
  body: { flexGrow: 1, paddingTop: spacing[5] },
  spacer: { flexGrow: 1, minHeight: spacing[5] },
  label: { ...typography.label, color: colors.text, marginBottom: spacing[2] },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing[3],
    marginBottom: spacing[2],
  },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
  cardPressed: { backgroundColor: colors.background },
  cardBlocked: { backgroundColor: colors.background, borderColor: colors.border },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitle: { ...typography.bodyStrong, color: colors.ink },
  cardSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  // The reason a row cannot be used is the one thing on it worth reading, so it is not muted.
  cardReason: { ...typography.caption, color: colors.error, marginTop: 2 },
  blockedText: { color: colors.textDisabled },

  cardError: { borderColor: colors.error },

  fieldWrap: { marginBottom: spacing[2] },
  fieldLabel: { ...typography.caption, color: colors.textMuted },
  fieldInput: {
    ...typography.bodyStrong,
    color: colors.ink,
    paddingVertical: 2,
    // Android draws a default underline and its own vertical padding here; both fight the
    // card the field sits in.
    paddingHorizontal: 0,
  },
  fieldHint: { ...typography.caption, color: colors.textMuted, marginTop: -spacing[1] },
  fieldError: { ...typography.caption, color: colors.error, marginTop: -spacing[1] },

  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  tileLabel: { ...typography.caption, color: colors.textMuted },
  tileValue: { ...typography.h1, color: colors.ink, marginTop: 2 },
  tilePill: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    backgroundColor: colors.primaryWash,
  },

  pill: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radius.pill,
    backgroundColor: colors.primaryWash,
  },
  pillBlocked: { backgroundColor: colors.errorWash },
  pillLabel: { ...typography.caption, color: colors.primaryDark },
  pillLabelBlocked: { color: colors.error },

  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: radius.md,
    padding: spacing[3],
    marginTop: spacing[2],
  },
  noticeSwatch: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // -- footer ---------------------------------------------------------------------------
  footer: { paddingTop: spacing[4] },
  link: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: { ...typography.bodyStrong, color: colors.primaryDark },
  // The same pill the bar's action wears. A primary action should be one shape everywhere,
  // or a Mait learns two.
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: MIN_TOUCH_TARGET + 4,
    paddingHorizontal: spacing[5],
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: colors.surface,
    ...shadows.raised,
  },
  ctaEnabled: { backgroundColor: colors.primary },
  ctaDisabled: { backgroundColor: colors.disabledFill },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  ctaLabel: { ...typography.bodyStrong, color: colors.surface },
  ctaLabelDisabled: { color: colors.textDisabled },
});
