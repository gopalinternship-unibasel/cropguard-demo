import {isHostedDemo, initializeHostedDemo} from './hosted-demo.js';
import { parseUnits, formatUnits, shortAddress } from './money.js';
import { money, exactMoney } from './risk-format.js';
import * as wallet from './wallet.js';
const $ = (id) => document.getElementById(id);
const state = { status: null, products: new Map(), productCursor: null, policyCursor: null, selectedProduct: null, termsValid: false, termsRequest: 0, policyRequest: 0, walletRequest: 0, txBusy: false };
const policyLabels = ['Unknown', 'Active coverage', 'Claim approved · unpaid', 'Paid', 'Closed · no trigger'];
const observationLabels = ['No report', 'Proposed · challenge window', 'Disputed / escalated', 'Final'];
function node(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; }
function message(text, error = false) { const box = $('activity'); box.replaceChildren(); box.className = `activity${error ? ' error' : ''}`; const b = node('button', '', '×'); b.onclick = () => box.classList.add('hidden'); box.append(b, node('span', '', text)); }
async function api(path, body) {
  const response = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  let data;
  try { data = await response.json(); } catch { throw new Error('Application service returned an invalid response.'); }
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Request could not be completed.');
  return data;
}
function dateTime(timestamp) { return new Date(Number(timestamp) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
function row(label, value) { const r = node('div', 'data-row'); r.append(node('span', '', label), node('strong', '', value)); return r; }
function empty(target, title, body) { const e = node('div', 'empty'); e.append(node('span', 'empty-symbol', '◈'), node('h3', '', title), node('p', '', body)); $(target).replaceChildren(e); }
function go(page) {
  if (isHostedDemo(state.status) && ['participation','research'].includes(page)) page='pricing';
  if (!['overview','pricing','policies','capital','weather','participation','research','operations'].includes(page)) return;
  document.querySelectorAll('.page').forEach(n => n.classList.toggle('hidden', n.id !== `page-${page}`));
  document.querySelectorAll('.nav').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  $('page-title').textContent = { overview: 'Overview', pricing: 'Pricing lab', policies: isHostedDemo(state.status) ? 'Demo policy' : 'My policies', capital: 'Capital pool', weather: 'Weather evidence', participation: 'Participation', research: 'Model review', operations: isHostedDemo(state.status) ? 'Guided demo' : 'Operations' }[page];
  document.querySelectorAll('.nav').forEach(n => n.setAttribute('aria-current', n.dataset.page === page ? 'page' : 'false'));
  history.replaceState(null, '', '#' + page);
  window.scrollTo({top: 0, left: 0, behavior: 'instant'});
  window.dispatchEvent(new CustomEvent('cropguard:navigate', {detail: {page}}));
  if (page === 'policies') void loadPolicies();
  if (page === 'capital') void loadPool();
  if (page === 'operations' && !isHostedDemo(state.status)) void readiness();
}
document.querySelectorAll('[data-page]').forEach(n => n.onclick = () => go(n.dataset.page));
document.querySelectorAll('[data-navigate]').forEach(n => n.onclick = () => go(n.dataset.navigate));

async function loadNetwork() {
  if (!state.status?.deployed) { $('network-status').textContent = 'Research · sales disabled'; return; }
  try { const n = await api('/api/network'); $('network-status').textContent = `Block ${n.blockNumber.toLocaleString()}`; $('network-status').className = 'badge success'; }
  catch { $('network-status').textContent = 'RPC unavailable'; $('network-status').className = 'badge warning'; }
}
async function loadProducts(append = false) {
  try {
    const data = await api(`/api/products?after=${append ? state.productCursor ?? 0 : 0}`);
    if (!append) { $('product-list').replaceChildren(); state.products.clear(); }
    if (!data.items.length && !append) {
      empty('product-list', data.status === 'not_deployed' ? 'No live product deployed' : 'No products registered', 'The pricing lab is ready to explore. Live coverage appears here after deployment, review and product registration.');
    }
    for (const p of data.items) {
      state.products.set(p.id, p);
      const card = node('article', 'product-card');
      const open = data.salesEnabled && !p.disabled && Number(data.chainTimestamp ?? Date.now()/1000) >= Number(p.salesOpen) && Number(data.chainTimestamp ?? Date.now()/1000) < Number(p.salesClose);
      card.append(node('span', `badge ${open ? 'success' : 'neutral'}`, open ? 'Sales open' : 'Not open for purchase'));
      card.append(node('h3', '', `Weather-index product #${p.id}`));
      card.append(row('Exact premium / unit', `${exactMoney(p.premiumPerUnit)} ${state.status.network?.tokenSymbol ?? 'USDC'}`));
      card.append(row('Premium / coverage unit', `${money(p.premiumPerUnit)} ${state.status.network?.tokenSymbol ?? 'USDC'}`), row('Maximum payout / unit', `${money(p.maxPayoutPerUnit)} ${state.status.network?.tokenSymbol ?? 'USDC'}`), row('Trigger', `< ${formatUnits(p.thresholdMmX1000,3,3)} mm`), row('Coverage begins', dateTime(p.coverageStart)), row('Coverage ends', dateTime(p.coverageEnd)));
      const button = node('button', 'button primary', 'Review policy terms'); button.disabled = !open; button.onclick = () => isHostedDemo(state.status) ? go('operations') : void purchaseDialog(p); if(isHostedDemo(state.status)){button.disabled=false;button.textContent='View guided demonstration';} card.append(button); $('product-list').append(card);
    }
    state.productCursor = data.nextAfter; $('more-products').classList.toggle('hidden', data.nextAfter === null);
  } catch (e) { empty('product-list', 'Contract state unavailable', e.message); }
}
async function loadPool() {
  if (!state.status?.deployed) { $('capital-status').textContent = 'No capital vault has been deployed. Deposits and redemption are unavailable.'; return; }
  try {
    const p = await api('/api/pool');
    document.querySelectorAll('[data-metric]').forEach(n => { const v = p[n.dataset.metric]; n.textContent = v === undefined ? '—' : (n.dataset.metric === 'activePolicies' ? v : money(v)); });
    $('capital-status').textContent = `${p.accountingHealthy ? 'Accounting checks pass.' : 'Accounting invariant FAILED.'} Funding ${p.fundingEnabled ? 'enabled' : 'disabled'}. Launch: ${['Pending','Funded','Failed'][Number(p.fundingState)] ?? 'Unknown'}. Target: ${money(p.minimumFundingTarget)} USDC. Funding cutoff: ${dateTime(p.fundingClose)}. Sales cutoff: ${dateTime(p.salesClose)}.`;
    $('capital-status').classList.toggle('error', !p.accountingHealthy);
    $('finalize-funding').disabled = p.fundingState !== '0' || Number(p.chainTimestamp ?? Date.now()/1000) < Number(p.fundingClose);
  } catch (e) { $('capital-status').textContent = e.message; }
}
async function loadWallet() {
  const account = wallet.currentAccount(), request = ++state.walletRequest;
  if (!account || !state.status?.deployed) return;
  const current = () => request === state.walletRequest && account === wallet.currentAccount();
  try { const w = await api(`/api/wallet/${account}`); if (current()) $('wallet-summary').textContent = `${shortAddress(w.address)} · ${money(w.usdcBalance)} USDC · ${formatUnits(w.shares)} capital shares · ${w.capitalProviderEligible ? 'Capital-provider access approved' : 'No current capital-provider approval'}`; }
  catch (e) { if (current()) $('wallet-summary').textContent = e.message; }
}
async function loadPolicies(append = false) {
  if (state.status?.mode === 'research_preview') {
    $('wallet-summary').textContent = 'Wallet connections and private policy records are disabled in this research preview.';
    $('more-policies').classList.add('hidden');
    empty('policy-list', 'Research preview only', 'No policies are issued or fetched. Use the pricing lab for non-binding analysis.');
    return;
  }
  const account = isHostedDemo(state.status) ? state.status.manifest.demoAccounts?.find(a=>a.role==='farmer')?.address : wallet.currentAccount(), request = ++state.policyRequest;
  if (!account) { state.policyCursor = null; $('more-policies').classList.add('hidden'); $('wallet-summary').textContent = 'Connect a wallet to read its balances and policy records.'; empty('policy-list', 'No wallet connected', 'Connect your wallet again to read its current policy records.'); return; }
  const current = () => request === state.policyRequest && (isHostedDemo(state.status) || account === wallet.currentAccount());
  if (!append) { state.policyCursor = null; $('more-policies').classList.add('hidden'); $('wallet-summary').textContent = `Loading balances for ${shortAddress(account)}…`; empty('policy-list', 'Loading policy records', `Reading policies for ${shortAddress(account)}.`); }
  if (!state.status?.deployed) { $('wallet-summary').textContent = `${shortAddress(account)} connected · No deployed policy or capital contracts.`; empty('policy-list', 'No deployed policy contracts', 'Wallet connection does not create coverage.'); return; }
  if(!isHostedDemo(state.status)) void loadWallet();
  else $('wallet-summary').textContent='Demonstration farmer · two hectares · valueless test tokens';
  try {
    const data = await api(`/api/policies/${account}?after=${append ? state.policyCursor ?? 0 : 0}`);
    if (!current()) return;
    if (!append) $('policy-list').replaceChildren();
    if (!data.items.length && !append) {
      if(isHostedDemo(state.status))empty('policy-list','No demonstration policy recorded yet','Follow Guided demo to purchase two hectares of cover, then refresh this view to inspect its record.');
      else empty('policy-list', data.status === 'index_not_initialized' ? 'Policy index not initialized' : 'No policies found in the indexed range', data.status === 'index_not_initialized' ? 'Run the included event indexer. This is not evidence that the wallet has no on-chain policies.' : `Indexed through finalized block ${data.indexedThroughBlock}. Refresh after the purchase is indexed.`);
    }
    for (const p of data.items) {
      const card = node('article', 'product-card');
      card.append(row('Exact premium paid', `${exactMoney(p.premium)} ${state.status.network?.tokenSymbol ?? 'USDC'}`));
      const symbol=state.status.network?.tokenSymbol ?? 'USDC';
      card.append(node('span', 'badge neutral', policyLabels[Number(p.state)] ?? 'Unknown state'), node('h3', '', `Policy #${p.id}`), row('Product', `#${p.productId}`), row('Coverage units', p.units), row('Premium paid', `${money(p.premium)} ${symbol}`), row('Maximum payout', `${money(p.maximum)} ${symbol}`), row('Claim entitlement', `${money(p.claim)} ${symbol}`));
      if (!isHostedDemo(state.status) && ['1','2'].includes(p.state)) { const b = node('button', 'button outline', p.state === '1' ? 'Review settlement' : 'Pay approved claim'); b.onclick = () => void transact(p.state === '1' ? 'settle' : 'pay', { policyId: p.id }); card.append(b); }
      const b = node('button', 'button outline', 'Inspect oracle evidence'); b.onclick = () => { go('weather'); $('observation-key').value = p.observationKey; void loadObservation(p.observationKey); }; card.append(b); $('policy-list').append(card);
    }
    state.policyCursor = data.nextAfter; $('more-policies').classList.toggle('hidden', data.nextAfter === null);
  } catch (e) { if (current()) empty('policy-list', 'Policy records unavailable', e.message); }
}
$('finalize-funding').onclick = () => void transact('finalizeFunding', {});
$('connect-wallet').onclick = async () => {
  if ($('connect-wallet').disabled || !state.status || isHostedDemo(state.status) || state.status.mode === 'research_preview') return;
  $('connect-wallet').disabled = true;
  try { const account = await wallet.connect((a) => { $('connect-wallet').textContent = a ? shortAddress(a) : 'Connect wallet'; void loadPolicies(); }); $('connect-wallet').textContent = shortAddress(account); void loadPolicies(); }
  catch (e) { message(e.message, true); }
  finally { $('connect-wallet').disabled = false; }
};
async function purchaseDialog(p) {
  const request = ++state.termsRequest;
  state.selectedProduct = p; state.termsValid = false;
  $('purchase-title').textContent = `Product #${p.id}`;
  $('purchase-details').replaceChildren(row('Premium per unit', `${money(p.premiumPerUnit)} USDC`), row('Maximum payout per unit', `${money(p.maxPayoutPerUnit)} USDC`), row('Terms hash', p.termsHash));
  $('terms-document').textContent = 'Loading and verifying the published terms…'; $('terms-consent').checked = false; $('terms-consent').disabled = true;
  $('approve-premium').disabled = true; $('buy-policy').disabled = true; $('purchase-dialog').showModal();
  const current = () => request === state.termsRequest && $('purchase-dialog').open;
  try { const terms = await api(`/api/terms/${p.termsHash.slice(2)}`); if (!current()) return; $('terms-document').textContent = terms.text; state.termsValid = true; $('terms-consent').disabled = false; }
  catch (e) { if (current()) $('terms-document').textContent = `Purchase blocked: ${e.message}`; }
}
$('purchase-dialog').onclose = () => { if ($('purchase-dialog').open) return; ++state.termsRequest; state.termsValid = false; $('terms-consent').checked = false; $('terms-consent').disabled = true; $('approve-premium').disabled = true; $('buy-policy').disabled = true; };
$('terms-consent').onchange = () => { const enabled = state.termsValid && $('terms-consent').checked; $('approve-premium').disabled = !enabled; $('buy-policy').disabled = !enabled; };
function purchaseParams() {
  if (!state.termsValid || !$('terms-consent').checked) throw new Error('Read and accept the verified policy terms first.');
  const units = $('purchase-units').value;
  if (!/^[1-9]\d*$/.test(units)) throw new Error('Coverage units must be a positive integer.');
  const p = state.selectedProduct;
  return { productId: p.id, units, maxPremium: (BigInt(p.premiumPerUnit)*BigInt(units)).toString(), acceptedTermsHash: p.termsHash };
}
$('approve-premium').onclick = () => { try { const p = purchaseParams(); $('purchase-dialog').close(); void transact('approve-premium', p); } catch(e) { message(e.message,true); } };
$('buy-policy').onclick = () => { try { const p = purchaseParams(); $('purchase-dialog').close(); void transact('purchase', p); } catch(e) { message(e.message,true); } };

function confirmTransaction(prepared) {
  return new Promise(resolve => {
    const d = $('transaction-dialog'); $('tx-network-label').textContent = state.status.network?.demoOnly ? 'LOCAL TEST TRANSACTION' : 'REAL-MONEY TRANSACTION'; $('tx-consent-text').textContent = state.status.network?.demoOnly ? 'I understand this sends a transaction on the local demonstration chain using valueless test tokens.' : 'I understand this uses Celo mainnet and may transfer real USDC or incur gas fees.'; $('tx-description').textContent = prepared.description; $('tx-details').replaceChildren();
    for (const [key,value] of Object.entries({ 'Network': `${state.status.network?.chainName ?? 'Celo'} · ${state.status.chainId}`, 'From': prepared.transaction.from, 'To': prepared.transaction.to, 'Function selector': prepared.transaction.data.slice(0,10), 'Estimated gas limit': BigInt(prepared.transaction.gas).toString(), 'Simulated at block': prepared.simulatedAtBlock })) $('tx-details').append(node('dt','',key),node('dd','',String(value)));
    $('tx-consent').checked = false; $('tx-confirm').disabled = true; $('tx-consent').onchange = () => $('tx-confirm').disabled = !$('tx-consent').checked;
    let done=false;
    $('tx-confirm').onclick = () => { done=true; d.close(); resolve(true); };
    d.onclose = () => { if (!done) resolve(false); }; d.showModal();
  });
}
async function transact(action, params) {
  if (isHostedDemo(state.status)) return message('Use the numbered steps in Guided demo.', true);
  if (state.txBusy) return message('Wait for the current transaction review to finish.');
  if (state.status?.mode === 'research_preview') return message('Transactions are disabled in the research preview.', true);
  if (!wallet.currentAccount()) return message('Connect your wallet first.', true);
  if (!state.status?.deployed) return message('No contracts are deployed. Real-money transactions are disabled.', true);
  state.txBusy = true;
  try {
    message('Checking current contract state and simulating the transaction…');
    const prepared = await api('/api/transactions/prepare', { action, params, account: wallet.currentAccount() });
    if (!await confirmTransaction(prepared)) return;
    const allowed = [state.status.usdc, ...Object.values(state.status.manifest.contracts)];
    const hash = await wallet.sendPrepared(prepared, allowed);
    message(`Submitted ${hash}. Waiting for a receipt; this is not yet a successful transaction.`);
    let result;
    for (let i=0;i<80;i++) {
      await new Promise(r=>setTimeout(r,3000));
      result = await api(`/api/transactions/${hash}`);
      if (['succeeded','reverted','reorganized'].includes(result.status)) break;
    }
    if (result?.status === 'succeeded') { message(`Transaction succeeded${result.finalized ? ' and is finalized' : '; chain finality is still pending'}. ${hash}`); void loadPool(); void loadPolicies(); void loadProducts(); }
    else if (result?.status === 'reverted') throw new Error(`Transaction reverted. No purchase/payment success was recorded. ${hash}`);
    else if (result?.status === 'reorganized') throw new Error(`Transaction was reorganized. Recheck the explorer before submitting again. ${hash}`);
    else message(`Still pending. Do not submit a duplicate blindly. Track ${hash}.`);
  } catch (e) { message(e.message ?? 'Transaction failed.', true); }
  finally { state.txBusy=false; }
}
$('approve-deposit').onclick = () => { try { void transact('approve-deposit',{amount:parseUnits($('deposit-amount').value).toString()}); } catch(e){message(e.message,true);} };
$('deposit-form').onsubmit = e => { e.preventDefault(); try { void transact('deposit',{amount:parseUnits($('deposit-amount').value).toString()}); } catch(e){message(e.message,true);} };
$('redeem-form').onsubmit = e => { e.preventDefault(); try { void transact('redeem',{amount:parseUnits($('redeem-shares').value).toString()}); } catch(e){message(e.message,true);} };
async function loadObservation(key) {
  try {
    const data = await api(`/api/observation/${key}`), o=data.result;
    const box=node('div',''); box.append(row('State',observationLabels[Number(o.state)]),row('Decision',o.decision==='2'?'Contractual full-payout default (not a rainfall measurement)':o.decision==='1'?'Measured index':'No decision'));
    if(o.decision==='1')box.append(row('Precipitation',`${formatUnits(o.rainfallMmX1000,3,3)} mm`));
    box.append(row('Evidence hash',o.evidenceHash));
    if(o.evidenceHash && !/^0x0+$/.test(o.evidenceHash)){
      const evidence=node('a','small','Open archived evidence (availability is checked by the API)');
      evidence.href=`/api/evidence/${o.evidenceHash.slice(2)}?source_hash=${o.sourceHash}`;
      evidence.target='_blank';evidence.rel='noopener noreferrer';box.append(evidence);
    }
    const now=Number(data.chainTimestamp ?? Date.now()/1000);
    if(!isHostedDemo(state.status) && o.state==='1'){const b=node('button','button outline','Finalize after challenge window');b.disabled=now<Number(o.challengeEndsAt);b.onclick=()=>void transact('finalize',{observationKey:key});box.append(b);}
    if(!isHostedDemo(state.status) && o.state!=='3' && now>Number(data.specification.resolutionDeadline)){const b=node('button','button outline','Apply agreed failure procedure');b.onclick=()=>void transact('finalizeFailure',{observationKey:key});box.append(b);}
    if(!isHostedDemo(state.status) && o.state==='0' && now>Number(data.specification.reportDeadline)){const label=node('label','','Missing-report escalation evidence SHA-256');const input=node('input');input.placeholder='0x…';const b=node('button','button outline','Escalate missing report to resolver');b.onclick=()=>void transact('escalateMissing',{observationKey:key,evidenceHash:input.value});box.append(label,input,b);}
    if(!isHostedDemo(state.status) && o.state==='1'){const label=node('label','','Challenge evidence SHA-256');const input=node('input');input.placeholder='0x…';const b=node('button','button outline','Challenge proposed observation');b.onclick=()=>void transact('challenge',{observationKey:key,evidenceHash:input.value});box.append(label,input,b);}
    $('observation-result').replaceChildren(box);
  }catch(e){$('observation-result').textContent=e.message;}
}
$('observation-form').onsubmit=e=>{e.preventDefault();void loadObservation($('observation-key').value);};
async function readiness(){
  if(isHostedDemo(state.status))return;
  try{const data=await api('/api/readiness');$('readiness-list').replaceChildren();if(!data.failures.length)$('readiness-list').append(node('div','check-item text-success','Technical checks passed. External approvals still require verification.'));for(const f of data.failures)$('readiness-list').append(node('div','check-item','○ '+f));}
  catch(e){$('readiness-list').textContent=e.message;}
}
function manifest(){const target=$('contract-manifest');target.replaceChildren();const entries=Object.entries(state.status.manifest.contracts);if(!entries.length){target.append(node('p','','No deployment addresses have been supplied. No contracts are represented as live.'));return;}for(const[name,value]of entries){const r=node('div','contract-row');const a=node('a','hash',value);if(state.status.network?.explorerUrl)a.href=`${state.status.network.explorerUrl}/address/${value}`;a.target='_blank';a.rel='noopener noreferrer';r.append(node('strong','',name),a);target.append(r);}}
$('refresh-products').onclick=()=>void loadProducts();$('more-products').onclick=()=>void loadProducts(true);$('refresh-policies').onclick=()=>void loadPolicies();$('more-policies').onclick=()=>void loadPolicies(true);$('refresh-readiness').onclick=()=>void readiness();

function configureHostedLayout() {
  document.querySelector('.sidebar-footer strong').textContent='ERA5-Land demonstration';
  document.querySelector('.sidebar-footer p').textContent='Real rainfall history. Recorded replay. Valueless test payments.';
  document.querySelector('[data-page="operations"] span').textContent='Guided demo';
  document.querySelector('[data-page="policies"] span').textContent='Demo policy';
  for(const page of ['participation','research'])document.querySelector(`[data-page="${page}"]`).hidden=true;
  for(const id of ['connect-wallet','demo-wallet-bar','deposit-form','redeem-form','finalize-funding','approve-deposit'])$(id).hidden=true;
  document.querySelectorAll('#page-operations > :not(#demo-workspace)').forEach(element=>element.hidden=true);
  document.querySelectorAll('#page-capital input,#page-capital button:not(#refresh-policies)').forEach(element=>element.disabled=true);
  document.querySelector('#page-capital .two-col').hidden=true;
  document.querySelector('#page-capital [data-metric="actualTokenBalance"]').previousElementSibling.textContent='Demonstration token balance';
  document.querySelectorAll('.deployment-heading h2').forEach(element=>element.textContent='Demonstration coverage & capital');
  document.querySelectorAll('[data-navigate="operations"]').forEach(element=>element.textContent='Open guided demo ↗');
  document.querySelectorAll('[data-metric]').forEach(element=>{const note=element.nextElementSibling;if(note)note.textContent=element.dataset.metric==='activePolicies'?'Replayed demonstration policies':'Valueless demonstration tokens';});
  go(location.hash.slice(1)||'overview');
}

const initialPage = location.hash.slice(1);
if (['overview','pricing','policies','capital','weather','participation','research','operations'].includes(initialPage)) go(initialPage);

try { state.status=await api('/api/status');
  if(isHostedDemo(state.status)) await initializeHostedDemo();
  if(state.status.network && !isHostedDemo(state.status)) wallet.configureNetwork(state.status.network, state.status.manifest.demoAccounts ?? []);
  window.cropguardStatus = state.status;
  window.dispatchEvent(new CustomEvent('cropguard:status', {detail:state.status}));
  if(state.status.network?.demoOnly && !isHostedDemo(state.status)) {
    $('demo-wallet-bar').classList.remove('hidden');
    const accounts=state.status.manifest.demoAccounts??[];
    $('demo-account').replaceChildren(...accounts.map(a=>new Option(`${a.label ?? a.role} · ${shortAddress(a.address)}`,a.address)));
    $('demo-account').onchange=()=>{wallet.selectLocalAccount($('demo-account').value);$('connect-wallet').textContent=shortAddress(wallet.currentAccount());void loadPolicies();};
    document.querySelector('.sidebar-footer strong').textContent=state.status.manifest.era5Replay?'Historical ERA5 replay':'Local demonstration';
    document.querySelector('.sidebar-footer p').textContent=state.status.manifest.era5Replay?'Actual ERA5-Land rainfall. Local contracts and test funds.':'Actual contracts. Test funds. Synthetic weather.';
  }
  $('connect-wallet').disabled = state.status.mode === 'research_preview' || isHostedDemo(state.status);
  if(isHostedDemo(state.status)) configureHostedLayout();
  if (state.status.mode === 'research_preview') {
    document.documentElement.dataset.cropguardMode = 'research_preview';
    document.querySelector('#sim-source option[value="ethiopia_archive"]')?.remove();
    $('connect-wallet').disabled = true;
    $('connect-wallet').textContent = 'Wallet disabled in preview';
    for (const selector of ['#deposit-form button', '#redeem-form button', '#approve-deposit', '#finalize-funding', '#observation-form button']) {
      document.querySelectorAll(selector).forEach(button => { button.disabled = true; button.title = 'Unavailable in the restricted research preview'; });
    }
    window.dispatchEvent(new CustomEvent('cropguard:mode', {detail: state.status}));
  }
  $('global-status').textContent=(isHostedDemo(state.status) || state.status.mode === 'research_preview' || state.status.network?.demoOnly) ? state.status.notice : state.status.deployed?'Mainnet configuration loaded. Policy sales, funding and claim states are read from the contracts. Review every wallet transaction.':'Research workspace · Pricing lab available. No insurance contracts are deployed; live sales and real-money actions are disabled.'; manifest(); await loadProducts(); void loadPool(); void loadNetwork(); void readiness(); }
catch(e){$('global-status').textContent=e.message;$('global-status').classList.add('error');}

window.addEventListener('cropguard:refresh',()=>{void loadProducts();void loadPool();void loadPolicies();void loadNetwork();void readiness();});
window.addEventListener('cropguard:walletchange',event=>{$('connect-wallet').textContent=event.detail.account?shortAddress(event.detail.account):'Connect wallet';void loadPolicies();});
