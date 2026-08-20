/**
 * The capture flow's shared furniture (docs/DESIGN_SYSTEM.md — "Capture-flow screen
 * pattern").
 *
 * Every one of the six steps is the same three bands: an Ink hero carrying the step, the
 * progress and the question; a body; one CTA in the footer. Building that once means a Mait
 * learns the shape on step 1 and it never moves under them — and it means a new step is a
 * body, not a screen.
 *
 * The hero and the footer are fixed; only the band between them scrolls. Both are opaque, so
 * a long list passes behind them rather than through them.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { BrandMark } from '@/components/brand';
import { useKeyboardOverlap } from '@/components/keyboard';
import { AI_FLOW_STEPS } from '@/config/env';
import {
  colors,
  fonts,
  MIN_TOUCH_TARGET,
  radius,
  shadows,
  spacing,
  typography,
  yolk,
} from '@theme/tokens';

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

/** The footer arrow, and the width the label is balanced against on the other side. */
const ARROW_SIZE = 18;

// --------------------------------------------------------------------------------------
// Keyboard
// --------------------------------------------------------------------------------------
/**
 * Bringing the field a Mait just tapped above the keyboard.
 *
 * The footer already rides up — it is pinned to the bottom of a container that shrinks when
 * the keyboard opens, on Android by `adjustResize` and on iOS by `KeyboardAvoidingView`. The
 * *body* does not move, so on a short handset the button was visible above the keyboard and
 * the box being typed into was behind it. A Mait typing a code they cannot see is a Mait who
 * cannot tell a mistyped digit from a wrong one.
 *
 * So a focused field asks to be scrolled into the part of the screen that is still visible.
 * Twice: once on focus, and again once the keyboard has finished opening, because focus fires
 * before the viewport has shrunk and the first measurement is against a screen that is about
 * to change size.
 */
interface FlowScrollApi {
  reveal: (field: View | null) => void;
}

/**
 * Exported so a scrolling body that is not a `FlowScreen` can provide one too — the add-animal
 * sheet is the case. A field never reaches for this itself; it only ever consumes it.
 */
export const FlowScroll = createContext<FlowScrollApi | null>(null);

/** How much of the screen is left above the field, so its label comes up with it. */
const REVEAL_GAP = spacing[4];

/**
 * Wire a scrolling body to the fields inside it.
 *
 * Returns the ref to put on the `ScrollView`, the keyboard overlap for whatever padding the
 * caller needs, and the context value that lets a field call back in. Shared by the flow's
 * screens and by the sheet that opens over them — a sheet has the same problem and had the
 * same half-fix, a hand-written `scrollToEnd` on the one field somebody noticed.
 */
export function useRevealOnFocus() {
  const scroller = useRef<ScrollView>(null);
  /**
   * The scroll's inner content view, handed in by `innerViewRef`.
   *
   * `measureLayout` wants a ref to a native component. Given `getInnerViewNode()` — a node
   * handle, and the obvious-looking thing to reach for — the new architecture rejects it with
   * "ref.measureLayout must be called with a ref to a native component", the callback never
   * fires, and the field silently never moves. The failure is invisible in Jest, where the
   * method is stubbed, and shows up only on a device.
   */
  // `null!` because `innerViewRef` is typed `RefObject<View>` rather than allowing null, and
  // a ref is null until the view mounts. Nothing reads it before then — every use is inside a
  // callback fired by a focus, which cannot happen before the scroll has rendered.
  const content = useRef<View>(null!);
  const pending = useRef<View | null>(null);
  const overlap = useKeyboardOverlap();

  const scrollTo = useCallback((field: View | null) => {
    const scroll = scroller.current;
    const inner = content.current;
    if (!field || !scroll || !inner) {
      return;
    }
    // Measured against the scroll's own content, so `top` is already the offset to scroll to
    // rather than a position on the screen that has to be converted into one.
    field.measureLayout(
      inner,
      (_left: number, top: number) => {
        scroll.scrollTo({ y: Math.max(0, top - REVEAL_GAP), animated: true });
      },
      () => {
        // The field left the tree between focus and measure. Nothing to bring into view.
      },
    );
  }, []);

  const reveal = useCallback(
    (field: View | null) => {
      pending.current = field;
      // After the current frame: on focus the keyboard has not opened yet, so this first pass
      // only helps when it is already up — switching from one field to another.
      requestAnimationFrame(() => scrollTo(field));
    },
    [scrollTo],
  );

  // The keyboard has finished opening and the viewport is its final size. This is the pass
  // that actually does the work the first time a field is tapped.
  useEffect(() => {
    if (overlap > 0 && pending.current) {
      scrollTo(pending.current);
    }
  }, [overlap, scrollTo]);

  // Nothing is focused any more, so nothing should be chased on the next keyboard event.
  useEffect(() => {
    if (overlap === 0) {
      pending.current = null;
    }
  }, [overlap]);

  const api = useMemo<FlowScrollApi>(() => ({ reveal }), [reveal]);

  return { scroller, content, overlap, api };
}

/**
 * Opt one input into the reveal, for the screens whose field is not `LabelledField`.
 *
 * `RequestStockScreen`'s quantity box sits between two stepper buttons and is a bare
 * `TextInput` for that reason. It is still a box a Mait types into, halfway down a form that
 * grows a row per product, so it needs the same treatment — this is the two props that give
 * it one. The flow's own field components use it internally; a screen only reaches for it
 * when it is building an input of its own.
 */
export function useFieldReveal() {
  const ref = useRef<View>(null);
  const flow = useContext(FlowScroll);
  const onFocus = useCallback(() => flow?.reveal(ref.current), [flow]);
  return { ref, onFocus };
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
  /**
   * Green instead of Ink, for the screens that carry a settled fact rather than a question.
   *
   * Nothing to collect, and Recorded. Both are statements, and a Mait reading green knows the
   * answer before they have read the words — which is the point of a colour that means one
   * thing everywhere in the product.
   */
  tone?: 'ink' | 'good';
  /** A short word above the question — "Payment", "Proof of payment". */
  eyebrow?: string;
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
  /** A line above the CTA — a running total, a readiness note. */
  footerNote?: React.ReactNode;
  /**
   * Pinned directly under the hero, above the scrolling body.
   *
   * For a search box over a long list: the control that filters the list has to stay reachable
   * while the list moves, or finding a name at the bottom means scrolling back to the top to
   * type it.
   */
  stickyTop?: React.ReactNode;
  /**
   * Pull-to-refresh for the steps that read a list off the server.
   *
   * A Mait standing in a yard with one bar of signal reaches for this before they think to
   * question the app, so every step that can go stale should offer it.
   */
  refresh?: { refreshing: boolean; onRefresh: () => void };
  /**
   * There is a tab bar under this screen, so the footer must not reserve the safe area again.
   *
   * The bar already pads itself clear of the home indicator. Adding the same inset here on top
   * of it opens a second gap the height of the first, which on a gesture-navigation handset is
   * most of an empty row between the button and the bar.
   */
  tabBarBelow?: boolean;
  /**
   * This screen is a place a Mait arrives at, not a step in the capture.
   *
   * It changes the top row only. A place wears the mark, the way every tab screen does; a
   * step leads with the way out and labels itself "3 of 6". The hero's shape is the same
   * either way — welded to the top of the screen, full width.
   */
  place?: boolean;
}

export function FlowScreen({
  step,
  stepLabel,
  title,
  subtitle,
  onBack,
  done = false,
  tone = 'ink',
  eyebrow,
  children,
  cta,
  link,
  footerNote,
  stickyTop,
  refresh,
  tabBarBelow = false,
  place = false,
}: FlowScreenProps): React.JSX.Element {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { scroller, content, overlap, api } = useRevealOnFocus();

  const label =
    stepLabel ??
    (step === null ? '' : t('aiFlow.stepOf', { current: step + 1, total: AI_FLOW_STEPS.length }));

  const backControl = (
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
  );

  /* Welded to the top of the screen and running the full width of it, with only the bottom
     corners rounded — the shape every other hero in this app wears, so the flow does not
     arrive looking like a different product.

     It used to float on the page, inset on all four sides. That was drawn as a card being
     dealt and replaced, one of six, which reads well on paper and less well on a handset: the
     strip of grey above it wasted the scarcest room on the screen, the status bar sat on the
     page's own colour while every other screen had it on Ink, and the gutters made the hero a
     narrower column than the cards underneath it.

     The insets are padding rather than margin, because the Ink has to reach behind the status
     bar while the text starts below it. */
  const hero = (
    <View
      style={[
        styles.hero,
        tone === 'good' && styles.heroGood,
        {
          paddingTop: insets.top + spacing[4],
          paddingLeft: spacing[5] + insets.left,
          paddingRight: spacing[5] + insets.right,
        },
      ]}
    >
      {/* Two rows, because a place and a step are answering different questions.

          A place wears the row every `PageHero` screen wears: the mark on the left, and
          whatever control the screen needs on the right. A Mait hands this phone to a farmer
          to read an OTP off, and the app should say whose app it is wherever they are — so
          the mark leads, and it is in the same spot on every screen that has one.

          A step leads with the way out and labels itself "3 of 6". It gets no mark: inside
          the flow the hero is one of six being replaced, and stamping the same tile on each
          of them in turn is not branding, it is noise. */}
      {done ? (
        // Nothing to go back to and no step to count: the capture is over. What is left is
        // the one fact the Mait came here for, so the tick leads and everything under it is
        // centred on it. A back arrow in the corner of this screen would offer to undo an
        // insemination that has already been recorded.
        <View style={styles.heroDone}>
          <View style={styles.doneDisc}>
            <Ionicons name="checkmark" size={30} color={colors.surface} />
          </View>
        </View>
      ) : place ? (
        <View style={styles.heroTop}>
          <BrandMark size="small" />
          {/* Omitted rather than greyed when the screen has no way back. A dead circle where
              every other screen keeps a live one reads as a broken button. */}
          {!!onBack && <View style={styles.heroTopRight}>{backControl}</View>}
        </View>
      ) : (
        <View style={styles.heroTop}>
          {backControl}
          {!!(eyebrow ?? label) && <Text style={styles.stepLabel}>{eyebrow ?? label}</Text>}
        </View>
      )}

      {/* Six full segments on a screen that has finished are six segments nobody reads. */}
      {step !== null && !done && <ProgressSegments step={step ?? -1} />}

      <Text style={[styles.heroTitle, done && styles.heroCentred]}>{title}</Text>
      {!!subtitle && (
        <Text style={[styles.heroSubtitle, done && styles.heroCentred]}>{subtitle}</Text>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
      {/* Whatever the glyphs are actually sitting on, which is now always the hero. Get this
          the wrong way round and the clock disappears into the header. */}
      <StatusBar
        style="light"
        backgroundColor={tone === 'good' ? colors.primaryDark : colors.ink}
      />

      {/* Fixed. The step number, the progress and the question are the frame the body is
          answered inside — they have to stay put while the list under them moves, or a Mait
          scrolling a long roster loses track of what they are choosing and why. */}
      {hero}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {!!stickyTop && (
          <View
            style={[
              styles.stickyTop,
              { paddingLeft: spacing[5] + insets.left, paddingRight: spacing[5] + insets.right },
            ]}
          >
            {stickyTop}
          </View>
        )}

        <ScrollView
          ref={scroller}
          innerViewRef={content}
          /* A keyboard's worth of room under the content while one is open. Without it a
             field near the bottom cannot be scrolled any higher than the content's own end,
             which on a short body is not high enough to clear the keyboard — the scroll runs
             out before the field arrives. */
          contentContainerStyle={[styles.scroll, !!overlap && { paddingBottom: overlap }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          refreshControl={
            refresh ? (
              <RefreshControl
                refreshing={refresh.refreshing}
                onRefresh={refresh.onRefresh}
                tintColor={colors.primary}
              />
            ) : undefined
          }
        >
          <View
            style={[
              styles.body,
              // The sticky band has already opened the gap under the hero.
              !!stickyTop && styles.bodyUnderSticky,
              { paddingLeft: spacing[5] + insets.left, paddingRight: spacing[5] + insets.right },
            ]}
          >
            <FlowScroll.Provider value={api}>{children}</FlowScroll.Provider>
          </View>
        </ScrollView>

        {/* Fixed too, for the same reason the hero is: the one action out of this step should
            not have to be scrolled back to. */}
        {(cta || link || footerNote) && (
          <View
            style={[
              styles.footer,
              {
                paddingLeft: spacing[5] + insets.left,
                paddingRight: spacing[5] + insets.right,
                paddingBottom: spacing[4] + (tabBarBelow ? 0 : insets.bottom),
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
                {/* Balances the arrow, so the label sits on the button's centre line rather
                    than on the centre of the label-and-arrow pair — which reads as a label
                    nudged to the left, and the longer the label the more it shows. */}
                {!cta.disabled && !cta.busy && <View style={styles.ctaBalance} />}

                <Text
                  style={[styles.ctaLabel, (cta.disabled || cta.busy) && styles.ctaLabelDisabled]}
                  numberOfLines={1}
                >
                  {cta.label}
                </Text>

                {/* The arrow is a promise that tapping moves you on. An inert button makes
                    no such promise, so it does not draw one. */}
                {!cta.disabled && !cta.busy && (
                  <Ionicons name="arrow-forward" size={ARROW_SIZE} color={colors.surface} />
                )}
              </Pressable>
            )}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * Fills whatever the body leaves over.
 *
 * The footer is fixed to the bottom of the screen now, so this no longer pushes it anywhere —
 * it keeps a short body from bunching against the hero, and collapses to nothing once the
 * content is long enough to scroll.
 */
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
  /**
   * A string, or the same sentence with one part of it picked out.
   *
   * It renders inside a `Text`, so a nested `Text` is all a caller needs to colour the figure
   * that carries the row's meaning — what she pays — without the component having to know
   * which part of which sentence that is in each language.
   */
  subtitle?: React.ReactNode;
  /**
   * How much room the row takes.
   *
   * `compact` is the default and is what a list wants: a roster of fifty members, a flask of
   * eleven breeds, where every extra point of height is a row that has to be scrolled to.
   *
   * `roomy` is for a screen whose whole body is two or three choices. There the tight row
   * looks like an item pulled out of a list that is not there, and the space it saves is
   * space nothing else was going to use — so the card grows to meet the reader instead.
   */
  size?: 'compact' | 'roomy';
  /** Drawn inside the swatch. Without one the swatch is a plain colour block. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  /** For the few glyphs Ionicons has no equivalent of. Wins over `icon` when both are set. */
  iconNode?: React.ReactNode;
  /**
   * A short handle in the swatch instead of a glyph — `C1`, `C2`.
   *
   * For rows that are otherwise indistinguishable: two untagged cows are one word apart on
   * the screen and identical in the yard, and the Mait needs something to point at when they
   * ask the farmer which one this is.
   */
  swatchLabel?: string;
  /**
   * Draws the swatch as a circle — an avatar rather than a tile.
   *
   * For rows that are a person. A named human and a collection point should not be the same
   * shape on the screen, and initials in a circle is the shape every phone already uses for
   * one.
   */
  round?: boolean;
  /**
   * The leading tile. Off for a list whose rows are pure text — a column of identical blank
   * chips is a margin of colour that means nothing, and it pushes the words it decorates in.
   */
  swatch?: boolean;
  /** Right-hand qualifier, e.g. "Nearest". */
  pill?: string;
  /**
   * Amber instead of green for a qualifier that is a warning ("Low"), or grey for one that is
   * merely a state nobody has to act on ("Waiting").
   *
   * The grey matters on a list where several pills are visible at once: if waiting and sending
   * are both green, the colour has stopped saying anything and the Mait has to read every row
   * to find the one that is actually moving.
   */
  pillTone?: 'primary' | 'accent' | 'muted';
  selected?: boolean;
  /**
   * Blocked rows stay on screen rather than disappearing: a Mait who cannot find a farmer
   * they know is registered will assume the app is broken. The reason replaces the subtitle.
   */
  blockedReason?: string;
  tone?: Tone;
  /** Renders the right-hand radio dot, for a one-of-N choice. */
  /**
   * A control on the right, in place of the tick.
   *
   * For a row whose answer is a number rather than a yes: two doses of this breed, three of
   * these sheaths. The tick says the row was chosen and stops there, which on those rows is
   * the smaller half of the answer.
   */
  trailing?: React.ReactNode;
  radio?: boolean;
  /**
   * The same choice, marked only once made: a filled tick on the chosen row and nothing at
   * all on the others.
   *
   * For a list where the rows are already telling a story — a tag number, when she was last
   * served — and a column of empty circles beside them is one more thing to read past.
   */
  check?: boolean;
  onPress?: () => void;
  testID?: string;
}

export function OptionCard({
  title,
  subtitle,
  size = 'compact',
  icon,
  iconNode,
  swatchLabel,
  round = false,
  swatch = true,
  pill,
  pillTone = 'primary',
  selected = false,
  trailing,
  blockedReason,
  tone = 'primary',
  radio = false,
  check = false,
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
        size === 'roomy' && styles.cardRoomy,
        selected && styles.cardSelected,
        blocked && styles.cardBlocked,
        pressed && !blocked && !selected && styles.cardPressed,
      ]}
      testID={testID}
    >
      <View
        style={[
          styles.swatch,
          size === 'roomy' && styles.swatchRoomy,
          { backgroundColor: blocked ? colors.disabledFill : SWATCH[tone] },
          round && styles.swatchRound,
          selected && !blocked && styles.swatchSelected,
          !swatch && styles.swatchOff,
        ]}
      >
        {!!swatchLabel && (
          <Text
            style={[
              styles.swatchLabel,
              { color: blocked ? colors.textDisabled : SWATCH_TINT[tone] },
              selected && !blocked && styles.swatchLabelSelected,
            ]}
          >
            {swatchLabel}
          </Text>
        )}
        {!swatchLabel &&
          (iconNode ??
            (!!icon && (
              <Ionicons
                name={icon}
                size={20}
                color={blocked ? colors.textDisabled : SWATCH_TINT[tone]}
              />
            )))}
      </View>

      <View style={styles.cardBody}>
        <Text
          style={[
            styles.cardTitle,
            size === 'roomy' && styles.cardTitleRoomy,
            blocked && styles.blockedText,
          ]}
          numberOfLines={1}
        >
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
        <View
          style={[
            styles.pill,
            pillTone === 'accent' && styles.pillAccent,
            pillTone === 'muted' && styles.pillMuted,
            blocked && styles.pillBlocked,
          ]}
        >
          <Text
            style={[
              styles.pillLabel,
              pillTone === 'accent' && styles.pillLabelAccent,
              pillTone === 'muted' && styles.pillLabelMuted,
              blocked && styles.pillLabelBlocked,
            ]}
          >
            {pill}
          </Text>
        </View>
      )}

      {trailing}

      {/* A tick rather than a dot once chosen: at arm's length in sunlight a filled circle
          and an empty one are the same circle, and a tick is not. */}
      {radio && (
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected && <Ionicons name="checkmark" size={14} color={colors.surface} />}
        </View>
      )}

      {check && selected && (
        <View style={styles.checkMark}>
          <Ionicons name="checkmark" size={16} color={colors.surface} />
        </View>
      )}
    </Pressable>
  );
}

// --------------------------------------------------------------------------------------
// Segmented choice
// --------------------------------------------------------------------------------------
/**
 * Two or three options as one control, for a question whose answer narrows everything under
 * it — cow or buffalo, before a list of animals or a list of breeds.
 *
 * A pair of cards would say the same thing in twice the height and read as two things to
 * consider. This reads as one thing already answered, which is what it is: it always carries
 * a value, and the Mait is adjusting it rather than choosing from nothing.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  /** Suffixed with the option value, so each half is addressable in tests. */
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.segmented}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[styles.segment2, active && styles.segment2Active]}
            testID={testID ? `${testID}-${option.value}` : undefined}
          >
            <Text
              style={[styles.segmentLabel, active && styles.segmentLabelActive]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Radio group
// --------------------------------------------------------------------------------------
/**
 * A one-of-N choice as radio buttons on one line, under the field it qualifies.
 *
 * `Segmented` answers a question that stands on its own — cow or buffalo, before a list. This
 * answers one *about the box above it*: whose name that is. A segmented control there would
 * read as a filter on the field rather than a property of it, and it always carries a value,
 * which would mean guessing between a father and a husband on a form where nobody has said.
 *
 * So it starts unanswered, and each option is a real radio: a ring that fills. At arm's length
 * in sunlight an empty circle and a filled one are the same circle, which is why the chosen
 * one takes a tick and the label goes to the strong face.
 */
export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  testID,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (next: T) => void;
  /** Suffixed with the option value, so each choice is addressable in tests. */
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.radioRow}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={option.label}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.radioOption,
              active && styles.radioOptionOn,
              pressed && !active && styles.cardPressed,
            ]}
            testID={testID ? `${testID}-${option.value}` : undefined}
          >
            <View style={[styles.radio, active && styles.radioOn]}>
              {active && <Ionicons name="checkmark" size={14} color={colors.surface} />}
            </View>
            <Text style={[styles.radioLabel, active && styles.radioLabelOn]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Capture tile
// --------------------------------------------------------------------------------------
/**
 * A slot for a photograph that has to be taken, drawn as the space it will fill.
 *
 * Dashed and empty until there is one, then the shot itself with a tick over it — the same
 * language as the add card and the animal portrait, so a Mait who has met one has met all
 * three. Pairs side by side, because the two faces of a card are one job and splitting them
 * down the page makes the second look optional.
 */
export function CaptureTile({
  label,
  hint,
  uri,
  onPress,
  testID,
}: {
  label: string;
  hint: string;
  /** The photo taken for this slot, or null while it is still a space. */
  uri: string | null;
  onPress: () => void;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ checked: !!uri }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.capture,
        !!uri && styles.captureFilled,
        pressed && styles.cardPressed,
      ]}
      testID={testID}
    >
      {uri ? (
        <>
          <Image source={{ uri }} style={styles.captureShot} resizeMode="cover" />
          <View style={styles.captureTick}>
            <Ionicons name="checkmark" size={14} color={colors.surface} />
          </View>
        </>
      ) : (
        <View style={styles.captureEmpty}>
          <Ionicons name="camera-outline" size={22} color={colors.textMuted} />
        </View>
      )}

      <Text style={styles.captureLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.captureHint} numberOfLines={1}>
        {uri ? t('aiFlow.retake') : hint}
      </Text>
    </Pressable>
  );
}

// --------------------------------------------------------------------------------------
// Add card
// --------------------------------------------------------------------------------------
/**
 * The way out of a list: not one of the things in it, but the way to make one.
 *
 * Dashed rather than solid, because the row it sits under is a record that exists and this is
 * a space where one could. Same height and same leading chip as the rows above it, so the
 * column still reads as a column.
 */
export function AddCard({
  title,
  subtitle,
  onPress,
  testID,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.addCard, pressed && styles.addCardPressed]}
      testID={testID}
    >
      {/* Neutral, not green. The green on this screen belongs to the row already chosen and
          to the button that acts on it; a green plus would compete with both for the eye of
          someone who has come here to pick, not to register. */}
      <View style={[styles.swatch, { backgroundColor: colors.background }]}>
        <Ionicons name="add" size={22} color={colors.ink} />
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.cardSubtitle}>{subtitle}</Text>}
      </View>
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
  const { ref: wrap, onFocus: reveal } = useFieldReveal();

  return (
    <View ref={wrap} style={styles.fieldWrap}>
      <View style={[styles.card, !!error && styles.cardError]}>
        <View style={[styles.swatch, { backgroundColor: SWATCH[tone] }]} />
        <View style={styles.cardBody}>
          <Text style={styles.fieldLabel}>{label}</Text>
          <TextInput
            style={styles.fieldInput}
            placeholderTextColor={colors.textDisabled}
            accessibilityLabel={label}
            {...inputProps}
            onFocus={event => {
              reveal();
              inputProps.onFocus?.(event);
            }}
          />
        </View>
      </View>
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
      {!error && !!hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

/**
 * A label over a plain box.
 *
 * The label sits above the value and stays there. A placeholder-as-label vanishes exactly when
 * a hesitant user needs it, and this form is filled in standing in someone's yard, holding a
 * phone in one hand, reading a name back to the person it belongs to.
 *
 * `tone` colours the label, not the box: it marks which fields are the accent ones without
 * putting a second colour inside the input, where it would compete with what is typed.
 */
export function LabelledField({
  label,
  optionalNote,
  tone = 'neutral',
  icon,
  hint,
  error,
  ...inputProps
}: {
  label: string;
  /**
   * Rendered after the label, in the accent — "— optional".
   *
   * Said on the label rather than in the placeholder, because the placeholder disappears the
   * moment the Mait starts typing and takes the permission to leave it blank with it.
   */
  optionalNote?: string;
  tone?: Tone;
  /** Sits inside the box, left of the value, tinted to match the label. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  hint?: string;
  error?: string | null;
} & TextInputProps): React.JSX.Element {
  const [focused, setFocused] = useState(false);
  // The whole wrapper, not the box: the label has to come up with the field it names,
  // otherwise a Mait sees an unlabelled box appear over the keyboard.
  const { ref: wrap, onFocus: reveal } = useFieldReveal();

  return (
    <View ref={wrap} style={styles.fieldWrap}>
      <Text style={[styles.labelledLabel, { color: SWATCH_TINT[tone] }]}>
        {label}
        {!!optionalNote && <Text style={styles.optionalNote}> {optionalNote}</Text>}
      </Text>
      <View
        style={[
          styles.labelledBox,
          focused && styles.labelledBoxFocused,
          !!error && styles.labelledBoxError,
        ]}
      >
        {!!icon && (
          <Ionicons
            name={icon}
            size={20}
            color={error ? colors.error : SWATCH_TINT[tone]}
            style={styles.labelledIcon}
          />
        )}
        <TextInput
          style={styles.labelledInput}
          placeholderTextColor={colors.textDisabled}
          accessibilityLabel={label}
          {...inputProps}
          /* Composed, not overridden. A caller that wants to know about focus — to scroll the
             field clear of the keyboard, say — must not silently cost the box its focus
             ring, which is what spreading the caller's props last used to do. */
          onFocus={event => {
            setFocused(true);
            reveal();
            inputProps.onFocus?.(event);
          }}
          onBlur={event => {
            setFocused(false);
            inputProps.onBlur?.(event);
          }}
        />
      </View>
      {!!error && <Text style={styles.fieldError}>{error}</Text>}
      {!error && !!hint && <Text style={styles.fieldHint}>{hint}</Text>}
    </View>
  );
}

/**
 * A consent tick.
 *
 * A square box rather than the flow's round radio, because this is not one of a set of
 * choices — it is a statement being agreed to, and the two should not look alike.
 */
export function CheckboxRow({
  children,
  checked,
  onToggle,
  testID,
}: {
  children: React.ReactNode;
  checked: boolean;
  onToggle: () => void;
  testID?: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={({ pressed }) => [styles.checkRow, pressed && styles.cardPressed]}
      testID={testID}
    >
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
        {checked && <Ionicons name="checkmark" size={16} color={colors.surface} />}
      </View>
      <View style={styles.cardBody}>{children}</View>
    </Pressable>
  );
}

/**
 * A closed list, opened on demand.
 *
 * The flow picks from cards everywhere else, and it should: a card list is one tap and it
 * survives sunlight and cold hands. This is the exception, for a list that is long, dull and
 * already familiar — the breeds a Mait registers animals against. Twenty cards would bury the
 * two fields under it and turn a three-field form into a page of scrolling.
 */
export function Dropdown<T extends string>({
  label,
  optionalNote,
  placeholder,
  value,
  options,
  onChange,
  testID,
}: {
  label: string;
  /** Rendered after the label, in the accent — "— optional". */
  optionalNote?: string;
  placeholder: string;
  value: T | null;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  testID?: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const chosen = options.find(option => option.value === value) ?? null;

  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.sheetLabel}>
        {label}
        {!!optionalNote && <Text style={styles.optionalNote}> {optionalNote}</Text>}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={[styles.labelledBox, !!chosen && styles.labelledBoxFocused]}
        testID={testID}
      >
        <Text
          style={[styles.dropdownValue, !chosen && styles.dropdownPlaceholder]}
          numberOfLines={1}
        >
          {chosen?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
      </Pressable>

      {/* A sheet of its own rather than an inline expansion: an inline list would push the
          fields under it off the screen exactly when the Mait is working down them. */}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          style={styles.scrim}
          accessibilityLabel={t('common.close')}
          onPress={() => setOpen(false)}
        >
          <Pressable style={styles.dropdownSheet} onPress={() => {}}>
            <Text style={styles.dropdownHeading}>{label}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {options.map(option => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => [styles.dropdownOption, pressed && styles.cardPressed]}
                    testID={testID ? `${testID}-${option.value}` : undefined}
                  >
                    <Text style={[styles.dropdownOptionLabel, active && styles.dropdownOptionOn]}>
                      {option.label}
                    </Text>
                    {active && <Ionicons name="checkmark" size={18} color={colors.primary} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * A search box, and the one input in the flow with no label above it.
 *
 * The magnifier says what it is without a word, which is the whole argument for placeholders —
 * an argument that only holds for search. Everywhere else the label stays.
 */
export function SearchField({
  placeholder,
  ...inputProps
}: { placeholder: string } & TextInputProps): React.JSX.Element {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={colors.textMuted} />
      <TextInput
        style={styles.searchInput}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={placeholder}
        {...inputProps}
      />
    </View>
  );
}

// --------------------------------------------------------------------------------------
// Identity card
// --------------------------------------------------------------------------------------
/**
 * Two letters off a name, for an avatar.
 *
 * A place for the eye to land, not an identifier — the code and the mobile under the name are
 * what actually tell two Kavitas apart.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return `${first}${second}`.toUpperCase();
}

/** `98765 43210` — grouped the way it is said aloud and read back to the farmer. */
export function groupedMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, '');
  return digits.length === 10 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : mobile;
}

/**
 * One person, big, for the screen that asks whether this is the right one.
 *
 * Deliberately larger than every other card in the flow. It is the last chance to catch a
 * mis-tapped code before an insemination is recorded against another woman's animal, and a
 * confirmation the size of a list row is one a tired Mait taps past. The facts under the rule
 * are what a Mait can check out loud against the person standing there — where she collects,
 * the number the receipt will go to, whose household she is from.
 */
export function IdentityCard({
  name,
  code,
  facts,
  testID,
}: {
  name: string;
  /** Shown under the name in green — the thing that was typed, and could have been mistyped. */
  code?: string;
  facts: { label: string; value: string }[];
  testID?: string;
}): React.JSX.Element {
  return (
    <View style={styles.identity} testID={testID}>
      <View style={styles.avatar}>
        <Text style={styles.avatarLabel}>{initials(name)}</Text>
      </View>

      <Text style={styles.identityName}>{name}</Text>
      {!!code && <Text style={styles.identityCode}>{code}</Text>}

      {facts.length > 0 && <View style={styles.rule} />}

      {/* Two to a row, wrapping. A column of full-width rows would push the mobile — the one
          fact with a consequence attached — below the fold on a small handset. */}
      <View style={styles.facts}>
        {facts.map(fact => (
          <View key={fact.label} style={styles.fact}>
            <Text style={styles.factLabel}>{fact.label}</Text>
            <Text style={styles.factValue}>{fact.value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * A label on the left, its value on the right, one hairline between rows.
 *
 * For the two or three facts a Mait reads back at the end of a capture — who it was for, which
 * animal. A card of these is quicker to check against the animal in front of them than the
 * same facts in a paragraph.
 */
export function InfoRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  /** Drops the hairline, so the last row does not underline the bottom of its card. */
  last?: boolean;
}): React.JSX.Element {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowRuled]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
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
/**
 * Yellow to do something, blue to know something, red for something wrong — and green for
 * something already settled, which is a statement rather than a step: *nothing to collect*.
 */
export function FlowNotice({
  tone,
  title,
  body,
  pill,
  /** Overrides the tone's default glyph when the notice means something more specific. */
  icon,
  testID,
}: {
  tone: 'good' | 'accent' | 'info' | 'error';
  /** Omit it for a notice that is one plain sentence — a heading over nothing is furniture. */
  title?: string;
  body?: string;
  /**
   * One word on the right, naming the state the notice is describing.
   *
   * For the notice that is reporting rather than instructing — "saved on this phone" is a
   * sentence about a record, and `Queued` is what that record's row will say everywhere else
   * in the app. The pill is what ties the two together.
   */
  pill?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  testID?: string;
}): React.JSX.Element {
  const { swatch, wash, glyph } = {
    good: {
      swatch: colors.primary,
      wash: colors.primaryWash,
      glyph: 'checkmark' as const,
    },
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
    // Outlined as well as washed. The wash alone is a very pale tint — on a cheap screen in
    // daylight it reads as white, and a notice that cannot be seen to be a notice is just a
    // paragraph. The border is the tone's own colour, so the card says which of the four
    // kinds it is from across the room.
    <View style={[styles.notice, { backgroundColor: wash, borderColor: swatch }]} testID={testID}>
      {/* A glyph, not a blank square. A coloured block asks the reader to remember what the
          colour meant; a warning triangle does not. */}
      <View style={[styles.noticeSwatch, { backgroundColor: swatch }]}>
        <Ionicons name={icon ?? glyph} size={15} color={colors.surface} />
      </View>
      <View style={styles.cardBody}>
        {!!title && <Text style={styles.cardTitle}>{title}</Text>}
        {!!body && (
          <Text style={[styles.cardSubtitle, !title && styles.noticeBodyAlone]}>{body}</Text>
        )}
      </View>

      {!!pill && (
        <View style={[styles.noticePill, { borderColor: swatch }]}>
          <Text style={styles.noticePillLabel}>{pill}</Text>
        </View>
      )}
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
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },

  // -- hero -----------------------------------------------------------------------------
  // A card that floats on the page rather than a band welded to the top of the screen. The
  // grey gutter above and beside it is what makes the six steps read as one card being dealt
  // and replaced, and it leaves the status bar on the page's own colour instead of on Ink.
  // Only the bottom corners round: the other two would be rounding against the edge of the
  // screen, which is a gap rather than a curve.
  hero: {
    backgroundColor: colors.ink,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingBottom: spacing[5],
    overflow: 'hidden',
  },
  heroGood: { backgroundColor: colors.primaryDark },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  heroTopRight: { marginLeft: 'auto' },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backPressed: { backgroundColor: 'rgba(255,255,255,0.28)' },

  heroDone: { alignItems: 'center', marginBottom: spacing[4] },
  doneDisc: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCentred: { textAlign: 'center' },
  stepLabel: { ...typography.label, color: colors.surface },

  track: { flexDirection: 'row', gap: spacing[2], marginBottom: spacing[5] },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  segmentDone: { backgroundColor: colors.surface },

  heroTitle: { ...typography.display, fontSize: 26, lineHeight: 34, color: colors.surface },
  heroSubtitle: {
    ...typography.body,
    color: colors.surface,
    opacity: 0.72,
    marginTop: spacing[2],
  },

  // -- body -----------------------------------------------------------------------------
  // Opaque like the hero above it and the footer below — the list slides behind all three.
  stickyTop: { paddingTop: spacing[5], backgroundColor: colors.background },
  body: { flexGrow: 1, paddingTop: spacing[4] },
  bodyUnderSticky: { paddingTop: 0 },
  spacer: { flexGrow: 1, minHeight: spacing[5] },
  label: { ...typography.label, color: colors.text, marginBottom: spacing[2] },

  // Lifted off the page rather than outlined on it (DESIGN_SYSTEM — Cards). The border is
  // kept at zero-visibility width so the chosen row can take a green one without the card
  // growing a pixel and nudging everything under it.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + spacing[4],
    backgroundColor: colors.surface,
    borderWidth: 1,
    // Outlined even when it is not the chosen one. A transparent edge left the card leaning
    // on its shadow alone, which on a cheap screen in daylight is nothing at all — and it is
    // the same hairline every other card in the app now carries.
    borderColor: colors.border,
    borderRadius: radius.lg,
    ...shadows.card,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  // Stretched for a screen that holds two of them and nothing else. The height comes from the
  // padding rather than from a fixed number, so a subtitle that wraps in Hindi still has its
  // room instead of being squeezed against the edges of a box sized for English.
  cardRoomy: {
    minHeight: MIN_TOUCH_TARGET + spacing[6],
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[5],
    gap: spacing[4],
    marginBottom: spacing[4],
  },
  cardSelected: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
  cardPressed: { backgroundColor: colors.background },
  cardBlocked: { backgroundColor: colors.background, borderColor: colors.border },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // On a chosen card the wash has already tinted the whole row, so the tile has to go white
  // or it dissolves into the card behind it.
  swatchRoomy: { width: 46, height: 46, borderRadius: radius.md },
  swatchSelected: { backgroundColor: colors.surface },
  swatchRound: { borderRadius: 20 },
  swatchLabel: { ...typography.label, fontFamily: fonts.headingBold },
  swatchLabelSelected: { color: colors.primaryDark },
  // Collapsed rather than absent, so one component draws both kinds of row.
  swatchOff: { display: 'none' },
  cardBody: { flex: 1 },
  cardTitleRoomy: { ...typography.h2, fontSize: 19, lineHeight: 26 },

  // A dashed outline of the same card, so it holds the column without claiming to be a
  // record. No fill: a white card here would be indistinguishable from a real animal.
  addCard: {
    borderStyle: 'dashed',
    borderColor: colors.textDisabled,
    backgroundColor: 'transparent',
    // Flat: a shadow would put it on the same plane as the records above it, which is the one
    // thing the dashed outline is there to deny.
    shadowOpacity: 0,
    elevation: 0,
  },
  addCardPressed: { backgroundColor: colors.primaryWash },

  // A rounded rectangle, not a pill. Every other surface in the flow is a rounded rectangle —
  // the cards, the button, the hero — and a capsule here would be the one shape on the screen
  // that belongs to nothing else. The track's radius is the segment's plus its padding, so
  // the filled half sits concentric inside it rather than cutting a flat corner.
  segmented: {
    flexDirection: 'row',
    gap: spacing[1],
    padding: spacing[1],
    marginBottom: spacing[4],
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
  segment2: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[3],
    borderRadius: radius.md,
  },
  segment2Active: { backgroundColor: colors.primary },
  segmentLabel: { ...typography.bodyStrong, color: colors.text },
  segmentLabelActive: { color: colors.surface, fontFamily: fonts.headingBold },

  // A form label inside the sheet: green, because on white it has to separate itself from the
  // value under it without shouting, and Ink at this size reads as another value.
  sheetLabel: { ...typography.label, color: colors.primaryDark, marginBottom: spacing[2] },
  // Yolk 800 — the only yellow safe as text on a pale surface (DESIGN_SYSTEM — Colour).
  optionalNote: { color: yolk[800] },

  dropdownValue: { flex: 1, ...typography.bodyStrong, fontSize: 16, color: colors.ink },
  dropdownPlaceholder: { ...typography.body, color: colors.textDisabled },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(21,35,45,0.45)',
    justifyContent: 'flex-end',
  },
  dropdownSheet: {
    maxHeight: '60%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[6],
  },
  dropdownHeading: { ...typography.h3, color: colors.ink, marginBottom: spacing[3] },
  dropdownOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dropdownOptionLabel: { ...typography.body, fontSize: 16, color: colors.ink },
  dropdownOptionOn: { ...typography.bodyStrong, fontSize: 16, color: colors.primaryDark },

  labelledLabel: { ...typography.label, marginBottom: spacing[2] },
  labelledBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + 8,
    paddingHorizontal: spacing[4],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  labelledBoxFocused: { borderColor: colors.primary },
  labelledBoxError: { borderColor: colors.error },
  labelledIcon: { opacity: 0.9 },
  // The value is set in the strong face and the placeholder is not, so a filled field reads
  // as an answer given rather than a prompt still waiting.
  labelledInput: {
    flex: 1,
    ...typography.bodyStrong,
    fontSize: 16,
    color: colors.ink,
    paddingVertical: spacing[2],
  },

  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    padding: spacing[4],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET + 4,
    paddingHorizontal: spacing[4],
    marginBottom: spacing[4],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  searchInput: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: spacing[2] },

  cardTitle: { ...typography.h3, color: colors.ink },
  cardSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  // The reason a row cannot be used is the one thing on it worth reading, so it is not muted.
  cardReason: { ...typography.caption, color: colors.error, marginTop: 2 },
  blockedText: { color: colors.textDisabled },

  cardError: { borderColor: colors.error },

  fieldWrap: { marginBottom: spacing[4] },
  fieldLabel: { ...typography.caption, color: colors.textMuted },
  fieldInput: {
    ...typography.bodyStrong,
    color: colors.ink,
    paddingVertical: 2,
    // Android draws a default underline and its own vertical padding here; both fight the
    // card the field sits in.
    paddingHorizontal: 0,
  },
  // Clear of the box rather than tucked under its edge. These lines were pulled up by a
  // negative margin that suited the old card layout and crowded the input in this one.
  fieldHint: { ...typography.caption, color: colors.textMuted, marginTop: spacing[2] },
  fieldError: { ...typography.caption, color: colors.error, marginTop: spacing[2] },

  // Sized to fit, not to fill. This card, its statement, the link and the button have to sit
  // on one screen of a mid-range handset — a confirmation that has to be scrolled to read is
  // one that gets confirmed unread, which is the exact failure the screen exists to prevent.
  identity: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    ...shadows.card,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    marginBottom: spacing[3],
  },
  // 46 rather than 52, and closer to the name under it. This card has to sit whole on a
  // 5-inch screen alongside two notices and a button once her phone has answered, and every
  // point the disc gives back is a point the facts under it do not have to scroll for.
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.primaryWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  avatarLabel: { ...typography.h3, color: colors.primaryDark },
  identityName: { ...typography.h2, color: colors.ink, textAlign: 'center' },
  // The code is green because it is the thing that was typed: it is what a wrong tap gets
  // wrong, so it is the line the Mait should read back before saying yes.
  identityCode: { ...typography.bodyStrong, color: colors.primaryDark, marginTop: 2 },
  rule: {
    alignSelf: 'stretch',
    height: 1,
    backgroundColor: colors.border,
    marginTop: spacing[3],
  },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'stretch' },
  fact: { width: '50%', paddingTop: spacing[3], paddingRight: spacing[3] },
  factLabel: { ...typography.caption, color: colors.textMuted },
  factValue: { ...typography.bodyStrong, color: colors.ink, marginTop: 2 },

  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  infoRowRuled: { borderBottomWidth: 1, borderBottomColor: colors.border },
  infoLabel: { ...typography.body, color: colors.textMuted },
  infoValue: { ...typography.bodyStrong, color: colors.ink, flexShrink: 1, textAlign: 'right' },

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
  // Yolk fill with Ink on it, never yellow text on a pale surface (DESIGN_SYSTEM — Colour).
  pillAccent: { backgroundColor: colors.secondaryWash },
  // The page's own grey, outlined so it still reads as a pill on a white card rather than as
  // a hole in it.
  pillMuted: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  pillBlocked: { backgroundColor: colors.errorWash },
  pillLabel: { ...typography.caption, color: colors.primaryDark },
  pillLabelAccent: { color: yolk[800] },
  pillLabelMuted: { color: colors.textMuted },
  pillLabelBlocked: { color: colors.error },

  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },

  // Two options sharing a line, each its own touch target. The gap is the flow's, so the pair
  // sits on the same rhythm as the fields above and below it.
  radioRow: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[4] },
  radioOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing[4],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  radioOptionOn: { borderColor: colors.primary, backgroundColor: colors.primaryWash },
  radioLabel: { ...typography.body, color: colors.text, flexShrink: 1 },
  radioLabelOn: { ...typography.bodyStrong, color: colors.primaryDark },

  // A slot the height of the card it will hold, so the form does not jump when one is taken.
  capture: {
    flex: 1,
    alignItems: 'center',
    padding: spacing[3],
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.textDisabled,
    borderRadius: radius.lg,
  },
  captureFilled: {
    borderStyle: 'solid',
    borderColor: colors.primary,
    backgroundColor: colors.primaryWash,
  },
  captureEmpty: {
    width: '100%',
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  captureShot: { width: '100%', height: 72, borderRadius: radius.md },
  captureTick: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureLabel: { ...typography.bodyStrong, color: colors.ink, marginTop: spacing[2] },
  captureHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },

  // Bigger than the radio's tick and with no ring behind it, because it is only ever drawn
  // on the row that won.
  checkMark: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Closes below as well as above. It carried a top margin only, which was invisible while a
  // notice was the last thing on a screen and wrong the moment anything followed it — the
  // empty line above the "add" card sat welded to it.
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing[3],
    marginTop: spacing[2],
    marginBottom: spacing[3],
  },
  // White inside the wash, outlined in the tone: it has to read as a label on the card rather
  // than as a second block of the same colour.
  noticePill: {
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  noticePillLabel: { ...typography.caption, color: colors.ink },
  noticeSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Carrying the whole notice on its own it reads as copy, not as a caption under a heading —
  // but kept a step below body size, because it is a statement of fact beside the card that
  // matters, and it must not cost that card a line.
  noticeBodyAlone: { fontSize: 13, lineHeight: 19, marginTop: 0 },

  // -- footer ---------------------------------------------------------------------------
  // Opaque, and it has to be: the body scrolls behind this bar, and a transparent footer
  // would show a list sliding through the button that sits on top of it.
  footer: { paddingTop: spacing[4], backgroundColor: colors.background },
  link: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkLabel: { ...typography.bodyStrong, color: colors.primaryDark },
  // A rounded rectangle, the same one Home, Inventory and the sign-in screens use. It was a
  // bordered, shadowed pill back when it had to match the action floating in the tab bar;
  // that pill is gone, and a primary action should be one shape everywhere or a Mait learns
  // two.
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    minHeight: 56,
    paddingHorizontal: spacing[5],
    borderRadius: radius.lg,
  },
  ctaBalance: { width: ARROW_SIZE },
  ctaEnabled: { backgroundColor: colors.primary },
  ctaDisabled: { backgroundColor: colors.disabledFill },
  ctaPressed: { backgroundColor: colors.primaryPressed },
  // `includeFontPadding` off, or Android hangs the font's own ascent and descent inside the
  // line box and the label sits a pixel or two above the arrow it is meant to sit level with.
  ctaLabel: {
    ...typography.bodyStrong,
    fontSize: 16,
    lineHeight: 22,
    color: colors.surface,
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
    flexShrink: 1,
  },
  ctaLabelDisabled: { color: colors.textDisabled },
});
