/**
 * Skeleton tests.
 *
 * The admin sections draw these while their first page loads. What matters is that each
 * layout renders without data, says it is loading to a screen reader, and still renders when
 * the handset asks for reduced motion.
 */

import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import {
  SkeletonBoard,
  SkeletonFeed,
  SkeletonOverview,
  SkeletonRecord,
  SkeletonRows,
  SkeletonTable,
} from '../skeleton';
import '@/i18n';

const LAYOUTS: [string, React.JSX.Element][] = [
  ['rows', <SkeletonRows key="rows" />],
  ['record', <SkeletonRecord key="record" />],
  ['board', <SkeletonBoard key="board" />],
  ['overview', <SkeletonOverview key="overview" chart />],
  ['table', <SkeletonTable key="table" />],
  ['feed', <SkeletonFeed key="feed" />],
];

describe('skeleton layouts', () => {
  it.each(LAYOUTS)('%s renders as a loading progress bar', (_, element) => {
    render(element);
    const node = screen.getByTestId('skeleton');
    expect(node.props.accessibilityRole).toBe('progressbar');
    expect(node.props.accessibilityLabel).toBe('Loading…');
  });

  it('renders with reduced motion on', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    render(<SkeletonRows rows={2} />);
    expect(await screen.findByTestId('skeleton')).toBeTruthy();
  });
});
