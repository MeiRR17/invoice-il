import { parseQuantity, toAgorot } from './draft.js';

/**
 * Import/export a small editable item table.
 *
 * CSV header is exactly: description,quantity,price
 * - Quantity and price are decimal strings (up to three/two decimal places).
 * - Input values are validated by the existing monetary model.
 * - Descriptions are always treated as text, never evaluated as formulas.
 *
 * The browser UI must request confirmation before replacing current items.
 */
const MAX_BYTES = 100_000;
const MAX_ROWS = 80;
const HEADERS = ['description','quantity','price'];
function parseCsvRows(source) {
  if (typeof source !== 'string' || source.length > MAX_BYTES) {
    throw new RangeError('CSV content must be under 100 KB.');
  }
  const text = source.replace(/^\uFEFF/u, '');
  const rows = [];
  let row=[], cell='', state='start';
  const finishCell = () => { row.push(cell); cell=''; state='start'; };
  const finishRow = () => {
    finishCell();
    if (row.some(item => item.trim())) rows.push(row);
    row=[];
    if (rows.length > MAX_ROWS+1) throw new RangeError('CSV supports at most 80 line items.');
  };
  for (let i=0; i<text.length; i++) {
    const c=text[i];
    if (state==='quoted') {
      if (c==='"') {
        if (text[i+1]==='"') { cell+='"'; i++; }
        else state='afterQuote';
      } else cell+=c;
      continue;
    }
    if (c===',') { finishCell(); continue; }
    if (c==='\n'||c==='\r') {
      finishRow();
      if(c==='\r' && text[i+1]==='\n') i++;
      continue;
    }
    if (state==='afterQuote') throw new SyntaxError('Unexpected characters after a quoted CSV cell.');
    if (c==='"') {
      if (state!=='start') throw new SyntaxError('Unexpected CSV quotation mark.');
      state='quoted'; continue;
    }
    cell+=c;
    state='plain';
  }
  if (state==='quoted') throw new SyntaxError('Unclosed CSV quotation.');
  if(cell.length||row.length||state==='afterQuote')finishRow();
  return rows;
}
function validateItem(item,index) {
  if (!item || typeof item !== 'object') throw new TypeError('Invalid item '+(index+1)+'.');
  const description=String(item.description??'').trim();
  if (!description || description.length>180) throw new RangeError('Item '+(index+1)+' must have a 1–180 character description.');
  const quantity=String(item.quantity??'').trim();
  const price=String(item.price??'').trim();
  if(parseQuantity(quantity)===0) throw new RangeError('Item '+(index+1)+' quantity must exceed zero.');
  toAgorot(price);
  return {description,quantity,price};
}
export function importItemsCsv(source) {
  const rows=parseCsvRows(source);
  if (rows.length<2) throw new Error('CSV must include a header and at least one item.');
  if (rows[0].length!==3 || rows[0].some((v,i)=>v.trim().toLowerCase()!==HEADERS[i])) {
    throw new Error('CSV header must be: description,quantity,price (in this order).');
  }
  if (rows.length-1>MAX_ROWS) throw new RangeError('CSV can contain at most 80 items.');
  return rows.slice(1).map((row,index)=>{
    if(row.length!==3)throw new SyntaxError('CSV item row '+(index+2)+' must have three columns.');
    return validateItem(Object.fromEntries(HEADERS.map((key,i)=>[key,row[i]])),index);
  });
}
function csvCell(value, numeric=false) {
  let text=String(value??'');
  // Protect spreadsheet importers against formula execution in descriptions.
  if (!numeric && /^[\s]*[=+\-@\t\r\n]/u.test(text)) text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function exportItemsCsv(items) {
  if(!Array.isArray(items)||!items.length||items.length>MAX_ROWS)
    throw new RangeError('Export 1–80 items.');
  const lines=[HEADERS.join(',')];
  for(let i=0;i<items.length;i++) {
    const item=validateItem(items[i],i);
    lines.push([csvCell(item.description),csvCell(item.quantity,true),csvCell(item.price,true)].join(','));
  }
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
