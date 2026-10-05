/* CropGuard pricing model in the browser.
 *
 * Loads Pyodide (CPython compiled to WebAssembly, served from this site) and the
 * project's own Python model files, then answers simulation requests. Runs in a
 * Web Worker so the page stays responsive. Nothing is sent to any server.
 */
const root = new URL('../', self.location.href);
importScripts(new URL('pyodide/pyodide.js', root).href);

const MODEL_FILES = ['adapter.py', 'services/__init__.py', 'services/simulation.py', 'services/gamma_model.py',
  'services/actuarial.py', 'services/pricing.py', 'services/weather.py'];
let booting;

async function text(path) {
  const response = await fetch(new URL(path, root));
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  return response.text();
}

async function boot() {
  const pyodide = await loadPyodide({indexURL: new URL('pyodide/', root).href});
  const [inputs, ...sources] = await Promise.all([text('data/model-inputs.json'), ...MODEL_FILES.map(name => text('model/' + name))]);
  pyodide.FS.mkdirTree('/model/services');
  MODEL_FILES.forEach((name, index) => pyodide.FS.writeFile('/model/' + name, sources[index]));
  pyodide.FS.writeFile('/model/model-inputs.json', inputs);
  pyodide.runPython("import sys\nsys.path.insert(0, '/model')\nimport adapter\nadapter.load('/model/model-inputs.json')");
  return pyodide.pyimport('adapter');
}

self.onmessage = async event => {
  const {id, kind, body} = event.data;
  let adapter;
  try {
    booting ||= boot();
    adapter = await booting;
  } catch (error) {
    booting = undefined; // Allow another attempt after a failed download.
    postMessage({id, ok: false, error: `The pricing model could not be loaded. ${String(error?.message ?? error)}`});
    return;
  }
  try {
    if (kind === 'warm') postMessage({id, ok: true, python: adapter.python_version()});
    else postMessage({id, ok: true, envelope: adapter.handle(kind, body)});
  } catch (error) {
    postMessage({id, ok: false, error: String(error?.message ?? error)});
  }
};
