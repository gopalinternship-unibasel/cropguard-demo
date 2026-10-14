// Celo Sepolia test round: read the public test chain directly and compare it with the
// frozen evidence file on this site. Read-only; no wallet, no transaction, no key.
const page = document.getElementById('page-operations');
const anchor = document.getElementById('demo-workspace');
if (page && anchor) start().catch(() => {});

async function start() {
  const response = await fetch('data/onchain-round.json');
  if (!response.ok) return;
  const round = await response.json();
  const section = document.createElement('section');
  section.id = 'onchain-round';
  section.setAttribute('aria-labelledby', 'onchain-title');
  section.innerHTML = `
<div class="section-heading"><div><span class="eyebrow muted">PUBLIC TEST NETWORK · CHAINLINK CRE SIMULATION</span>
<h2 id="onchain-title">The same policy on Celo Sepolia</h2></div><span class="badge neutral">Not a Chainlink network run</span></div>
<div class="notice" id="onchain-notice"></div>
<div class="metrics" id="onchain-metrics"></div>
<p class="onchain-status" id="onchain-status" role="status">Reading the test network…</p>
<div class="two-col">
<article class="panel"><h3>Checked against this site</h3><ul class="onchain-checks" id="onchain-checks"></ul>
<button class="button outline" id="onchain-refresh" type="button">Read the chain again ↻</button></article>
<article class="panel"><h3>Transactions</h3><ol class="onchain-list" id="onchain-transactions"></ol></article>
</div>
<article class="panel"><h3>Contracts</h3><div class="onchain-contracts" id="onchain-contracts"></div>
<p class="onchain-note">${text(round.contractNote)}</p>${earlier(round)}</article>`;
  anchor.insertAdjacentElement('afterend', section);
  section.querySelector('#onchain-notice').textContent = round.notice;
  section.querySelector('#onchain-transactions').innerHTML = round.transactions.map(t =>
    `<li><span>${text(t.label)}</span>${link(`${round.explorerUrl}/tx/${t.hash}`, short(t.hash))}</li>`).join('');
  section.querySelector('#onchain-contracts').innerHTML = Object.entries(round.contracts).map(([name, address]) =>
    `<div><span>${text(name)}</span>${link(`${round.explorerUrl}/address/${address}`, address)}</div>`).join('');
  const refresh = section.querySelector('#onchain-refresh');
  const load = async () => {
    refresh.disabled = true;
    try { render(section, round, await read(round), null); }
    catch (error) { render(section, round, null, error); }
    finally { refresh.disabled = false; }
  };
  refresh.addEventListener('click', load);
  await load();
}

function earlier(round) {
  const e = round.previousRound;
  if (!e) return '';
  return `<p class="onchain-note">An earlier round on ${text(e.completedOn)} used the Adama grid-point series, which the site used before the team's series: `
    + `${text(millimetres(BigInt(e.rainfallMmX1000)))} mm against a ${text(millimetres(BigInt(e.thresholdMmX1000)))} mm trigger. It stays on the test network as it was recorded: `
    + `${link(`${round.explorerUrl}/address/${e.oracleAdapter}`, 'its OracleAdapter')}, ${link(`${round.explorerUrl}/tx/${e.reportTransaction}`, 'its rainfall report')} `
    + `and ${link(e.evidencePath, 'its evidence file')}.</p>`;
}

function text(value) { const node = document.createElement('span'); node.textContent = String(value ?? ''); return node.innerHTML; }
function link(href, label) { return `<a href="${text(href)}" rel="noopener noreferrer" target="_blank">${text(label)}</a>`; }
function short(hash) { return `${hash.slice(0, 10)}…${hash.slice(-8)}`; }
function units(value, decimals, shown) {
  const base = 10n ** BigInt(decimals), whole = value / base, rest = (value % base).toString().padStart(decimals, '0');
  const fraction = rest.slice(0, Math.max(shown, rest.replace(/0+$/, '').length));
  return `${whole.toLocaleString('en-US')}${fraction ? '.' + fraction : ''}`;
}
const tokens = value => units(value, 6, 2);
const millimetres = value => units(value, 3, 3);

async function call(round, to, data) {
  const response = await fetch(round.rpcUrl, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{to, data}, 'latest']})});
  const body = await response.json();
  if (!response.ok || body.error || typeof body.result !== 'string') throw new Error(body.error?.message || `HTTP ${response.status}`);
  return body.result;
}
const words = hex => (hex.slice(2).match(/.{64}/g) || []).map(word => BigInt('0x' + word));
const word32 = value => '0x' + value.toString(16).padStart(64, '0');

async function read(round) {
  const c = round.contracts, r = round.reads;
  const block = fetch(round.rpcUrl, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_getBlockByNumber', params: ['latest', false]})}).then(x => x.json());
  const [observation, policy, capital, fees, locked, healthy, head, evidence] = await Promise.all([
    call(round, c.OracleAdapter, r.getObservation), call(round, c.PolicyManager, r.getPolicy),
    call(round, c.RiskPoolVault, r.capitalAssets), call(round, c.RiskPoolVault, r.accruedFees),
    call(round, c.RiskPoolVault, r.lockedCollateral), call(round, c.RiskPoolVault, r.accountingHealthy), block,
    fetch(round.evidence.path).then(x => x.ok ? x.json() : Promise.reject(new Error('Evidence file missing')))]);
  const o = words(observation), p = words(policy);
  if (o.length !== 9 || p.length !== 8 || !head.result) throw new Error('Unexpected response from the test network');
  // Replay the evidence file's own arithmetic. Monthly values (the team series) are in
  // thousandths of a millimetre; daily values are in millionths, summed per month and
  // rounded half up to thousandths.
  let replayed = 0n;
  if (Array.isArray(evidence.monthly)) {
    for (const month of evidence.monthly) replayed += BigInt(month.rainfallMm.replace('.', ''));
  } else {
    const months = new Map();
    for (const day of evidence.daily) {
      const month = day.date.slice(0, 7);
      months.set(month, (months.get(month) || 0n) + BigInt(day.rainfallMm.replace('.', '')));
    }
    for (const sum of months.values()) replayed += (sum + 500n) / 1000n;
  }
  const rows = Array.isArray(evidence.monthly) ? evidence.monthly : evidence.daily;
  return {rainfall: o[0], proposedAt: o[1], challengeEndsAt: o[2], observedAt: o[3], evidenceHash: word32(o[4]), sourceHash: word32(o[5]),
    state: Number(o[7]), decision: Number(o[8]), units: p[2], premium: p[3], maximum: p[4], claim: p[6], policyState: Number(p[7]),
    capital: words(capital)[0], fees: words(fees)[0], locked: words(locked)[0], healthy: words(healthy)[0] === 1n,
    block: Number(BigInt(head.result.number)), time: Number(BigInt(head.result.timestamp)), evidence, replayed,
    rows: rows.length, rowKind: Array.isArray(evidence.monthly) ? 'monthly' : 'daily'};
}

function render(section, round, live, error) {
  const e = round.expected;
  const v = live || {rainfall: BigInt(e.rainfallMmX1000), state: e.observationState, decision: e.decision, claim: BigInt(e.payout),
    premium: BigInt(e.premiumPaid), units: BigInt(e.units), policyState: e.policyState, capital: BigInt(e.poolCapitalAfter)};
  const states = ['No report', 'Proposed · challenge period', 'Disputed', 'Final'];
  const decisions = ['', 'measured rainfall', 'full-payout default'];
  const policies = ['None', 'Active', 'Claim approved', 'Paid', 'Closed without payout'];
  const metric = (label, value, note) => `<article class="metric"><span>${text(label)}</span><strong>${text(value)}</strong><small>${text(note)}</small></article>`;
  section.querySelector('#onchain-metrics').innerHTML =
    metric('Rainfall reported on-chain', millimetres(v.rainfall), `millimetres · trigger: below ${millimetres(BigInt(round.thresholdMmX1000))} mm`) +
    metric('Oracle state', states[v.state] || '—', decisions[v.decision] ? `Decision: ${decisions[v.decision]}` : 'No decision yet') +
    metric('Policy payout', tokens(v.claim), `${round.tokenSymbol} test tokens · ${v.units} units · premium ${tokens(v.premium)} · ${policies[v.policyState] || '—'}`) +
    metric('Pool capital now', tokens(v.capital), `${round.tokenSymbol} test tokens · after premium, fee and payout`);
  const status = section.querySelector('#onchain-status');
  status.classList.toggle('error', !live);
  status.textContent = live
    ? `Read from Celo Sepolia just now, at block ${live.block.toLocaleString('en-US')} (${new Date(live.time * 1000).toISOString().slice(0, 19).replace('T', ' ')} UTC).`
    : `The test network could not be reached (${error?.message || 'no response'}). The figures above are the ones recorded on ${round.completedOn}; the links below still open the transactions.`;
  const item = (ok, label) => `<li class="${ok === null ? 'unknown' : ok ? 'ok' : 'bad'}"><span>${ok === null ? '·' : ok ? '✓' : '✗'}</span><div>${label}</div></li>`;
  const evidenceLink = link(round.evidence.path, 'frozen evidence file');
  section.querySelector('#onchain-checks').innerHTML = live && live.state === 0
    ? item(null, `No rainfall report is on-chain for this round. The ${evidenceLink} is available.`) : live ? [
    item(live.replayed === live.rainfall, `The ${live.rows} ${live.rowKind} values in the ${evidenceLink} add up to ${text(millimetres(live.replayed))} mm, the amount on-chain.`),
    item(live.evidence.evidenceHash === live.evidenceHash, `The evidence hash on-chain is the one in that file (${text(short(live.evidenceHash))}).`),
    item(live.evidence.sourceHash === live.sourceHash, `The source hash on-chain is the one in that file (${text(short(live.sourceHash))}); the guided demo above shows the same hash.`),
    item(live.rainfall < BigInt(round.thresholdMmX1000) === (live.claim > 0n), `${text(millimetres(live.rainfall))} mm is below the ${text(millimetres(BigInt(round.thresholdMmX1000)))} mm trigger, and the policy was paid its full ${text(tokens(live.claim))} ${text(round.tokenSymbol)}.`),
    item(live.healthy && live.locked === 0n, 'The pool passes its accounting check and no collateral is still locked.'),
  ].join('') : item(null, `Not checked: the test network did not answer. The ${evidenceLink} is still available.`);
}
