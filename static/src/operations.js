import {isHostedDemo, hostedSession, hostedAction, refreshHostedSession} from './hosted-demo.js';
const $ = id => document.getElementById(id);
let status, authorities, prepared, busy = false, proposalRevision = 0;
const el = (tag,text,cls) => {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
async function api(path,body) {const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(typeof value.detail==='string'?value.detail:'The operation could not be completed.');return value;}
function show(value,error=false) {$('ops-feedback').textContent=typeof value==='string'?value:JSON.stringify(value,null,2);$('ops-feedback').classList.toggle('error',error);}
async function run(fn) {if(busy)return;busy=true;const controls=Array.from(document.querySelectorAll('[data-demo],[data-phase],#demo-purchase-form button,#demo-report-form button,#demo-resolve,#ops-refresh'));controls.forEach(button=>button.disabled=true);try{await fn();}catch(e){show(e.message,true);}finally{busy=false;controls.forEach(button=>button.disabled=false);if(isHostedDemo(status))lockHostedControls();}}
function download(value) {const href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=el('a');a.href=href;a.download='cropguard-unsigned-safe-batch.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);}
async function refresh() {
  if(!status?.deployed)return;
  if(isHostedDemo(status))return refreshHostedProgress();
  const [a,o]=await Promise.all([api('/api/operations/authorities'),api('/api/operations/observations')]);authorities=a.authorities;
  $('ops-authorities').replaceChildren();
  for(const[role,group] of Object.entries(authorities)){const box=el('article',undefined,'panel');box.append(el('h3',role==='adminSafe'?'Administration Safe':'Independent resolver Safe'),el('p',`${group.threshold} of ${group.owners.length} signatures required · nonce ${group.nonce}`),el('p',group.address,'hash'));for(const owner of group.owners)box.append(el('p',owner,'hash'));$('ops-authorities').append(box);}
  $('ops-observations').replaceChildren();
  for(const row of o.items){const box=el('article',undefined,'panel');const names=['No report','Proposed','Disputed / escalated','Final'];box.append(el('h3',names[Number(row.result.state)]??'Unknown'),el('p',row.key,'hash'));const details=el('pre',JSON.stringify(row,null,2));box.append(details);const inspect=el('button','Inspect and challenge in Weather evidence','button outline');inspect.onclick=()=>{$('observation-key').value=row.key;document.querySelector('[data-page="weather"]').click();$('observation-form').requestSubmit();};box.append(inspect);$('ops-observations').append(box);}
  if(status.network.demoOnly){const d=await api('/api/demo/status');$('demo-state').textContent=JSON.stringify(d,null,2);populateSigners();}
}
function selectedSigners(role){return Array.from(document.querySelectorAll(`#demo-${role}-signers input:checked`)).map(n=>n.value);}
function populateSigners(){for(const role of ['admin','resolver']){const target=$(`demo-${role}-signers`),prior=selectedSigners(role);target.replaceChildren();for(const account of authorities[role==='admin'?'adminSafe':'resolverSafe'].owners){const input=el('input');input.type='checkbox';input.value=account;input.checked=prior.includes(account);const label=el('label');const known=status.manifest.demoAccounts.find(a=>a.address.toLowerCase()===account.toLowerCase());label.append(input,document.createTextNode(` ${known?.label??known?.role??account}`));target.append(label);}}}
async function demoAction(action,params={}) {
  if(isHostedDemo(status))return confirmHostedAction(action,params);
  if(['open-sales','safe','resolve'].includes(action)){const role=action==='resolve'||params.authority==='resolver'?'resolver':'admin';params.signers=selectedSigners(role);if(params.signers.length!==2)throw new Error(`Select exactly two ${role} test signers first.`);}
  const description = `${action}\n${JSON.stringify(params,null,2)}\n\nThis changes only the local chain. Test identities and test funds have no real-world value.`;
  const dialog=$('demo-review');$('demo-review-text').textContent=description;
  const accepted=await new Promise(resolve=>{let answer=false;$('demo-review-confirm').onclick=()=>{answer=true;dialog.close();};dialog.onclose=()=>resolve(answer);dialog.showModal();});
  if(!accepted)return;
  show('Submitting and checking local contract receipts…');const result=await api('/api/demo/actions',{action,params});show(result);await refresh();window.dispatchEvent(new CustomEvent('cropguard:refresh'));
}
let hostedProgress, hostedPolicies = [], hostedRefreshBusy = false;
function lockHostedControls() {
  const controller = hostedSession?.role === 'controller';
  document.querySelectorAll('#demo-workspace [data-demo],#demo-workspace [data-phase]').forEach(button => {
    button.disabled = busy || !controller || button.dataset.done === 'true';
    button.title = controller ? (button.dataset.done === 'true' ? 'This step has already been replayed.' : '') : 'Presenter sign-in is required to operate the shared run.';
  });
  if($('demo-access-hint'))$('demo-access-hint').textContent = controller ? 'Follow the numbered steps. Each one replays a step recorded from a real run on a private test blockchain; nothing is executed while you click.' : 'You are viewing one shared run. The presenter controls each step. You can refresh progress and explore the ERA5 evidence.';
}
async function confirmHostedAction(action, params) {
  if(hostedSession?.role !== 'controller')throw new Error('Sign in as the presenter above to operate this run.');
  const titles = {fund:'Fund the demonstration pool with 15,000 test tokens',advance:'Advance the demonstration clock', 'open-sales':'Open demonstration policy sales',purchase:'Purchase the two-hectare demonstration policy',report:'Replay the archived ERA5-Land rainfall',finalize:'Finalize the rainfall observation','settle-pay':'Settle and pay the demonstration policy'};
  const dialog=$('demo-review');
  $('demo-review-text').textContent=`${titles[action] || action}\n${params.phase ? `Stage: ${params.phase}\n` : ''}\nRecorded run: ${hostedSession.runId}\n\nThis replays a recorded step in this browser tab only. Historical rainfall is from ERA5-Land. The payment tokens have no real-world value.`;
  const accepted=await new Promise(resolve=>{let answer=false;$('demo-review-confirm').onclick=()=>{answer=true;dialog.close();};dialog.onclose=()=>resolve(answer);dialog.showModal();});
  if(!accepted)return;
  show('Replaying the recorded step…');
  const result=await hostedAction(action,params);
  show('Recorded step replayed. The progress below has been refreshed.');
  $('demo-last-receipt').textContent=JSON.stringify(result,null,2);
  await refreshHostedProgress();window.dispatchEvent(new CustomEvent('cropguard:refresh'));
}
async function refreshHostedProgress() {
  if(hostedRefreshBusy)return;
  hostedRefreshBusy=true;
  try {
    await refreshHostedSession();
    const d=await api('/api/demo/status');hostedProgress=d;
    const farmer=status.manifest.demoAccounts?.find(a=>a.role==='farmer')?.address;
    if(farmer){try{hostedPolicies=(await api(`/api/policies/${farmer}?after=0`)).items;}catch{hostedPolicies=[];}}
    const paid=hostedPolicies.some(p=>Number(p.state)===3), observation=Number(d.observationState);
    const labels=['No report yet','Report proposed · review period','Report disputed','Rainfall finalized'];
    const pool=(Number(d.pool?.capitalAssets??0)/1e6).toLocaleString(undefined,{maximumFractionDigits:2});
    $('demo-progress-title').textContent=paid?'Demonstration payment recorded':Number(d.policyCount)>0?'Policy purchased':d.salesEnabled?'Sales opened':Number(d.pool?.capitalAssets)>0?'Pool funded':'Ready to begin';
    $('demo-progress-summary').textContent=`Pool: ${pool} test tokens · Policies: ${d.policyCount??0} · ${labels[observation]??'Status unavailable'}`;
    $('demo-progress-rainfall').textContent=observation>0?`${(Number(d.rainfallMmX1000)/1000).toFixed(3)} mm archived rainfall`:'Archived rainfall will be reported at step 6.';
    $('demo-progress-payment').textContent=paid?'Paid: 300 demonstration tokens for the two-hectare policy.':'Maximum demonstration payout: 300 test tokens. Premium: 60.945 test tokens.';
    $('demo-state').textContent=JSON.stringify(d,null,2);
    const done={fund:Number(d.pool?.capitalAssets)>0||Number(d.policyCount)>0,'open-sales':Boolean(d.salesEnabled)||Number(d.policyCount)>0,purchase:Number(d.policyCount)>0,report:observation>0,finalize:observation===3,'settle-pay':paid};
    targetButtons('[data-demo]',b=>done[b.dataset.demo]);
    targetButtons('[data-phase]',b=>b.dataset.phase==='funding-close'?Number(d.timestamp)>=Number(status.manifest.fundingClose):b.dataset.phase==='report'?Number(d.timestamp)>=Number(status.manifest.reportNotBefore):observation===3);
    $('demo-updated').textContent=`Last checked ${new Date().toLocaleTimeString()}. Refreshes while this view is open.`;
    const evidence=$('demo-evidence-link');evidence.hidden=!d.evidenceUrl;if(d.evidenceUrl)evidence.href=d.evidenceUrl;
  } finally {hostedRefreshBusy=false;lockHostedControls();}
}
function targetButtons(selector,completed) {document.querySelectorAll(`#demo-workspace ${selector}`).forEach(button=>{button.dataset.done=String(Boolean(completed(button)));button.classList.toggle('demo-step-done',button.dataset.done==='true');});}
function buildHostedDemo() {
  const target=$('demo-workspace');target.classList.remove('hidden');
  const replay=status.manifest.historicalReplay??{};
  target.innerHTML=`<article class="panel"><span class="eyebrow muted">RECORDED REPLAY · TEST TOKENS</span><h2>Follow a season from rainfall to payment</h2><p>Real ERA5-Land rainfall powers the model. Each step below replays what a private test blockchain recorded when this walkthrough was run for real on 5 October 2026; nothing is executed while you click. The chain's clock was moved through the season during that run.</p><p class="notice" id="demo-access-hint"></p><div class="hosted-progress" aria-live="polite"><h3 id="demo-progress-title">Loading replay progress…</h3><p id="demo-progress-summary"></p><p id="demo-progress-rainfall"></p><p id="demo-progress-payment"></p><a id="demo-evidence-link" class="text-button" hidden target="_blank" rel="noopener noreferrer">Open archived ERA5 evidence ↗</a><p class="small" id="demo-updated"></p><button id="ops-refresh" class="button outline">Refresh progress</button></div><ol class="hosted-demo-steps"><li><h3>Fund the pool</h3><p>Three demonstration capital providers contribute 15,000 test tokens in total.</p><button class="button outline" data-demo="fund">1. Fund demonstration pool</button><button class="button outline" data-phase="funding-close">2. Move to funding cutoff</button><button class="button outline" data-demo="open-sales">3. Open policy sales</button></li><li><h3>Purchase two hectares of cover</h3><p>Review the premium and payout on the policy page. This run contains one demonstration policy.</p><button class="button outline" data-demo="purchase">4. Buy two-hectare cover</button></li><li><h3>Report the historical rainfall</h3><p id="hosted-rainfall-description"></p><button class="button outline" data-phase="report">5. Move to reporting date</button><button class="button outline" data-demo="report">6. Report archived ERA5 rainfall</button></li><li><h3>Finalize and pay</h3><p>The three-day review period remains in the contract. The demonstration clock advances so the result can be finalized.</p><button class="button outline" data-phase="challenge-end">7. Pass the review period</button><button class="button outline" data-demo="finalize">8. Finalize rainfall</button><button class="button primary" data-demo="settle-pay">9. Settle and pay policy</button></li></ol><pre id="ops-feedback" class="notice" role="status" aria-live="polite">No action submitted from this page.</pre><details><summary>Most recent action receipt</summary><pre id="demo-last-receipt">The recorded receipt appears here after you confirm a step.</pre></details><details><summary>Current contract state</summary><pre id="demo-state">Loading…</pre></details></article><dialog id="demo-review"><form method="dialog" class="dialog-close"><button aria-label="Cancel">×</button></form><h2>Review demonstration action</h2><pre id="demo-review-text"></pre><button id="demo-review-confirm" class="button primary">Confirm action</button></dialog>`;
  $('hosted-rainfall-description').textContent=`The archived June–September ${replay.sourceYear??2023} rainfall is ${(Number(replay.rainfallMmX1000??161524)/1000).toFixed(3)} mm. Its source is pinned to the saved ERA5-Land history and cannot be edited here.`;
  $('ops-refresh').onclick=()=>run(refreshHostedProgress);
  target.querySelectorAll('[data-demo]').forEach(button=>button.onclick=()=>run(()=>demoAction(button.dataset.demo,button.dataset.demo==='purchase'?{units:2,role:'farmer'}:{})));
  target.querySelectorAll('[data-phase]').forEach(button=>button.onclick=()=>run(()=>demoAction('advance',{phase:button.dataset.phase})));
  window.addEventListener('cropguard:hosted-session',lockHostedControls);
  setInterval(()=>{if(!document.hidden&&!$('page-operations').classList.contains('hidden')&&!busy)void refreshHostedProgress().catch(error=>show(error.message,true));},15000);
  lockHostedControls();
}
function build() {
  const target=$('governance-workspace');if(!target||target.childElementCount)return;
  target.innerHTML=`<article class="panel"><div class="section-heading"><div><span class="eyebrow muted">GOVERNANCE &amp; RESOLUTION</span><h2>Review authority and decisions</h2></div><button id="ops-refresh" class="button outline">Refresh state</button></div><p>Participant operators cannot change products or resolve weather disputes. Production proposals are exported for review and signing in the configured Safe. Independent people must hold the owner keys.</p></article><div class="two-col" id="ops-authorities"></div><details class="panel"><summary>Prepare an unsigned administration or resolution proposal</summary><form id="ops-proposal-form"><label for="ops-role">Signing authority</label><select id="ops-role"><option value="adminSafe">Administration Safe</option><option value="resolverSafe">Independent resolver Safe</option></select><label for="ops-calls">Explicit contract calls (JSON)</label><textarea id="ops-calls" rows="9" maxlength="24000" required>[{"module":"ProductRegistry","function":"setSalesEnabled","args":[true]}]</textarea><p class="small">For a dispute: OracleAdapter / resolve / [observation key, rainfall in thousandths of a mm, adjudication evidence hash]. Product creation and registration accept the exact named fields in the contract ABI.</p><div class="button-row"><button class="button primary" type="submit">Prepare and simulate proposal</button><button class="button outline" id="ops-abi" type="button">Show allowed function fields</button><button class="button outline" id="ops-export" type="button" disabled>Download unsigned Safe batch</button><button class="button outline hidden" id="ops-local-execute" type="button" disabled>Execute with two selected local signers</button></div></form><pre id="ops-proposal-result"></pre></details><article class="panel"><h3>Registered observation state</h3><div id="ops-observations"></div></article><pre id="ops-feedback" class="notice" role="status" aria-live="polite">No administrative changes submitted.</pre>`;
  $('ops-refresh').onclick=()=>run(refresh);
  $('ops-abi').onclick=()=>run(async()=>{$('ops-proposal-result').textContent=JSON.stringify(await api('/api/operations/functions'),null,2);});
  $('ops-proposal-form').onsubmit=event=>{event.preventDefault();void run(async()=>{const revision=++proposalRevision,calls=JSON.parse($('ops-calls').value),role=$('ops-role').value;const result=await api('/api/operations/prepare',{role,calls});if(revision!==proposalRevision)return;prepared={...result,calls,role};$('ops-proposal-result').textContent=JSON.stringify(prepared,null,2);$('ops-export').disabled=false;$('ops-local-execute').disabled=calls.length!==1;});};
  for(const id of ['ops-role','ops-calls'])$(id).addEventListener('input',()=>{++proposalRevision;prepared=undefined;$('ops-proposal-result').textContent='Inputs changed. Prepare this proposal again.';$('ops-export').disabled=true;$('ops-local-execute').disabled=true;});
  $('ops-export').onclick=()=>{if(prepared)download(prepared.unsignedBatch);};
  $('ops-local-execute').onclick=()=>run(async()=>{if(!prepared||prepared.calls.length!==1)throw new Error('Prepare one explicit call.');await demoAction('safe',{...prepared.calls[0],authority:prepared.role==='resolverSafe'?'resolver':'admin'});});
}
function buildDemo() {
  const target=$('demo-workspace');target.classList.remove('hidden');$('ops-local-execute').classList.remove('hidden');
  target.innerHTML=`<article class="panel"><span class="eyebrow muted">LOCAL CHAIN / TEST FUNDS ONLY</span><h2>Walk through the entire season</h2><p>The controls below execute real contract calls on Anvil. Time advances explicitly; the three-day challenge window and 120-day publication buffer stay in the contract. Each action is reviewed before execution. Use Participation to demonstrate private application review, or use the pre-approved test roles for a complete lifecycle.</p><div class="demo-signatures"><fieldset><legend>Administration test signers · choose two</legend><div id="demo-admin-signers"></div></fieldset><fieldset><legend>Resolver test signers · choose two</legend><div id="demo-resolver-signers"></div></fieldset></div><div class="button-row"><button class="button outline" data-demo="fund">1. Fund 7,500 / 4,500 / 3,000</button><button class="button outline" data-phase="funding-close">2. Advance to funding cutoff</button><button class="button outline" data-demo="open-sales">3. Finalize funding and open sales</button></div><form id="demo-purchase-form"><label for="demo-units">Farmer hectares (100 demonstrates the whole pool)</label><input id="demo-units" type="number" min="1" max="100" value="2" required><button class="button outline" type="submit">4. Approve premium and buy cover</button></form><div class="button-row"><button class="button outline" data-phase="coverage-end">5. Advance to season end</button><button class="button outline" data-phase="report">6. Advance to publication date</button></div><form id="demo-report-form"><label for="demo-rainfall">Synthetic seasonal rainfall (mm, up to three decimals)</label><input id="demo-rainfall" value="250.000" pattern="[0-9]{1,5}(\.[0-9]{1,3})?" required><div class="button-row"><button class="button primary" type="submit">7. Submit labelled local oracle report</button><button class="button outline" id="demo-resolve" type="button">Resolve dispute with this measured value</button></div></form><div class="button-row"><button class="button outline" data-demo="challenge">Challenge the proposal</button><button class="button outline" data-phase="challenge-end">8. Advance past three-day challenge</button><button class="button outline" data-demo="finalize">9. Finalize uncontested observation</button><button class="button outline" data-demo="settle-pay">10. Settle and pay all policies</button><button class="button outline" data-demo="withdraw-fees">11. Withdraw accrued fee</button><button class="button outline" data-demo="redeem">12. Redeem provider shares</button></div><details><summary>Missing-oracle and failure branch</summary><p>Use a new local season to exercise this alternative. After purchasing, skip the report, advance beyond the resolution deadline, then apply the agreed full-payout default and settle. A missing value is never represented as measured rainfall.</p><div class="button-row"><button class="button outline" data-phase="report-deadline">Advance past report deadline</button><button class="button outline" data-phase="failure">Advance past resolution deadline</button><button class="button outline" data-demo="finalize-failure">Apply contractual failure procedure</button></div></details><details><summary>Current local chain details</summary><pre id="demo-state">Loading…</pre></details></article><dialog id="demo-review"><form method="dialog" class="dialog-close"><button aria-label="Cancel">×</button></form><h2>Review local demonstration action</h2><pre id="demo-review-text"></pre><button id="demo-review-confirm" class="button primary">Confirm local action</button></dialog>`;
  if(status.manifest.era5Replay) {
    const replay=status.manifest.historicalReplay;
    const notice=el('p',replay.notice,'notice');
    target.querySelector('article').prepend(notice);
    target.querySelector('h2').textContent=`Replay the ${replay.sourceYear} ERA5-Land season`;
    target.querySelector('label[for="demo-rainfall"]').textContent=`Archived ERA5-Land rainfall · June–September ${replay.sourceYear} (mm)`;
    $('demo-rainfall').value=(Number(replay.rainfallMmX1000)/1000).toFixed(3);
    $('demo-rainfall').readOnly=true;
    $('demo-rainfall').title='Pinned to the saved ERA5-Land source. The server recomputes this total; it cannot be entered manually.';
    $('demo-report-form').querySelector('button[type="submit"]').textContent='7. Replay the archived ERA5-Land season';
    $('demo-resolve').hidden=true;
    target.querySelectorAll('[data-demo="challenge"]').forEach(button=>button.hidden=true);
    target.querySelectorAll('details').forEach(detail=>{if(detail.querySelector('summary')?.textContent==='Missing-oracle and failure branch')detail.hidden=true;});
  }
  target.querySelectorAll('[data-demo]').forEach(button=>button.onclick=()=>run(()=>demoAction(button.dataset.demo)));
  target.querySelectorAll('[data-phase]').forEach(button=>button.onclick=()=>run(()=>demoAction('advance',{phase:button.dataset.phase})));
  $('demo-purchase-form').onsubmit=event=>{event.preventDefault();void run(()=>demoAction('purchase',{units:Number($('demo-units').value),role:'farmer'}));};
  const rainfall=()=>{const text=$('demo-rainfall').value;if(!/^\d{1,5}(\.\d{1,3})?$/.test(text))throw new Error('Enter rainfall with at most three decimals.');const [a,b='']=text.split('.');return Number(a)*1000+Number(b.padEnd(3,'0'));};
  $('demo-report-form').onsubmit=event=>{event.preventDefault();void run(()=>demoAction('report',{rainfallMmX1000:rainfall()}));};
  $('demo-resolve').onclick=()=>run(()=>demoAction('resolve',{rainfallMmX1000:rainfall()}));
}
async function initialize(value){status=value;if(isHostedDemo(status)){buildHostedDemo();await run(refresh);return;}build();if(!status.deployed){show('Deploy the contracts or start the local demonstration to inspect governance and observations.');return;}if(status.manifest.releaseReviewHash)$('ops-calls').value=JSON.stringify([{module:'ProductRegistry',function:'setSalesEnabled',args:[true,status.manifest.releaseReviewHash]}],null,2);if(status.network?.demoOnly)buildDemo();await run(refresh);}
if(window.cropguardStatus)void initialize(window.cropguardStatus);else window.addEventListener('cropguard:status',event=>void initialize(event.detail),{once:true});
window.addEventListener('cropguard:navigate',event=>{if(event.detail.page==='operations')void run(refresh);});
