/**
 * The count sits inside the label, not hanging off it.
 *
 * A Badge positioned at `right: -14` drew outside the tab's own box, so the
 * count overlapped the next tab and the last tab's count was clipped by the
 * card. The accessible name is what proves it is inline: a tab named
 * "Requests 3" measured its own width; an overhanging badge did not.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import QueueTabLabel from '@/components/common/QueueTabLabel';

describe('QueueTabLabel', () => {
  it('shows the count beside the label', () => {
    render(<QueueTabLabel label="Requests" count={3} />);

    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('keeps the count within the label so the tab measures its true width', () => {
    const { container } = render(<QueueTabLabel label="Manager approvals" count={2} />);

    expect(container.textContent).toBe('Manager approvals2');
  });

  it('says nothing when the queue is empty', () => {
    render(<QueueTabLabel label="HR approvals" count={0} />);

    expect(screen.getByText('HR approvals')).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
