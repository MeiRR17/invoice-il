import { calculateDraft, calculateLineAgorot, formatMoney, importDraftJson, KINDS, parseQuantity, toAgorot } from './src/draft.js';
import { importItemsCsv, exportItemsCsv } from './src/items-csv.js';
import { draftTotalsJson } from './src/totals.js';
import { calculatedLinesCsv, calculatedLinesNumbersCsv } from './src/line-audit.js';
const $=id=>document.getElementById(id);
const entries=$('items');
const preview=$('document-preview');
let lastDraft=null;
let editRevision=0;
let importSequence=0;
function importStillCurrent(request, revision){
  return request===importSequence && revision===editRevision;
}
function importCancelled(){
  message('הטופס השתנה בזמן קריאת הקובץ. הייבוא הישן בוטל כדי לשמור על הנתונים הנוכחיים.',true);
}

// Reject malformed UTF-8 rather than silently replacing invoice information.
async function readImportUtf8(file, maxBytes) {
  if(file.size>maxBytes)throw new RangeError('הקובץ חורג ממגבלת הגודל המותרת.');
  const bytes=await file.arrayBuffer();
  if(bytes.byteLength>maxBytes)throw new RangeError('הקובץ חורג ממגבלת הגודל המותרת.');
  try{
    return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }catch{
    throw new Error('הקובץ אינו מקודד ב־UTF-8 תקין. לא יובאו נתונים.');
  }
}

const labelOf={invoice:'טיוטת חשבונית',receipt:'טיוטת קבלה',quote:'הצעת מחיר (טיוטה)'};
const money=amount=>'₪'+formatMoney(amount);
function message(text,error=false){
  $('message').textContent=text;$('message').className='message'+(error?' error':'');
}
function div(cls=''){const n=document.createElement('div');n.className=cls;return n;}
function node(tag,text,cls=''){
  const n=document.createElement(tag);n.className=cls;n.textContent=String(text??'');return n;
}
function itemFields(row){
  return Object.fromEntries(['description','quantity','price'].map(key=>[
    key,row.querySelector('[data-field="'+key+'"]').value,
  ]));
}
function rawInput(){
  return {
    version:1,draft:true,kind:$('kind').value,date:$('date').value,
    reference:$('reference').value,
    issuer:{name:$('issuer-name').value,address:$('issuer-address').value,details:$('issuer-details').value},
    customer:{name:$('customer-name').value,address:$('customer-address').value,details:$('customer-details').value},
    items:[...entries.querySelectorAll('.item-row')].map(itemFields),
    vatRate:$('vat-rate').value,
    amountPaid:$('paid').value,
    paymentMethod:$('payment-method').value,
    notes:$('notes').value,
  };
}
function addItem(values={description:'',quantity:'1',price:'0'}, afterRow=null){
  if(entries.children.length>=80){message('ניתן להוסיף עד 80 שורות.',true);return;}
  const instance=$('item-template').content.cloneNode(true);
  const row=instance.querySelector('.item-row');
  for(const key of ['description','quantity','price'])
    row.querySelector('[data-field="'+key+'"]').value=values[key]??'';
  row.querySelector('.duplicate-item').addEventListener('click',()=>{
    addItem(itemFields(row),row);
  });
  row.querySelector('.remove-item').addEventListener('click',()=>{
    if(entries.children.length===1){message('יש להשאיר לפחות שורה אחת.',true);return;}
    row.remove();invalidate();
  });
  for(const input of row.querySelectorAll('input')) input.addEventListener('input',()=>{
    updateLineTotal(row);invalidate();
  });
  if(afterRow&&afterRow.parentElement===entries)afterRow.after(instance);
  else entries.append(instance);
  updateLineTotal(row);invalidate();
}
function updateLineTotal(row){
  const raw=itemFields(row),total=row.querySelector('[data-total]');
  try {
    const qtyMilli=parseQuantity(raw.quantity);
    if(qtyMilli===0)throw new Error('Quantity required.');
    const unitPrice=toAgorot(raw.price);
    const amount=calculateLineAgorot(qtyMilli,unitPrice);
    total.textContent='₪'+formatMoney(amount);
  }catch{
    total.textContent='—';
  }
}
function invalidate(){
  editRevision++;
  lastDraft=null;
  $('print').disabled=true;
  $('export-totals').disabled=true;
  $('export-line-audit').disabled=true;
  $('export-numeric-lines').disabled=true;
  // A visible old draft is dangerous even with the print button disabled:
  // Ctrl/Cmd+P could otherwise print amounts from an earlier form state.
  preview.replaceChildren(node('p',
    'התצוגה המקדימה אינה מעודכנת. יש ללחוץ על עדכון תצוגה לפני הדפסה.',
    'preview-outdated'));
}
function field(text,value){
  const container=div('document-field');
  container.append(node('strong',text),node('p',value||'—'));return container;
}
function renderDocument(documentData){
  const d=documentData;
  preview.replaceChildren();
  const top=div('document-top');
  const id=div('document-heading');
  id.append(node('span','טיוטה בלבד · לא מסמך מס רשמי','draft-banner'));
  id.append(node('h2',labelOf[d.kind]));
  id.append(node('p','לצורכי הכנה ובדיקה בלבד — אינו מהווה חשבונית מס או קבלה שהונפקה'));
  const details=div('document-meta');
  details.append(field('תאריך',d.date));
  if(d.reference)details.append(field('סימוכין פנימי',d.reference));
  top.append(id,details);
  preview.append(top);

  const participants=div('document-participants');
  for(const [label,obj] of [['פרטי העסק',d.issuer],['פרטי הלקוח',d.customer]]){
    const pane=div('document-party');
    pane.append(node('h3',label),node('strong',obj.name||'לא צוין'));
    if(obj.address)pane.append(node('p',obj.address));
    if(obj.details)pane.append(node('p',obj.details));
    participants.append(pane);
  }
  preview.append(participants);

  const table=document.createElement('table');table.className='document-table';
  const thead=document.createElement('thead');const tr=document.createElement('tr');
  for(const label of ['תיאור','כמות','מחיר יחידה','סכום']){
    const th=node('th',label);th.scope='col';tr.append(th);
  }
  thead.append(tr);table.append(thead);
  const tbody=document.createElement('tbody');
  for(const item of d.items){
    const row=document.createElement('tr');
    const quantity=(item.quantityMilli/1000).toLocaleString('he-IL',{maximumFractionDigits:3});
    for(const val of [item.description,quantity,money(item.priceAgorot),money(item.totalAgorot)])
      row.append(node('td',val));
    tbody.append(row);
  }
  table.append(tbody);preview.append(table);

  const totals=div('document-totals');
  totals.append(field('סכום ביניים',money(d.subtotalAgorot)));
  totals.append(field('מע״מ (שיעור שהוזן: '+(d.vatBasisPoints/100).toFixed(2)+'%)',money(d.vatAgorot)));
  totals.append(field('סך הכול',money(d.totalAgorot)));
  if(d.kind==='receipt'){
    totals.append(field('סכום ששולם',money(d.paidAgorot)));
    totals.append(field('יתרה',money(d.remainingAgorot)));
    if(d.paymentMethod)totals.append(field('אמצעי תשלום (לפי הצהרה)',d.paymentMethod));
  }
  preview.append(totals);
  if(d.notes)preview.append(field('הערות',d.notes));
  preview.append(node('p','טיוטה לא מחייבת • לא הונפקה באמצעות מערכת לניהול ספרים • יש לבדוק התאמה לדרישות החוק','document-disclaimer'));
}
function updatePreview(){
  try{
    const calculated=calculateDraft(rawInput());
    lastDraft=calculated;
    renderDocument(calculated);
    $('print').disabled=false;
    $('export-totals').disabled=false;
    $('export-line-audit').disabled=false;
    $('export-numeric-lines').disabled=false;
    message('התצוגה המקדימה עודכנה. זהו מסמך טיוטה בלבד.');
  }catch(error){
    invalidate();message(error.message,true);
  }
}
function download(content,filename,mime='application/json;charset=utf-8'){
  const blob=new Blob([content],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function loadForm(data){
  $('kind').value=data.kind;
  $('date').value=data.date;
  $('reference').value=data.reference||'';
  for(const role of ['issuer','customer'])for(const key of ['name','address','details']){
    $(role+'-'+key).value=data[role]?.[key]||'';
  }
  $('vat-rate').value=data.vatRate??'0';
  $('paid').value=data.amountPaid??'0';
  $('payment-method').value=data.paymentMethod??'';
  $('notes').value=data.notes||'';
  entries.replaceChildren();
  for(const item of data.items)addItem(item);
  syncKind();
  invalidate();
}
function syncKind(){
  const isReceipt=$('kind').value==='receipt';
  for(const el of document.querySelectorAll('.receipt-only'))el.hidden=!isReceipt;
}
$('kind').addEventListener('change',()=>{syncKind();invalidate();});
for(const field of document.querySelectorAll('.editor input,.editor textarea,.editor select')){
  field.addEventListener('input',invalidate);
}
$('add-item').addEventListener('click',()=>addItem());
$('update').addEventListener('click',updatePreview);
$('print').addEventListener('click',()=>{
  if(!lastDraft){message('יש לעדכן את התצוגה תחילה.',true);return;}
  window.print();
});
$('export').addEventListener('click',()=>{
  try{
    const raw=rawInput();
    calculateDraft(raw);
    download(JSON.stringify(raw,null,2)+'\n','invoice-il-draft.json');
    message('נשמר קובץ טיוטה לעריכה עתידית. הקובץ עשוי להכיל מידע אישי — שמור אותו באופן מאובטח.');
  }catch(error){message(error.message,true);}
});
$('export-totals').addEventListener('click',()=>{
  if(!lastDraft){message('יש לעדכן את התצוגה תחילה.',true);return;}
  try{
    download(draftTotalsJson(lastDraft),'invoice-il-draft-totals.json');
    message('נשמר דוח סכומים מצומצם ללא פרטי צדדים ופריטים. הסכומים עצמם עלולים להיות רגישים; זו טיוטה בלבד.');
  }catch(error){message('ייצוא דוח הסכומים נכשל: '+error.message,true);}
});
$('export-numeric-lines').addEventListener('click',()=>{
  if(!lastDraft || $('export-numeric-lines').disabled){
    message('יש לעדכן את התצוגה תחילה.',true);return;
  }
  try{
    download(calculatedLinesNumbersCsv(lastDraft),
      'invoice-il-calculated-lines-numbers-draft.csv','text/csv;charset=utf-8');
    message('נשמר דוח שורות מספרי ללא תיאורי פריטים או פרטי צדדים. הסכומים עצמם עשויים להיות רגישים. זה אינו מסמך רשמי.');
  }catch(error){
    message('ייצוא דוח השורות המספרי נכשל: '+error.message,true);
  }
});
$('export-line-audit').addEventListener('click',()=>{
  if(!lastDraft){message('יש לעדכן את התצוגה תחילה.',true);return;}
  try{
    download(calculatedLinesCsv(lastDraft),'invoice-il-calculated-lines-draft.csv',
      'text/csv;charset=utf-8');
    message('יוצא פירוט חישובי שורות בטיוטה. התיאורים עלולים לכלול מידע מסחרי רגיש; אין זה מסמך חשבונאי רשמי.');
  }catch(error){
    message('ייצוא חישובי השורות נכשל: '+error.message,true);
  }
});
$('export-items').addEventListener('click',()=>{
  try{
    const items=[...entries.querySelectorAll('.item-row')].map(itemFields);
    const csv=exportItemsCsv(items);
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download='invoice-il-items-draft.csv';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    message('רשימת הפריטים נשמרה כקובץ CSV. קובץ זה עשוי להכיל מידע מסחרי — יש לשמור אותו במקום מאובטח.');
  }catch(error){message('ייצוא הפריטים נכשל: '+error.message,true);}
});
$('import-items').addEventListener('click',()=>$('items-file').click());
$('items-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  const request=++importSequence;
  const revision=editRevision;
  if(file.size>100_000){message('קובץ הפריטים גדול מדי (מעל 100KB).',true);return;}
  try{
    const text=await readImportUtf8(file,100_000);
    if(!importStillCurrent(request,revision)){if(request===importSequence)importCancelled();return;}
    const imported=importItemsCsv(text);
    if(!confirm('להחליף '+entries.children.length+' פריטים קיימים ב־'+imported.length+' פריטים מהקובץ? פרטים אחרים בטיוטה יישארו ללא שינוי.'))return;
    if(!importStillCurrent(request,revision))return;
    entries.replaceChildren();
    for(const item of imported)addItem(item);
    invalidate();
    message('נטענו '+imported.length+' פריטים. יש לעדכן תצוגה מקדימה לפני הדפסה.');
  }catch(error){if(request===importSequence)message('ייבוא הפריטים נכשל: '+error.message,true);}
});
$('import').addEventListener('click',()=>$('file').click());
$('file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  const request=++importSequence;
  const revision=editRevision;
  if(file.size>200_000){message('קובץ הטיוטה גדול מדי (מעל 200KB).',true);return;}
  try{
    const text=await readImportUtf8(file,200_000);
    if(!importStillCurrent(request,revision)){if(request===importSequence)importCancelled();return;}
    const data=importDraftJson(text);
    if(!confirm('טעינת הקובץ תחליף את הפרטים בטיוטה הנוכחית. להמשיך?'))return;
    if(!importStillCurrent(request,revision))return;
    loadForm(data);updatePreview();
  }catch(error){if(request===importSequence)message('לא ניתן לטעון את הטיוטה: '+error.message,true);}
});
{
  const today=new Date(),local=new Date(today.getTime()-today.getTimezoneOffset()*60_000);
  $('date').value=local.toISOString().slice(0,10);
}
addItem();syncKind();
