/**
 * The optional documents drawer on a profile.
 *
 * Everything here is voluntary, so the section only works if the employee can
 * take back what they put in — attaching the wrong file is the most likely
 * thing to happen on their first visit. That is why the remove control is
 * tested as carefully as the upload.
 */

import { Provider } from 'react-redux';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '@/app/store';
import type { EmployeeDocument } from '@/types/domain';

const documents = vi.fn();
const uploadDocument = vi.fn();
const removeDocument = vi.fn();

vi.mock('@/services/api/services', () => ({
  employeesApi: {
    documents: (...args: unknown[]) => documents(...args),
    uploadDocument: (...args: unknown[]) => uploadDocument(...args),
    removeDocument: (...args: unknown[]) => removeDocument(...args),
  },
}));

const { default: DocumentsCard } = await import('@/features/employees/DocumentsCard');

function doc(overrides: Partial<EmployeeDocument> = {}): EmployeeDocument {
  return {
    id: 1,
    employee: 5,
    document_type: 'tenth',
    title: 'Class 10 marks statement',
    file_url: 'https://example.test/tenth.pdf',
    file_size: 2048,
    content_type: 'application/pdf',
    uploaded_by_name: 'Asha Rao',
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

function renderCard(canManage = true) {
  render(
    <Provider store={createStore()}>
      <DocumentsCard employeeId={5} canManage={canManage} />
    </Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  documents.mockResolvedValue([doc()]);
  uploadDocument.mockResolvedValue(doc({ id: 2, title: "Bachelor's certificate" }));
  removeDocument.mockResolvedValue('');
});

describe('DocumentsCard', () => {
  it('groups what is attached under its category', async () => {
    const user = userEvent.setup();
    documents.mockResolvedValue([
      doc(),
      doc({ id: 2, document_type: 'bachelors', title: 'B.Tech certificate' }),
    ]);
    renderCard();

    // The card itself shows the first category only - the rest is a click away,
    // which is what keeps it the same height as the Assets card beside it.
    expect(await screen.findByText('Class 10 marks statement')).toBeInTheDocument();
    expect(screen.queryByText('B.Tech certificate')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /View all documents/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Class 10 marks statement')).toBeInTheDocument();
    expect(within(dialog).getByText('B.Tech certificate')).toBeInTheDocument();
    // Each under its own heading.
    expect(within(dialog).getByText(/10th/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/bachelor/i)).toBeInTheDocument();
  });

  it('says plainly when nothing is attached', async () => {
    documents.mockResolvedValue([]);
    renderCard();

    expect(await screen.findByText(/nothing attached yet/i)).toBeInTheDocument();
  });

  it('offers every category the business asks for', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /add document/i }));
    await user.click(screen.getByLabelText(/document type/i));

    for (const label of [
      '10th certificate',
      '12th certificate',
      "Bachelor's certificate",
      "Master's certificate",
      'Skills certification',
      'Other educational document',
      'Experience document',
      'Other relevant document',
    ]) {
      expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  it('uploads the file with its type', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /add document/i }));
    await user.upload(
      screen.getByLabelText(/document file/i),
      new File(['%PDF-1.4 marks'], 'tenth.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: /attach/i }));

    await waitFor(() => expect(uploadDocument).toHaveBeenCalled());
    const form = uploadDocument.mock.calls[0][1] as FormData;
    expect(form.get('document_type')).toBe('tenth');
    expect((form.get('file') as File).name).toBe('tenth.pdf');
  });

  it('names the file after its category when nobody typed a title', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /add document/i }));
    await user.upload(
      screen.getByLabelText(/document file/i),
      new File(['%PDF-1.4 marks'], 'scan.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: /attach/i }));

    await waitFor(() => expect(uploadDocument).toHaveBeenCalled());
    const form = uploadDocument.mock.calls[0][1] as FormData;
    expect(form.get('title')).toBe('10th certificate');
  });

  it('will not upload without a file', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /add document/i }));
    await user.click(screen.getByRole('button', { name: /attach/i }));

    expect(uploadDocument).not.toHaveBeenCalled();
    expect(await screen.findByText(/choose a file to attach/i)).toBeInTheDocument();
  });

  it('refuses anything that is not a PDF before it is uploaded', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /add document/i }));

    // `user.upload` honours the input's `accept`, so it cannot reach the guard.
    // A real file dialog can: "All files" is one dropdown away. fireEvent is
    // what simulates the person who used it.
    const input = screen.getByLabelText(/document file/i) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(['not a pdf'], 'scan.png', { type: 'image/png' })] },
    });

    expect(await screen.findByText(/documents must be pdfs/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /attach/i }));
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('still offers only PDFs in the file dialog', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /add document/i }));

    expect(screen.getByLabelText(/document file/i)).toHaveAttribute(
      'accept',
      'application/pdf,.pdf',
    );
  });

  it('files a skills certification under its own heading', async () => {
    documents.mockResolvedValue([
      doc({ id: 4, document_type: 'skill_certificate', title: 'AWS Solutions Architect' }),
    ]);
    renderCard();

    expect(await screen.findByText('AWS Solutions Architect')).toBeInTheDocument();
    expect(screen.getByText('Skills certification')).toBeInTheDocument();
  });

  it('lets the owner take back what they attached', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole('button', { name: /remove/i }));

    await waitFor(() => expect(removeDocument).toHaveBeenCalledWith(5, 1));
    expect(documents).toHaveBeenCalledTimes(2);
  });

  it('shows a read-only viewer no controls at all', async () => {
    renderCard(false);

    await screen.findByText('Class 10 marks statement');
    expect(screen.queryByRole('button', { name: /add document/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });

  it('still shows a document filed under a retired category', async () => {
    // Rows predating the split into 10th/intermediate/bachelors/masters.
    documents.mockResolvedValue([
      doc({ id: 9, document_type: 'education', title: 'Old certificate' }),
    ]);
    renderCard();

    expect(await screen.findByText('Old certificate')).toBeInTheDocument();
    expect(screen.getByText('Education certificate')).toBeInTheDocument();
  });
});
