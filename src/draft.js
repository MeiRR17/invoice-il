/**
 * Local-only, printable financial-document DRAFT calculations.
 *
 * Monetary amounts are represented in integer agorot. VAT percentage is
 * explicitly provided by the caller; this module never assumes a legal rate.
 * Output is a draft, not tax-compliant invoicing, fiscal numbering or issuance.
 */
export const KINDS = Object.freeze({
  invoice:'Invoice draft',
  receipt:'Receipt draft',
  quote:'Quote',
});
export const CURRENCY = 'ILS';
const TEXT_LIMIT = 180;
const MONEY = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
const RATE = /^(?:0|[1-9]\d?)(?:\.\d{1,2})?$|^100(?:\.0{1,2})?$/;
const QTY = /^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value, limit=TEXT_LIMIT) {
  const result=String(value??'').trim();
  if(result.length>limit)throw new RangeError('A text field exceeds '+limit+' characters.');
  return result;
}
function date(value) {
  const raw=text(value,10);
  if(!DATE.test(raw))throw new Error('Document date must use YYYY-MM-DD.');
  const parsed=new Date(raw+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==raw)
    throw new Error('Invalid document date.');
  return raw;
}
function wholeUnits(value,pattern,places,name) {
  const raw=String(value??'').trim();
  if(!pattern.test(raw))throw new Error(name+' has an invalid numeric format.');
  const [head,tail='']=raw.split('.');
  const multiplier=10**places;
  const units=Number(head)*multiplier+Number(tail.padEnd(places,'0'));
  if(!Number.isSafeInteger(units))throw new RangeError(name+' is too large.');
  return units;
}
export function toAgorot(value) { return wholeUnits(value,MONEY,2,'Price'); }
export function parseQuantity(value) { return wholeUnits(value,QTY,3,'Quantity'); }
export function parseVatRate(value) { return wholeUnits(value,RATE,2,'VAT rate'); }
/**
 * Exact, half-up rounding of thousandth-quantity × unit agorot.
 * Intermediate products can exceed Number.MAX_SAFE_INTEGER although the
 * rounded line item itself is representable. Never round that product in float.
 */
export function calculateLineAgorot(quantityMilli, priceAgorot) {
  if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0 ||
      !Number.isSafeInteger(priceAgorot) || priceAgorot < 0) {
    throw new RangeError('Line quantity and price must be valid non-negative integer units.');
  }
  const cents = (BigInt(quantityMilli) * BigInt(priceAgorot) + 500n) / 1000n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Line item amount is too large.');
  }
  return Number(cents);
}

export function formatMoney(agorot) {
  if(!Number.isSafeInteger(agorot))throw new Error('Invalid currency value.');
  return (agorot/100).toLocaleString('en-IL',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function entry(raw,index) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid line item '+(index+1));
  const title=text(raw.description,180);
  if(!title)throw new Error('Line item '+(index+1)+' requires a description.');
  const quantityMilli=parseQuantity(raw.quantity);
  if(quantityMilli===0)throw new Error('Line item '+(index+1)+' quantity must be greater than zero.');
  const priceAgorot=toAgorot(raw.price);
  const totalAgorot=calculateLineAgorot(quantityMilli,priceAgorot);
  return {description:title,quantityMilli,priceAgorot,totalAgorot};
}

/** Calculate a normalized document draft; no data is sent or persisted. */
export function calculateDraft(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Expected a draft object.');
  const kind=String(input.kind||'invoice');
  if(!Object.hasOwn(KINDS,kind))throw new Error('Invalid document type.');
  if(!Array.isArray(input.items)||input.items.length<1||input.items.length>80)
    throw new Error('Include 1–80 line items.');
  const items=input.items.map(entry);
  const subtotalExact=items.reduce((sum,item)=>sum+BigInt(item.totalAgorot),0n);
  if(subtotalExact>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Subtotal is too large.');
  const subtotal=Number(subtotalExact);
  const vatBasisPoints=parseVatRate(input.vatRate??'0');
  const vatExact=(subtotalExact*BigInt(vatBasisPoints)+5000n)/10000n;
  const totalExact=subtotalExact+vatExact;
  if(totalExact>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError('Document total is too large.');
  const vat=Number(vatExact);
  const total=Number(totalExact);
  const paid=kind==='receipt'?toAgorot(input.amountPaid??'0'):0;
  if(kind==='receipt'&&paid>total)throw new Error('Amount paid cannot exceed calculated total.');
  return {
    version:1,
    draft:true,
    kind,
    title:KINDS[kind],
    currency:CURRENCY,
    date:date(input.date),
    reference:text(input.reference,60),
    issuer:{name:text(input.issuer?.name),address:text(input.issuer?.address,300),details:text(input.issuer?.details,240)},
    customer:{name:text(input.customer?.name),address:text(input.customer?.address,300),details:text(input.customer?.details,240)},
    notes:text(input.notes,1000),
    items,
    vatBasisPoints,
    subtotalAgorot:subtotal,
    vatAgorot:vat,
    totalAgorot:total,
    paidAgorot:paid,
    remainingAgorot:kind==='receipt'?total-paid:total,
    paymentMethod:kind==='receipt'?text(input.paymentMethod,90):'',
  };
}

/** Parse an editable exported JSON draft while rejecting unexpected structures. */
export function importDraftJson(content) {
  if(typeof content!=='string'||content.length>200_000)throw new RangeError('Draft exceeds 200 KB.');
  let parsed;
  try{parsed=JSON.parse(content);}catch{throw new Error('Invalid JSON file.');}
  if(!parsed||parsed.version!==1||parsed.draft!==true)
    throw new Error('Not a supported version 1 financial draft.');
  calculateDraft(parsed);
  return parsed;
}
