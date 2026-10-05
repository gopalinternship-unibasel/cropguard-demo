import { money as roundedMoney, exactMoney } from './risk-format.js';
import { readEvidenceJson, evidenceJsonBlob } from './json-evidence.js';

const $ = id => document.getElementById(id);
const panel = $('page-research');
const state = { items: [], basis: null, spatial: null, portfolio: null, initialized: false, locationSequence: 0 };
function el(tag, text, className) { const n=document.createElement(tag); if(text!==undefined)n.textContent=text; if(className)n.className=className; return n; }
const percent = value => value === null ? 'No loss cases' : `${(value*100).toFixed(2)}%`;
const money = value => `${roundedMoney(String(value))} USDC`;
export function selectedIds(select) { return Array.from(select.selectedOptions).map(option=>option.value).filter(Boolean); }
export function basisSummary(report) { return { population: percent(report.lossWithoutPaymentPopulationFraction), amongLosses: percent(report.falseNegativeRateAmongLosses) }; }
async function api(path,body) {
  const response=await fetch(`/api/research/${path}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await readEvidenceJson(response).catch(()=>({detail:'Service returned an unreadable response.'}));
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Check the input fields and try again.');
  return data;
}
function feedback(key,text,error=false) { const n=$(`research-${key}-status`); n.textContent=text;n.dataset.error=String(error); }
async function action(key,work) {
  const form=$(`research-${key}-form`);
  if(form.dataset.busy==='true'||!form.reportValidity())return;
  form.dataset.busy='true';form.setAttribute('aria-busy','true');
  const buttons=Array.from(form.querySelectorAll('button,input,select,textarea'));const disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
  feedback(key,'Calculating and checking evidence…');
  try { await work(); } catch(error) { feedback(key,error.message,true); }
  finally { buttons.forEach((b,i)=>b.disabled=disabled[i]);form.dataset.busy='false';form.removeAttribute('aria-busy'); }
}
function download(name,content,type='application/json') { const blob=typeof content==='string'?new Blob([content],{type}):evidenceJsonBlob(content);const url=URL.createObjectURL(blob);const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
function row(label,value) { const n=el('div',undefined,'data-row');n.append(el('span',label),el('strong',value));return n; }
function kpis(values) { const n=el('div',undefined,'research-kpis');for(const [label,value] of values){const item=el('div',undefined,'research-kpi');item.append(el('strong',value),el('span',label));n.append(item);}return n; }
function details(value,label='Evidence and assumptions') { const d=el('details');d.append(el('summary',label),el('pre',JSON.stringify(value,null,2)));return d; }
function renderBasis(target,report) {
  const n=$(target);n.replaceChildren();const s=basisSummary(report);
  n.append(kpis([['Loss without payment · all observations',s.population],['Missed among loss cases',s.amongLosses],['Paired observations',report.observations.toLocaleString()]]));
  const table=el('table');const caption=el('caption',report.synthetic?'Synthetic drought-proxy outcomes':'Paired outcomes');table.append(caption);
  const head=el('tr');for(const t of ['','No index payment','Index payment']){const th=el('th',t);th.scope='col';head.append(th);}table.append(head);
  for(const [label,no,yes] of [['No loss',report.counts.trueNegative,report.counts.falsePositive],['Loss',report.counts.falseNegative,report.counts.truePositive]]){const tr=el('tr');const th=el('th',label);th.scope='row';tr.append(th,el('td',no.toLocaleString(),label==='Loss'?'research-missed':''),el('td',yes.toLocaleString()));table.append(tr);}n.append(table);
  n.append(el('p','The 2.9% slide reference is 285 / 10,000, not the conditional rate 285 / 1,140 = 25%. This result uses the supplied or newly generated observations.','research-note'));
  n.append(details(Object.fromEntries(Object.entries(report).filter(([key])=>key!=='pairsCsv'))));
}
function populate(select) {
  const prior=selectedIds(select);select.replaceChildren();
  for(const item of state.items){const o=new Option(`${item.station} · ${item.start_month} → ${item.end_month_exclusive} · ${item.snapshot_id.slice(2,10)}`,item.snapshot_id);o.selected=prior.includes(item.snapshot_id);select.append(o);}
}
async function refresh() {
  try { const result=await api('baselines');state.items=result.items;populate($('research-snapshots'));panel.querySelectorAll('[data-portfolio-snapshots]').forEach(populate);$('research-source-note').textContent=state.items.length?`${state.items.length} saved ERA5-Land snapshots. Choose history for the intended point; selecting it is not geography approval.`:'No saved ERA5-Land history is available. Collect real historical evidence in the weather workflow before preparing a calibration. Synthetic teaching data cannot substitute for this baseline.'; }
  catch(error){$('research-source-note').textContent=error.message;}
}
function calibrationBody() { return {snapshot_ids:selectedIds($('research-snapshots')),start_year:Number($('research-start').value),end_year:Number($('research-end').value),threshold_mode:$('research-threshold-mode').value,threshold_mm:$('research-threshold').value,hectares:Number($('research-hectares').value),maximum_usdc:$('research-maximum').value,period_capital_bps:Number($('research-capital').value),operating_fee_usdc:$('research-fee').value,oracle_failure_allowance_usdc:$('research-failure').value,simulations:Number($('research-trials').value),seed:Number($('research-seed').value)}; }
async function calibrate(save) {
  const result=await api(save?'calibration/register':'calibration',calibrationBody());const c=result.calibration;const n=$('research-calibration-result');n.replaceChildren();
  n.append(kpis([['Proposed premium / ha',money(c.pricing.premiumPerHaBaseUnits)],['Simulated trigger frequency',percent(c.simulatedTriggerProbability)],['Fitted 10th percentile',`${c.modelFit.tenthPercentileMm.toFixed(3)} mm`]]));
  n.append(row('Exact premium / ha',`${exactMoney(c.pricing.premiumPerHaBaseUnits)} USDC`),row('Effective threshold',`${c.parameters.threshold_mm} mm`),row('History',`${c.completeSeasons} seasons · ${c.trainingFirstYear}–${c.trainingLastYear}`),row('Full collateral',money(c.pricing.requiredCollateralBaseUnits)));
  n.append(row('Rate on line · premium / maximum',percent(result.pricingDiagnostics.rateOnLine)),row('Capital share of premium',result.pricingDiagnostics.capitalShareOfPremium===null?'Not applicable':percent(result.pricingDiagnostics.capitalShareOfPremium)));
  n.append(el('p','Prepared for review. Geography, product terms and model assumptions still require approval. No issued policy or on-chain rate has changed.','research-note'));
  if(result.packageId){const a=el('a','Download review bundle + R comparison','button outline');a.href=`/api/research/calibration/${encodeURIComponent(result.packageId)}/bundle`;a.download='cropguard-calibration-review.zip';n.append(a,el('p',result.packageId,'research-hash'));}
  const exportButton=el('button','Export review summary','button outline');exportButton.onclick=()=>download('cropguard-calibration-review.json',result);n.append(exportButton,details(result));
  feedback('calibration',save?'Review package saved with an immutable content ID. Download the data, trials and portable R comparison.':'Calculated from verified saved evidence. Save a review package to obtain the portable data and R comparison bundle.');
}
function addLocation() {
  const target=$('research-portfolio-locations'),count=target.children.length;if(count>=5)return;
  const serial=++state.locationSequence;
  const box=el('div',undefined,'research-location');const label=el('label',`Location ${serial} · saved snapshots`);const select=el('select');select.id=`research-location-${serial}`;label.htmlFor=select.id;select.multiple=true;select.size=3;select.required=true;select.dataset.portfolioSnapshots='';populate(select);
  const hlabel=el('label','Hectares at this location');const input=el('input');input.id=`research-location-ha-${serial}`;hlabel.htmlFor=input.id;input.type='number';input.min='1';input.max='10000';input.value='50';input.required=true;input.dataset.portfolioHectares='';box.append(label,select,hlabel,input);
  if(count>=2){const remove=el('button','Remove location','text-button');remove.type='button';remove.onclick=()=>{box.remove();$('research-add-location').disabled=false;state.portfolio=null;$('research-portfolio-export').disabled=true;};box.append(remove);}target.append(box);$('research-add-location').disabled=target.children.length>=5;
}
function portfolioPlot(report) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 500 165');svg.setAttribute('class','research-bars');svg.setAttribute('role','img');svg.setAttribute('aria-label','Comparison of simulated joint loss VaR, historical maximum-dependence VaR and full collateral');
  const max=Number(report.simulatedJoint.fullCollateralBaseUnits)||1;
  for(const [i,label,value,color] of [[0,'Simulated joint VaR',report.simulatedJoint.var995BaseUnits,'#789460'],[1,'Maximum-dependence VaR',report.sameMarginalsMaximumDependence.var995BaseUnits,'#b29459'],[2,'Full collateral retained',report.simulatedJoint.fullCollateralBaseUnits,'#344d29']]){
    const text=document.createElementNS(svg.namespaceURI,'text');text.setAttribute('x','0');text.setAttribute('y',String(18+i*52));text.textContent=`${label}: ${money(value)}`;
    const bar=document.createElementNS(svg.namespaceURI,'rect');bar.setAttribute('x','0');bar.setAttribute('y',String(26+i*52));bar.setAttribute('width',String(Number(value)/max*490));bar.setAttribute('height','13');bar.setAttribute('fill',color);svg.append(text,bar);
  }return svg;
}
async function initialize(){
  if(state.initialized)return;state.initialized=true;await refresh();
  try{
    const r=await api('reference');
    $('research-reference').replaceChildren(
      kpis([['Gross reference premium / ha',money(r.pricing.premiumPerHaBaseUnits)],['Expected pool loss',money(r.pricing.expectedPoolLossBaseUnits)],['Full collateral · 100 ha',money(r.pricing.requiredCollateralBaseUnits)]]),
      row('Rate on line · premium / maximum',percent(r.pricingDiagnostics.rateOnLine)),
      row('Capital share of premium',`${(r.pricingDiagnostics.capitalShareOfPremium*100).toFixed(1)}%`),
      el('p','The original presentation baseline and R run are not included. The packaged Adama ERA5-Land calibration and model scenarios are kept separate from this arithmetic reference.','small'));
  }catch(e){$('research-reference').textContent=e.message;}
}
if(panel){
  addLocation();addLocation();$('research-add-location').onclick=addLocation;$('research-refresh').onclick=refresh;
  $('research-calibration-form').onsubmit=e=>{e.preventDefault();void action('calibration',()=>calibrate(false));};$('research-register').onclick=()=>void action('calibration',()=>calibrate(true));
  $('research-basis-file').onchange=async()=>{const file=$('research-basis-file').files[0];if(!file)return;if(file.size>250000){feedback('basis','CSV exceeds 250 KB.',true);return;}$('research-basis-csv').value=await file.text();};
  $('research-basis-form').onsubmit=e=>{e.preventDefault();void action('basis',async()=>{state.basis=await api('basis-risk',{csv_text:$('research-basis-csv').value,source_label:$('research-basis-label').value,threshold_mm:$('research-basis-threshold').value});renderBasis('research-basis-result',state.basis);$('research-basis-export').disabled=false;feedback('basis','Paired observations analysed. Source labels are declarations, not independent verification.');});};
  $('research-basis-export').onclick=()=>state.basis&&download('cropguard-basis-risk.json',state.basis);
  $('research-spatial-form').onsubmit=e=>{e.preventDefault();void action('spatial',async()=>{state.spatial=await api('spatial-basis',{source:$('research-spatial-source').value,snapshot_ids:selectedIds($('research-snapshots')),standard_deviation_mm:Number($('research-spatial-sd').value),threshold_mm:$('research-spatial-threshold').value,seed:Number($('research-spatial-seed').value),simulations:10000});renderBasis('research-spatial-result',state.spatial);$('research-spatial-export').disabled=false;$('research-spatial-json').disabled=false;feedback('spatial','New synthetic experiment complete. Every assumption is included in the result; these are not observed farmer losses.');});};
  $('research-spatial-export').onclick=()=>state.spatial&&download('cropguard-SYNTHETIC-spatial-pairs.csv',state.spatial.pairsCsv,'text/csv');$('research-spatial-json').onclick=()=>state.spatial&&download('cropguard-SYNTHETIC-spatial-research.json',state.spatial);
  $('research-portfolio-form').onsubmit=e=>{e.preventDefault();void action('portfolio',async()=>{const locations=Array.from($('research-portfolio-locations').children).map(n=>({snapshot_ids:selectedIds(n.querySelector('select')),hectares:Number(n.querySelector('input').value)}));const r=await api('portfolio',{locations,start_year:Number($('research-portfolio-start').value),end_year:Number($('research-portfolio-end').value)});state.portfolio=r;const n=$('research-portfolio-result');n.replaceChildren(kpis([['Aligned historical years',r.alignedYears.length],['Joint expected loss',money(r.historicalJoint.expectedPoolLossBaseUnits)],['Full collateral retained',money(r.simulatedJoint.fullCollateralBaseUnits)]]),portfolioPlot(r),el('p','Resampling preserves observed year-to-year dependence. It cannot establish a reliable rare joint-drought tail or justify reducing contractual collateral.','research-note'),details(r));$('research-portfolio-export').disabled=false;feedback('portfolio','Research comparison complete. No policies were created and collateral requirements were not changed.');});};
  $('research-portfolio-export').onclick=()=>state.portfolio&&download('cropguard-portfolio-research.json',state.portfolio);
  for(const key of ['basis','spatial','portfolio'])$(`research-${key}-form`).addEventListener('input',()=>{state[key]=null;$(`research-${key}-export`).disabled=true;if(key==='spatial')$('research-spatial-json').disabled=true;feedback(key,'Inputs changed. Run the analysis again to export current results.');});
  window.addEventListener('cropguard:navigate',e=>{if(e.detail.page==='research')void initialize();});window.addEventListener('cropguard:weather-datasets',refresh);if(!panel.classList.contains('hidden'))void initialize();
}
