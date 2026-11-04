/**
 * Text that draws Hindi in a Hindi face.
 *
 * Neither Quicksand nor Nunito Sans has Devanagari, so a plain <Text> in Hindi falls back to
 * whatever the handset ships — a different face on every phone, and on some, matras clipped
 * by a line height set for Latin. This looks at what it is actually showing rather than at
 * the language setting: a Hindi screen still shows "+91", "SMS" and the Mait's own name, and
 * those stay in the designed face.
 *
 * A drop-in for <Text>: same props, same style.
 */

import React, { Children, isValidElement, type ReactNode } from 'react';
import {
  Platform,
  StyleSheet,
  Text,
  useWindowDimensions,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { hasDevanagari } from '@/i18n';
import { hindiTextStyle } from '@theme/tokens';

/** The text this element draws itself. A nested <AppText> decides its own face. */
function ownText(children: ReactNode): string {
  let out = '';
  Children.forEach(children, child => {
    if (typeof child === 'string' || typeof child === 'number') {
      out += child;
    } else if (isValidElement(child) && child.type !== AppText) {
      out += ownText((child.props as { children?: ReactNode }).children);
    }
  });
  return out;
}

/**
 * How far the phone's own font-size setting may grow Hindi text. It still grows for people
 * who need it, but not so far that a one-line button label becomes three.
 */
const MAX_HINDI_FONT_SCALE = 1.25;

/** The smallest a Hindi line held to a count may shrink to before it is allowed to cut off. */
const MIN_HINDI_FIT_SCALE = 0.7;

export default function AppText({ style, children, ...rest }: TextProps): React.JSX.Element {
  const { fontScale } = useWindowDimensions();
  if (!hasDevanagari(ownText(children))) {
    return (
      <Text {...rest} style={style}>
        {children}
      </Text>
    );
  }

  // Android measures a label and draws it in two passes, and for Hindi they disagree: with the
  // OS scaling the text it is measured at one size and drawn at another, and the default
  // high-quality line breaker measures it narrow. Either way the last word wraps — "कोड भेजें"
  // came out on two lines. So the phone's setting is applied here, capped, rather than by the
  // OS, and the simple breaker is the default; a caller can still ask for another.
  const hindi = hindiTextStyle((StyleSheet.flatten(style) as TextStyle | undefined) ?? {});
  const k = Math.min(MAX_HINDI_FONT_SCALE, fontScale || 1);
  // A line held to a count shrinks to fit rather than ending in "…": a Hindi label cut short
  // says something else, or nothing. A caller that asks for something else still gets it.
  const fit =
    rest.numberOfLines != null && rest.adjustsFontSizeToFit === undefined
      ? { adjustsFontSizeToFit: true, minimumFontScale: MIN_HINDI_FIT_SCALE }
      : null;
  return (
    <Text
      textBreakStrategy="simple"
      {...fit}
      {...rest}
      allowFontScaling={false}
      style={[style, { ...hindi, fontSize: hindi.fontSize * k, lineHeight: hindi.lineHeight * k }]}
    >
      {children}
      {/* Room at the end of the line. A label sized to its own text is measured a hair narrower
          than Android then draws it, so its last letter broke onto a line the box had no room
          for: "कम" came out as "क". A trailing space hangs past the edge of a line, so it pads
          the measurement without moving a single visible letter. */}
      {Platform.OS === 'android' ? ' ' : null}
    </Text>
  );
}
