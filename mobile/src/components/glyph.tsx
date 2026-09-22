/**
 * The app's glyphs, with one borrowed from a second set.
 *
 * Everything is Ionicons, which is what the app draws — except a semen straw, which Ionicons
 * has no picture of. It was a water drop, and a drop reads as milk on a dairy's app, which is
 * the other liquid on every screen. The straw is drawn as a syringe instead, from Material
 * Community Icons (`needle` is that set's syringe), which ships in the same
 * `@expo/vector-icons` package and needs nothing installed.
 *
 * Callers name `syringe` and never learn it comes from elsewhere: a screen that wants a
 * straw's glyph should not have to know which font it lives in.
 */

import React from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export type GlyphName = React.ComponentProps<typeof Ionicons>['name'] | 'syringe';

/** The straw's glyph, wherever a straw is drawn. */
export const STRAW_GLYPH: GlyphName = 'syringe';

export default function Glyph({
  name,
  size,
  color,
}: {
  name: GlyphName;
  size: number;
  color: string;
}): React.JSX.Element {
  if (name === 'syringe') {
    return <MaterialCommunityIcons name="needle" size={size} color={color} />;
  }
  return <Ionicons name={name} size={size} color={color} />;
}
