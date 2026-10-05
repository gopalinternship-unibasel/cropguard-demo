import { createIntentStore } from './demo-intents.js';

const $ = id => document.getElementById(id);
export let hostedSession = null;
let intents, authBusy = false;
export function isHostedDemo(status = window.cropguardStatus) { return status?.mode === 'hosted_demo' || status?.hostedDemo === true; }
function publish(session) {
  hostedSession = session;
  window.cropguardHostedSession = session;
  window.dispatchEvent(new CustomEvent('cropguard:hosted-session', {detail: session}));
  renderSession();
}
async function request(path, body, extraHeaders = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(path, {credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
      ...(body === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json', ...extraHeaders}, body: JSON.stringify(body)})});
    let value;
    try { value = await response.json(); } catch { throw new Error('The server response could not be read. Refresh the demonstration state before retrying.'); }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) publish({...hostedSession, role: 'viewer'});
      const detail = typeof value.detail === 'string' ? value.detail : typeof value.detail?.message === 'string' ? value.detail.message : 'The demonstration action could not be completed.';
      throw new Error(detail);
    }
    return value;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The response timed out. The action may still finish. Refresh state, then retry this same action if needed; its request identifier will be reused.');
    throw error;
  } finally { clearTimeout(timer); }
}
export async function refreshHostedSession() {
  const session = await request('/api/hosted-demo/session');
  if (session.hostedDemo !== true || !['viewer', 'controller'].includes(session.role) || typeof session.runId !== 'string') throw new Error('The hosted demonstration session is unavailable. Controls remain locked.');
  if(hostedSession?.runId && session.runId !== hostedSession.runId) {
    publish({...session,role:'viewer'});
    $('hosted-access-feedback').textContent='A new shared run has started. Refreshing the page…';
    location.reload();
    throw new Error('The shared run changed. Reload the page before operating it.');
  }
  publish(session);
  return session;
}
export async function hostedAction(action, params = {}) {
  if (hostedSession?.role !== 'controller') throw new Error('Sign in as the presenter to operate the shared demonstration.');
  const runId = hostedSession.runId, key = intents.key(runId, action, params);
  const result = await request('/api/demo/actions', {action, params}, {'Idempotency-Key': key, 'X-CropGuard-Run': runId});
  intents.complete(runId, action, params);
  return result;
}
function renderSession() {
  if (!$('hosted-access')) return;
  const controller = hostedSession?.role === 'controller';
  $('hosted-role').textContent = controller ? 'Browser-only demonstration' : 'Viewing the shared demonstration';
  $('hosted-login-form').hidden = controller;
  $('hosted-logout').hidden = !controller;
  $('hosted-access-note').textContent = hostedSession?.notice || 'Everyone sees one shared run. Sign in to control the walkthrough. ERA5-Land rainfall is real historical data; payments use valueless demonstration tokens.';
  $('hosted-run-id').textContent = `Recorded run ${hostedSession?.runId || 'unavailable'}`;
  $('hosted-new-run').hidden = !controller || !hostedSession?.canStartNewRun;
  document.documentElement.dataset.demoRole = controller ? 'controller' : 'viewer';
}
async function authenticate(path, body) {
  if (authBusy) return;
  authBusy = true;
  $('hosted-access-feedback').textContent = 'Checking access…';
  $('hosted-login').disabled = $('hosted-logout').disabled = true;
  try {
    await request(path, body);
    await refreshHostedSession();
    $('hosted-access-feedback').textContent = hostedSession.role === 'controller' ? 'Signed in. Open Guided demo to present the season.' : 'Signed out. You can continue viewing this run.';
  } catch (error) { $('hosted-access-feedback').textContent = error.message; }
  finally { $('hosted-password').value = ''; authBusy = false; $('hosted-login').disabled = $('hosted-logout').disabled = false; }
}
export async function initializeHostedDemo() {
  document.documentElement.dataset.cropguardMode = 'hosted_demo';
  try { intents = createIntentStore(window.sessionStorage); } catch { intents = createIntentStore(null); }
  $('hosted-access').hidden = false;
  $('hosted-login-form').onsubmit = event => { event.preventDefault(); void authenticate('/api/hosted-demo/login', {password: $('hosted-password').value}); };
  $('hosted-logout').onclick = () => void authenticate('/api/hosted-demo/logout', {});
  $('hosted-new-run').onclick = async () => {
    if (!hostedSession?.canStartNewRun || hostedSession.role !== 'controller') return;
    if (!window.confirm('Restart the recorded replay from its first step? Only this browser tab is affected.')) return;
    const runId = hostedSession.runId, params = {confirm: 'START_NEW_RUN'};
    $('hosted-new-run').disabled = true;
    try {
      await request('/api/hosted-demo/new-run', params, {'Idempotency-Key': intents.key(runId, 'new-run', params), 'X-CropGuard-Run': runId});
      intents.complete(runId, 'new-run', params);
      location.reload();
    } catch (error) { $('hosted-access-feedback').textContent = error.message; }
    finally { $('hosted-new-run').disabled = false; }
  };
  try { await refreshHostedSession(); }
  catch (error) { publish({hostedDemo: true, role: 'viewer', runId: ''}); $('hosted-access-feedback').textContent = error.message; }
}
