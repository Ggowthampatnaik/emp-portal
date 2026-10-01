/**
 * The close control appears on every popup in the portal, so its behaviour is
 * worth pinning: it must be reachable by its accessible name and must call the
 * same handler Cancel uses.
 */

import Dialog from '@mui/material/Dialog';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ClosableDialogTitle from '@/components/common/ClosableDialogTitle';

function renderTitle(props: Partial<Parameters<typeof ClosableDialogTitle>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <Dialog open>
      <ClosableDialogTitle onClose={onClose} {...props}>
        Add holiday
      </ClosableDialogTitle>
    </Dialog>,
  );
  return { onClose };
}

describe('ClosableDialogTitle', () => {
  it('shows the title', () => {
    renderTitle();
    expect(screen.getByRole('heading', { name: 'Add holiday' })).toBeInTheDocument();
  });

  it('closes when the X is clicked', async () => {
    const { onClose } = renderTitle();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders an optional subtitle', () => {
    renderTitle({ subtitle: 'Shown to every employee' });
    expect(screen.getByText('Shown to every employee')).toBeInTheDocument();
  });

  it('can be disabled while a save is in flight', async () => {
    const { onClose } = renderTitle({ disabled: true });

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toBeDisabled();

    await userEvent.click(close, { pointerEventsCheck: 0 });
    expect(onClose).not.toHaveBeenCalled();
  });
});
