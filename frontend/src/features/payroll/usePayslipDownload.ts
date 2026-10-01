/**
 * Downloading a payslip PDF.
 *
 * The file needs the caller's token, so it cannot be a plain link: it is
 * fetched as a blob and handed to the browser. The server sets the filename
 * (`EmployeeName_Year_Month.pdf`); the name passed here is only the fallback
 * used if a proxy strips the Content-Disposition header.
 */

import { useState } from 'react';

import { useAppDispatch } from '@/app/hooks';
import { showToast } from '@/features/ui/uiSlice';
import { downloadBlob, payrollApi } from '@/services/api/services';

export function usePayslipDownload() {
  const dispatch = useAppDispatch();
  const [busy, setBusy] = useState(false);

  const download = async (payslipId: number, label: string) => {
    setBusy(true);
    try {
      const blob = await payrollApi.payslipPdf(payslipId);
      downloadBlob(blob, `payslip-${label.replace(/\s+/g, '-').toLowerCase()}.pdf`);
    } catch {
      dispatch(showToast('The payslip could not be downloaded.', 'error'));
    } finally {
      setBusy(false);
    }
  };

  return { download, busy };
}
