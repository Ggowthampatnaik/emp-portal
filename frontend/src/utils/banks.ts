/**
 * Banks an employee's salary account may be with, grouped the way the RBI
 * groups them. Names are the banks' own.
 *
 * Not every bank can be listed - India has over 1,400 co-operative banks and
 * the regional rural banks are being merged - so the picker also offers
 * "Other bank", which takes the name as typed. The server stores the name as
 * text either way.
 */

export interface BankOption {
  name: string;
  group: string;
}

const group = (name: string, banks: string[]): BankOption[] =>
  banks.map((bank) => ({ name: bank, group: name }));

export const BANKS: BankOption[] = [
  ...group('Public sector banks', [
    'State Bank of India',
    'Bank of Baroda',
    'Bank of India',
    'Bank of Maharashtra',
    'Canara Bank',
    'Central Bank of India',
    'Indian Bank',
    'Indian Overseas Bank',
    'Punjab & Sind Bank',
    'Punjab National Bank',
    'UCO Bank',
    'Union Bank of India',
  ]),
  ...group('Private sector banks', [
    'Axis Bank',
    'Bandhan Bank',
    'City Union Bank',
    'CSB Bank',
    'DCB Bank',
    'Dhanlaxmi Bank',
    'Federal Bank',
    'HDFC Bank',
    'ICICI Bank',
    'IDBI Bank',
    'IDFC FIRST Bank',
    'IndusInd Bank',
    'Jammu & Kashmir Bank',
    'Karnataka Bank',
    'Karur Vysya Bank',
    'Kotak Mahindra Bank',
    'Nainital Bank',
    'RBL Bank',
    'South Indian Bank',
    'Tamilnad Mercantile Bank',
    'YES Bank',
  ]),
  ...group('Small finance banks', [
    'AU Small Finance Bank',
    'Capital Small Finance Bank',
    'Equitas Small Finance Bank',
    'ESAF Small Finance Bank',
    'Jana Small Finance Bank',
    'Shivalik Small Finance Bank',
    'Suryoday Small Finance Bank',
    'Ujjivan Small Finance Bank',
    'Unity Small Finance Bank',
    'Utkarsh Small Finance Bank',
  ]),
  ...group('Payments banks', [
    'Airtel Payments Bank',
    'Fino Payments Bank',
    'India Post Payments Bank',
    'Jio Payments Bank',
    'NSDL Payments Bank',
  ]),
  ...group('Co-operative banks', ['Cosmos Co-operative Bank', 'Saraswat Co-operative Bank']),
  ...group('Foreign banks', [
    'DBS Bank India',
    'Deutsche Bank',
    'HSBC',
    'Standard Chartered Bank',
  ]),
];

/** The last choice in the list: the name is then typed in. */
export const OTHER_BANK: BankOption = { name: 'Other bank', group: 'Not listed' };

export const isListedBank = (name: string): boolean =>
  BANKS.some((bank) => bank.name.toLowerCase() === name.trim().toLowerCase());
