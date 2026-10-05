/* CropGuard browser-only edition: answers the page's /api/ requests without a server.
 *
 *  - Read requests return the responses recorded from one real hosted-mode run on a
 *    private test chain, for the step this browser tab has replayed so far.
 *  - Guided-demo actions advance that replay by one recorded step. Nothing is executed.
 *  - Pricing requests run the project's Python model in a Web Worker (see sim-worker.js).
 *
 * Loaded as a classic script before the application modules.
 */
(() => {
  'use strict';
  const root = new URL('../', document.currentScript.src);
  const nativeFetch = window.fetch.bind(window);
  const STEP_KEY = 'cropguard-static:step';
  const NOT_PART = 'This endpoint is not part of the browser-only edition.';
  const replay = nativeFetch(new URL('data/replay.json', root)).then(response => {
    if (!response.ok) throw new Error(`Recorded demonstration data could not be loaded (HTTP ${response.status}).`);
    return response.json();
  });
  let loaded, memoryStep = 0;
  replay.then(value => { loaded = value; }, () => {});

  function step(data) {
    let value = memoryStep;
    try { value = Number(sessionStorage.getItem(`${STEP_KEY}:${data.runId}`) ?? memoryStep); } catch { /* Storage may be disabled. */ }
    return Number.isInteger(value) && value >= 0 && value <= data.actions.length ? value : 0;
  }
  function setStep(data, value) {
    memoryStep = value;
    try { sessionStorage.setItem(`${STEP_KEY}:${data.runId}`, String(value)); } catch { /* Keep the step in memory. */ }
  }
  const json = (value, status = 200, headers = {}) => new Response(typeof value === 'string' ? value : JSON.stringify(value),
    {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers}});
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

  function recorded(data, key, at) {
    const versions = data.responses[key];
    if (!versions) return null;
    let found = null;
    for (const [index, entry] of versions) if (index <= at) found = entry;
    return found;
  }
  function lookup(data, url, at) {
    return recorded(data, url.pathname + url.search, at) ?? recorded(data, url.pathname, at);
  }
  function session(data) {
    return {hostedDemo: true, staticReplay: true, role: 'controller', runId: data.runId, notice: data.sessionNotice, canStartNewRun: true};
  }

  // ---- Pricing model worker -------------------------------------------------
  let worker, nextId = 0, warmed;
  const waiting = new Map();
  const announce = (state, detail = {}) => window.dispatchEvent(new CustomEvent('cropguard:static-model', {detail: {state, ...detail}}));
  function ask(kind, body) {
    if (!worker) {
      worker = new Worker(new URL('static-site/sim-worker.js', root));
      worker.onmessage = event => { const entry = waiting.get(event.data.id); waiting.delete(event.data.id); entry?.(event.data); };
      worker.onerror = event => { for (const entry of waiting.values()) entry({ok: false, error: event.message || 'The pricing model stopped unexpectedly.'}); waiting.clear(); worker = undefined; warmed = undefined; };
    }
    return new Promise(resolve => { const id = ++nextId; waiting.set(id, resolve); worker.postMessage({id, kind, body}); });
  }
  function warmModel() {
    if (!warmed) {
      announce('loading');
      warmed = ask('warm').then(result => {
        if (!result.ok) { warmed = undefined; announce('error', {message: result.error}); throw new Error(result.error); }
        announce('ready', {python: result.python});
        return result;
      });
      warmed.catch(() => {});
    }
    return warmed;
  }
  async function simulate(kind, bodyText) {
    try { JSON.parse(bodyText); } catch { return json({detail: 'The request fields are invalid.'}, 422); }
    try { await warmModel(); } catch (error) { return json({detail: error.message}, 503); }
    const result = await ask(kind, bodyText);
    if (!result.ok) return json({detail: `The in-browser pricing model failed. ${result.error}`}, 500);
    const envelope = JSON.parse(result.envelope);
    if (kind === 'export' && envelope.status === 200) {
      return new Response(envelope.body, {status: 200, headers: {'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="cropguard-simulation-draws.csv"', 'X-Analysis-Hash': envelope.hash}});
    }
    return json(envelope.body, envelope.status);
  }

  // ---- Request routing -------------------------------------------------------
  async function read(data, url) {
    const at = step(data);
    if (url.pathname === '/api/hosted-demo/session') return json(session(data));
    const entry = lookup(data, url, at);
    if (!entry) return json({detail: NOT_PART}, 404);
    if (entry.file) {
      const response = await nativeFetch(new URL(entry.file, root));
      if (!response.ok) return json({detail: 'A recorded file is missing from this site.'}, 502);
      const headers = {'Content-Type': entry.contentType, 'Cache-Control': 'no-store'};
      if (entry.contentDisposition) headers['Content-Disposition'] = entry.contentDisposition;
      return new Response(await response.blob(), {status: entry.status, headers});
    }
    let value = entry.json;
    if (url.pathname === '/api/status' || url.pathname === '/api/demo/status') {
      value = {...value, notice: data.notice, staticReplay: true, runId: data.runId};
    }
    return json(value, entry.status);
  }

  async function action(data, bodyText, headers) {
    let body;
    try { body = JSON.parse(bodyText); } catch { return json({detail: 'The request fields are invalid.'}, 422); }
    if (headers.get('x-cropguard-run') !== data.runId) return json({detail: 'The demonstration run changed. Refresh before taking another action.'}, 409);
    const at = step(data), params = body.params ?? {};
    const matches = entry => entry && entry.action === body.action && same(entry.params, params);
    await sleep(450);
    if (matches(data.actions[at])) {
      setStep(data, at + 1);
      return json({...data.actions[at].result, runId: data.runId, recordedReplay: true});
    }
    const earlier = data.actions.slice(0, at).findLast(matches);
    if (earlier) return json({...earlier.result, runId: data.runId, recordedReplay: true, idempotentReplay: true});
    const position = data.actions.findIndex(matches);
    return json({detail: {outcome: 'not_replayed', message: position < 0
      ? 'This action is not part of the recorded demonstration.'
      : `The recording holds the nine steps in order. Replay step ${at + 1} before step ${position + 1}.`}}, 409);
  }

  async function write(data, url, bodyText, headers) {
    switch (url.pathname) {
      case '/api/simulation/run': return simulate('run', bodyText);
      case '/api/simulation/export': return simulate('export', bodyText);
      case '/api/demo/actions': return action(data, bodyText, headers);
      case '/api/hosted-demo/new-run': setStep(data, 0); return json({runId: data.runId, reconciled: true, notice: data.sessionNotice, recordedReplay: true});
      case '/api/hosted-demo/login':
      case '/api/hosted-demo/logout': return json(session(data));
      default: return json({detail: NOT_PART}, 404);
    }
  }

  window.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), document.baseURI);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase();
    try {
      const data = await replay;
      if (method === 'GET' || method === 'HEAD') return await read(data, url);
      if (method !== 'POST') return json({detail: 'This method is not available.'}, 405);
      const bodyText = typeof init.body === 'string' ? init.body : request ? await request.clone().text() : '';
      return await write(data, url, bodyText, new Headers(init.headers ?? request?.headers ?? {}));
    } catch (error) {
      return json({detail: error.message || 'The browser-only edition could not answer this request.'}, 503);
    }
  };

  // Links the page builds as /api/... (evidence, source manifest) open the recorded file instead.
  function redirectLink(event) {
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!link || !loaded) return;
    const url = new URL(link.getAttribute('href'), document.baseURI);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
    const entry = lookup(loaded, url, step(loaded));
    if (entry?.file) link.href = new URL(entry.file, root).href;
    else if (!link.onclick) event.preventDefault();
  }
  document.addEventListener('click', redirectLink, true);
  document.addEventListener('auxclick', redirectLink, true);

  window.cropguardStatic = {warmModel, replay, currentStep: () => loaded ? step(loaded) : 0};
})();
