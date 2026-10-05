// Browser-only edition: show the state of the in-browser pricing model and start loading it early.
// Links such as …/#pricing must also work in a tab that already has the site open.
window.addEventListener('hashchange', () => {
  const nav = document.querySelector(`.nav[data-page="${CSS.escape(location.hash.slice(1))}"]`);
  if (nav && !nav.hidden && !nav.classList.contains('active')) nav.click();
});
const control = window.cropguardStatic;
const button = document.getElementById('run-simulation');
if (control && button) {
  const note = document.createElement('p');
  note.id = 'static-model-status';
  note.className = 'small';
  note.setAttribute('role', 'status');
  note.textContent = 'The pricing model runs in your browser. The first run downloads it once (about 12 MB).';
  button.insertAdjacentElement('afterend', note);
  window.addEventListener('cropguard:static-model', event => {
    const {state, python, message} = event.detail;
    note.classList.toggle('error', state === 'error');
    note.textContent = state === 'loading' ? 'Loading the pricing model into your browser (about 12 MB, first time only)…'
      : state === 'ready' ? `Pricing model ready in your browser (Python ${python}). Results are computed on this device.`
      : `The pricing model could not be loaded. ${message ?? ''} Check your connection and run the simulation again.`;
  });
  const warm = () => void control.warmModel().catch(() => {});
  window.addEventListener('cropguard:navigate', event => { if (event.detail.page === 'pricing') warm(); });
  if (location.hash === '#pricing') warm();
  button.addEventListener('pointerenter', warm, {once: true});
}
