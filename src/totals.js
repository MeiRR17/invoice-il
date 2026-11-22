/**
 * Compact, privacy-reduced summary for an already calculated draft.
 * Never expose issuer, customer, reference, line items, notes or payment method.
 * All amounts stay in integer agorot, with no floating-point conversions.
 *
 * These totals are not tax records or evidence of a completed transaction.
 */
const KINDS = new Set(['invoice', 'receipt', 'quote']);
const amount = value => Number.isSafeInteger(value) && value >= 0;

export function draftTotals(calculated) {
  if (!calculated || typeof calculated !== 'object' || calculated.version !== 1 ||
      calculated.draft !== true || !KINDS.has(calculated.kind) ||
      calculated.currency !== 'ILS' ||
      !Array.isArray(calculated.items) || calculated.items.length < 1 ||
      calculated.items.length > 80 ||
      !Number.isSafeInteger(calculated.vatBasisPoints) ||
      calculated.vatBasisPoints < 0 || calculated.vatBasisPoints > 10000 ||
      !['subtotalAgorot', 'vatAgorot', 'totalAgorot',
        'paidAgorot', 'remainingAgorot'].every(key => amount(calculated[key])) ||
      calculated.totalAgorot !== calculated.subtotalAgorot + calculated.vatAgorot ||
      (calculated.kind === 'receipt'
        ? calculated.remainingAgorot !== calculated.totalAgorot - calculated.paidAgorot ||
          calculated.paidAgorot > calculated.totalAgorot
        : calculated.paidAgorot !== 0 ||
          calculated.remainingAgorot !== calculated.totalAgorot)) {
    throw new TypeError('Expected a valid calculated financial draft.');
  }
  return {
    format: 'invoice-il-draft-totals-v1',
    draft: true,
    officialDocument: false,
    kind: calculated.kind,
    currency: 'ILS',
    itemCount: calculated.items.length,
    enteredVatBasisPoints: calculated.vatBasisPoints,
    subtotalAgorot: calculated.subtotalAgorot,
    vatAgorot: calculated.vatAgorot,
    totalAgorot: calculated.totalAgorot,
    ...(calculated.kind === 'receipt' ? {
      enteredPaidAgorot: calculated.paidAgorot,
      remainingAgorot: calculated.remainingAgorot,
    } : {}),
    advisory: 'Draft calculation only; not an issued tax document, receipt, VAT determination or payment evidence. Aggregate amounts may still be sensitive.',
  };
}

export function draftTotalsJson(calculated) {
  return JSON.stringify(draftTotals(calculated), null, 2) + '\n';
}
