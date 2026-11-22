/**
 * Read-only reconciliation export for a CALCULATED, non-official draft.
 * No party metadata, notes, payment identifiers or internal references.
 * Descriptions are commercially sensitive; this is NOT a redacted export.
 *
 * Amounts are exact integer agorot and quantities are integer thousandths.
 * VAT is calculated at document level, never implied per line.
 */
import { calculateLineAgorot, calculateVatAgorot } from './draft.js';

const KINDS = new Set(['invoice', 'receipt', 'quote']);
const safe = value => Number.isSafeInteger(value) && value >= 0;
const HEADER = Object.freeze([
  'row', 'description', 'quantity_thousandths',
  'unit_price_agorot', 'line_total_agorot',
]);

function csvCell(value, untrustedText = false) {
  let text = String(value);
  // Untrusted descriptions are always text-prefixed, not just when they start
  // with "=": some spreadsheet applications strip leading Unicode whitespace
  // before interpreting a formula. This prefix is part of the exported file.
  if (untrustedText) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function validatedLineRows(document) {
  if (!document || typeof document !== 'object' || document.version !== 1 ||
      document.draft !== true || !KINDS.has(document.kind) ||
      document.currency !== 'ILS' || !Array.isArray(document.items) ||
      document.items.length < 1 || document.items.length > 80 ||
      !safe(document.subtotalAgorot) || !safe(document.vatAgorot) ||
      !safe(document.totalAgorot) ||
      !Number.isSafeInteger(document.vatBasisPoints) ||
      document.vatBasisPoints < 0 || document.vatBasisPoints > 10000 ||
      document.totalAgorot !== document.subtotalAgorot + document.vatAgorot) {
    throw new TypeError('Expected a complete calculated non-official draft.');
  }

  const rows = [];
  let sum = 0n;
  for (const [index, item] of document.items.entries()) {
    if (!item || typeof item !== 'object' ||
        typeof item.description !== 'string' || !item.description.trim() ||
        item.description.length > 180 ||
        !safe(item.quantityMilli) || item.quantityMilli === 0 ||
        !safe(item.priceAgorot) || !safe(item.totalAgorot) ||
        item.totalAgorot !== calculateLineAgorot(item.quantityMilli, item.priceAgorot)) {
      throw new TypeError('Invalid calculated line in draft.');
    }
    sum += BigInt(item.totalAgorot);
    rows.push({
      row: index + 1,
      description: item.description,
      quantityMilli: item.quantityMilli,
      priceAgorot: item.priceAgorot,
      totalAgorot: item.totalAgorot,
    });
  }
  if (sum !== BigInt(document.subtotalAgorot)) {
    throw new TypeError('Line totals do not reconcile to the document subtotal.');
  }
  // Total=subtotal+VAT was checked above; also verify that the VAT amount
  // itself was derived from the explicitly entered rate and half-up rule.
  if (document.vatAgorot !== calculateVatAgorot(
    document.subtotalAgorot, document.vatBasisPoints)) {
    throw new TypeError('Draft VAT does not reconcile with the entered rate.');
  }
  return rows;
}

/** Full, sensitive line reconciliation — descriptions included. */
export function calculatedLinesCsv(document) {
  const rows = validatedLineRows(document);
  const lines = [HEADER.map(value => csvCell(value)).join(',')];
  for (const item of rows) {
    lines.push([
      csvCell(item.row), csvCell(item.description, true),
      csvCell(item.quantityMilli), csvCell(item.priceAgorot),
      csvCell(item.totalAgorot),
    ].join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/**
 * Privacy-reduced line reconciliation. Keeps exact agorot and thousandths
 * for auditing arithmetic while omitting product/service descriptions and
 * all party, reference, payment and date metadata. Financial amounts can
 * remain commercially sensitive even without descriptions.
 */
export function calculatedLinesNumbersCsv(document) {
  const rows = validatedLineRows(document);
  const lines = [[
    'row', 'quantity_thousandths', 'unit_price_agorot', 'line_total_agorot',
  ].map(csvCell).join(',')];
  for (const item of rows) {
    lines.push([
      item.row, item.quantityMilli, item.priceAgorot, item.totalAgorot,
    ].map(csvCell).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
