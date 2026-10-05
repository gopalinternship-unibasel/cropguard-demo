/** Ethiopian ERA5-Land research workspace. No wallet imports, signer or transaction calls. */
import { readEvidenceJson, evidenceJsonBlob } from './json-evidence.js';
const $ = id => document.getElementById(id);
const state = {busy: false, snapshot: null, report: null, stale: false, hosting: null, hostingPromise: null, datesEdited: false};
const mm = value => value === null || value === undefined ? '—' : new Intl.NumberFormat('en', {maximumFractionDigits:3}).format(value / 1000);
const labels = {drought_triggered:'Below the rainfall trigger', no_trigger:'No rainfall trigger', provisional_data:'Provisional · refresh later', waiting_for_complete_months:'Season not complete', incomplete_or_conflicting_data:'Incomplete or conflicting data'};
const era5Providers = new Set(['era5_land', 'era5_land_timeseries']);
const era5Parameters = new Set(['era5_land:total_precipitation', 'era5_land_timeseries:total_precipitation']);
function el(tag, className, text) { const n=document.createElement(tag); if(className)n.className=className; if(text!==undefined)n.textContent=text; return n; }
function feedback(text, error=false) { $('weather-feedback').textContent=text; $('weather-feedback').dataset.error=String(error); }
function isPreview() { return document.documentElement.dataset.cropguardMode === 'research_preview'; }
function isHostedDemo() { return document.documentElement.dataset.cropguardMode === 'hosted_demo'; }
async function hostingConfiguration() {
  if(isPreview()||isHostedDemo())return null;
  if(state.hostingPromise)return state.hostingPromise;
  state.hostingPromise=(async()=>{
    try { state.hosting=await request('/api/status'); }
    catch(error) { state.hostingPromise=null;throw error; }
    if(state.hosting.mode==='hosted_demo'||state.hosting.hostedDemo===true)return null;
    if(state.hosting.hosted!==true)return null;
    $('weather-download').textContent='Queue one-month download';
    $('weather-download-note').textContent='ERA5-Land jobs are saved on the server and resumed daily. You can also check progress below. Choose exactly one complete month. Nothing is sent on-chain.';
    $('weather-jobs').hidden=false;
    document.querySelector('.weather-intro').textContent='Official ERA5-Land precipitation for Ethiopian research locations is archived in cloud storage. This reanalysis is research evidence. An on-chain oracle is not active yet.';
    for(const option of [...$('weather-provider').options])if(option.value!=='era5_land')option.remove();
    $('weather-provider').value='era5_land';
    $('weather-source-heading').textContent='ETHIOPIA · ERA5-LAND · OFF-CHAIN RESEARCH';
    $('weather-end-help').textContent='For January only, choose February as the first excluded month.';
    $('weather-empty-note').textContent='Choose an Ethiopian research point and one complete month. Only verified source data is saved; incomplete or conflicting observations never become a drought decision.';
    if(!state.datesEdited){$('weather-start').value='2025-01';$('weather-end').value='2025-02';}
    return state.hosting;
  })();
  return state.hostingPromise;
}
function configurePreview() {
  if(isHostedDemo()) {
    $('weather-form').hidden=true;
    $('weather-history-form').hidden=true;
    $('weather-jobs').hidden=true;
    document.querySelector('.weather-intro').textContent='Inspect the verified ERA5-Land history used by this demonstration. The Adama grid point covers 1985–2025. Historical rainfall is reanalysis data; Gamma trials and test payments are simulated.';
    $('weather-load-saved').disabled=true;
    $('weather-load-saved').hidden=true;
    document.querySelector('.weather-history-settings').hidden=true;
    feedback('Select a saved ERA5-Land source to download its historical records. Use Pricing lab for Gamma analysis, or Guided demo for the reported season and its evidence.');
    return;
  }
  if (!isPreview()) return;
  for (const id of ['weather-download','weather-load-saved','weather-download-history']) { $(id).disabled=true; $(id).title='Use the full local application for provider retrieval and persistent archives'; }
  $('weather-storage-badge').textContent='Preview · no saved data';
  document.querySelector('.weather-intro').textContent='Provider metadata is shown for reference. This protected preview does not download or store weather observations. Use the full local application for authorized provider ingestion; the pricing lab accepts transient CSV research inputs.';
  feedback('Weather downloads and persistent archives are disabled in this preview. No provider data has been substituted.');
}
window.addEventListener('cropguard:mode', configurePreview);
window.addEventListener('cropguard:hosted-session', configurePreview);
function busy(on) { state.busy=on; document.querySelectorAll('.weather-controls input,.weather-controls select,.weather-controls button,#weather-job-list button').forEach(n=>{n.disabled=on;}); $('weather-result').setAttribute('aria-busy',String(on)); if(!on)configurePreview(); }
async function request(path, body, asBlob=false) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),180000);
  try {
    const response=await fetch(path,body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal} : {signal:controller.signal});
    if(asBlob) {
      if(response.ok)return await response.blob();
      let detail;
      try { detail=(await response.json()).detail; } catch { /* Retain the HTTP status if an error body is not JSON. */ }
      throw new Error(`Download failed (HTTP ${response.status}).${typeof detail==='string'?' '+detail:''}`);
    }
    const data=await readEvidenceJson(response);
    if(!response.ok){const error=new Error(typeof data.detail==='string'?data.detail:'Check the station, dates and input values.');error.status=response.status;throw error;}
    return data;
  } catch(e) { if(e.name==='AbortError')throw new Error('The request timed out. A saved server job may still continue; refresh saved requests and source versions. No replacement data was shown.'); throw e; }
  finally {clearTimeout(timer);}
}
function date(value) { return new Date(value).toLocaleString(); }
function actionLink(text, href, name) {
  const a=el('a','button outline small-button',text);a.href=href;
  if(name) {
    a.download=name;let downloading=false;
    a.onclick=async event=>{
      event.preventDefault();if(downloading)return;downloading=true;a.setAttribute('aria-disabled','true');
      try { downloadBlob(await request(href,undefined,true),name);feedback(`Downloaded ${name}.`); }
      catch(e) { feedback(e.message,true); }
      finally { downloading=false;a.removeAttribute('aria-disabled'); }
    };
  } else {a.target='_blank';a.rel='noopener noreferrer';}
  return a;
}
function metric(title, value, note) { const n=el('article','metric'); n.append(el('span','',title),el('strong','',value),el('small','',note));return n; }
function downloadBlob(blob,name) { const u=URL.createObjectURL(blob), a=el('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000); }
function downloadJson(value,name) { downloadBlob(evidenceJsonBlob(value),name); }
function svg(tag,attrs,text) { const n=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));if(text!==undefined)n.textContent=text;return n; }
function chart(records) {
  const root=svg('svg',{viewBox:'0 0 760 255',role:'img','aria-label':'Source-derived monthly rainfall in millimetres. Missing months are labelled missing.'});
  root.append(svg('title',{},'Source-derived monthly precipitation; the trigger applies to the season total, not to individual bars.'));
  const max=Math.max(1,...records.map(r=>r.rainfallMmX1000??0)), gap=680/records.length;
  root.append(svg('line',{x1:44,x2:730,y1:210,y2:210,class:'weather-axis'}));
  records.forEach((r,i)=>{
    const x=44+i*gap+gap*.2,w=gap*.6,h=r.rainfallMmX1000===null?0:Math.max(1,r.rainfallMmX1000/max*154);
    root.append(svg('rect',{x,y:210-h,width:w,height:h,rx:2,class:'weather-rain-bar'}));
    root.append(svg('text',{x:x+w/2,y:Math.max(28,202-h),'text-anchor':'middle',class:'weather-bar-value'},r.rainfallMmX1000===null?'missing':mm(r.rainfallMmX1000)));
    root.append(svg('text',{x:x+w/2,y:235,'text-anchor':'middle',class:'weather-bar-label'},r.month));
  });
  return root;
}
async function refreshList(selectId) {
  const hosting=await hostingConfiguration();
  const result=await request('/api/weather/datasets');
  const era5Items=result.items.filter(r=>era5Parameters.has(r.parameter));
  for(const id of ['weather-dataset-select','weather-baseline-select']) {
    const old=selectId&&id==='weather-dataset-select'?selectId:$(id).value;
    $(id).replaceChildren(new Option(id==='weather-baseline-select'?'No comparison':'Select a saved dataset',''));
    for(const r of era5Items)$(id).append(new Option(`${r.station} · ${r.parameter} · ${r.start_month} → ${r.end_month_exclusive} excl. · ${r.complete?'complete':'gaps/conflicts'} · ${r.snapshot_id.slice(2,10)}`,r.snapshot_id));
    if([...$(id).options].some(o=>o.value===old))$(id).value=old;
    else if(isHostedDemo()&&id==='weather-dataset-select'&&era5Items.length)$(id).value=era5Items[0].snapshot_id;
  }
  $('weather-storage-badge').textContent=isPreview()?'Preview · no saved data':`${era5Items.length} saved ERA5-Land source versions`;
  const list=$('weather-run-list'); list.replaceChildren();
  if(!result.recentRuns.length)list.append(el('p','small','No download attempts recorded.'));
  for(const run of result.recentRuns){const n=el('div','weather-run');n.append(el('strong','',`${run.station} · ${run.status}`),el('span','small',`${run.start_month} → ${run.end_month_exclusive} · ${date(run.started_at)}`));if(run.error)n.append(el('p','small',run.error));list.append(n);}
  if(hosting)await refreshJobs();
  window.dispatchEvent(new CustomEvent('cropguard:weather-datasets',{detail:result}));
  if(isHostedDemo())renderHostedSourceLinks();
}
function renderHostedSourceLinks() {
  if(!isHostedDemo())return;
  const id=$('weather-dataset-select').value, root=el('article','panel');
  root.append(el('h3','','Saved ERA5-Land evidence'),el('p','','The source history contains 492 months, January 1985 through December 2025, for the Adama grid point. The pricing model uses 41 June–September seasons.'));
  if(/^0x[0-9a-f]{64}$/.test(id)) {
    const actions=el('div','button-row');
    actions.append(actionLink('Download monthly CSV',`/api/weather/datasets/${id}/csv`,'cropguard-era5-monthly.csv'),actionLink('Open source manifest',`/api/weather/datasets/${id}`));
    root.append(actions);
  } else root.append(el('p','small','No saved source is selected. Refresh the list and choose the ERA5-Land history.'));
  root.append(el('p','small','Historical reanalysis is real source data. Gamma rainfall trials are simulated; demonstration tokens have no monetary value.'));
  $('weather-result').replaceChildren(root);
}
function completeJob(job) { return ['complete','completed','succeeded'].includes(job.status)&&Boolean(job.snapshotId); }
function failedJob(job) { return ['failed','submission_uncertain','needs_attention'].includes(job.status); }
function renderJobs(jobs) {
  const list=$('weather-job-list');list.replaceChildren();
  if(!jobs.length)list.append(el('p','small','No queued downloads. Submit one month of ERA5-Land data to start.'));
  for(const job of jobs) {
    const item=el('article','weather-run'),complete=completeJob(job),failed=failedJob(job);
    item.append(el('strong','',`${job.station} · ${complete?'Saved source data available':failed?'Download needs attention':job.status}`),el('span','small',`${job.startMonth} → ${job.endMonthExclusive} exclusive · updated ${date(job.updatedAt)}`));
    if(job.notice)item.append(el('p','small',job.notice));
    if(job.error)item.append(el('p','notice',job.error));
    if(failed)item.append(el('p','small','No replacement rainfall was created. Review the error and your Copernicus request list before starting another download.'));
    else if(complete) {
      const load=el('button','button outline small-button','Analyse saved data');load.type='button';load.disabled=state.busy;
      load.onclick=()=>loadSaved(job.snapshotId);item.append(load);
    } else {
      item.append(el('p','small','This request remains saved when you leave the page. The server resumes it daily; checking progress advances one step.'));
      const check=el('button','button outline small-button','Check progress');check.type='button';check.disabled=state.busy;
      check.onclick=()=>advanceJob(job.jobId);item.append(check);
    }
    list.append(item);
  }
}
async function refreshJobs() { const result=await request('/api/weather/jobs');renderJobs(result.items); }
async function advanceJob(jobId) {
  if(state.busy)return;busy(true);feedback('Checking the provider and saving any completed source data…');
  try {
    const result=await request('/api/weather/jobs/advance',{jobId});
    const job=result.items.find(item=>item.jobId===jobId);
    await refreshList();
    if(job&&completeJob(job))feedback('Download complete. Verified source data is saved; choose Analyse saved data to inspect it. No blockchain transaction was sent.');
    else if(job&&failedJob(job))feedback(`Download needs attention. ${job.error||'See the saved request below.'} No replacement rainfall was created.`,true);
    else feedback(result.status==='busy'?'Another server check is already running. Your request remains saved; check again later.':'Request remains in progress. The server will resume it daily, or you can check progress again later.');
  } catch(error) { feedback(`${error.message} The saved request may still be pending; refresh the list to check.`,true); }
  finally {busy(false);}
}
function render(report,snapshot) {
  const root=el('div','weather-report'), heading=el('div','section-heading');
  const titles=el('div');titles.append(el('span','eyebrow muted',`${report.station} · ${report.startMonth} → ${report.endMonthExclusive} EXCLUSIVE`),el('h2','',labels[report.status]));
  const badge=el('span',`badge ${report.eligibleForReportPreparation?'success':'warning'}`,report.eligibleForReportPreparation?'Local index check · not on-chain':'No final local verdict');
  heading.append(titles,badge);root.append(heading);
  const metrics=el('div','metrics weather-metrics');
  metrics.append(metric('Season rainfall',`${mm(report.rainfallMmX1000)} mm`,report.rainfallMmX1000===null?'No complete-season total reported':'Sum of the provider-labelled months'),
    metric('Study threshold',`${mm(report.thresholdMmX1000)} mm`,'Strictly below triggers; equality does not'),
    metric('Shortfall to threshold',`${mm(report.shortfallToThresholdMmX1000)} mm`,'Not a measure of crop loss'),
    metric('Available months',`${report.completeMonths} / ${report.expectedMonths}`,'Availability is not provider finality'));
  root.append(metrics);
  const plot=el('article','panel weather-plot');plot.append(el('h3','','The indexed season'),el('p','small','Monthly totals in mm. The drought rule uses the sum of the entire selected season.'),chart(report.records));root.append(plot);
  const detail=el('article','panel'); detail.append(el('h3','','Source vintage & decision checks'));
  for(const [name,value] of [['Source last validated',date(report.sourceRetrievedAt)],['Publication wait ends',date(report.publicationNotBefore)],['Publication wait satisfied',report.sourceVintageWaitSatisfied?'Yes · not a finality attestation':'No · download again after the wait'],['Selected source version',snapshot.snapshotId],['On-chain status','Not submitted / not finalized']]){const row=el('div','data-row weather-data-row');row.append(el('span','',name),el('strong','',value));detail.append(row);}
  if(report.status==='provisional_data')detail.append(el('p','notice',`A calculation on the available totals ${report.researchTrigger?'is below':'is not below'} the threshold, but it remains provisional. The saved source vintage has not met the publication wait.`));
  if(report.baseline.status==='available'&&report.baseline.meanRainfallMm!==undefined){const b=report.baseline;detail.append(el('h4','','Compared with earlier matching seasons'),el('p','',`${b.completeSeasons} complete reference seasons · mean ${b.meanRainfallMm.toFixed(1)} mm · ${b.percentOfReferenceMean===null?'zero reference mean':b.percentOfReferenceMean.toFixed(1)+'% of reference mean'} · empirical percentile ${b.empiricalMidrankPercentile.toFixed(1)}.`),el('p','small',b.notice));}
  else if(report.baseline.status==='insufficient_complete_seasons')detail.append(el('p','notice',`Reference not calculated: only ${report.baseline.completeSeasons} complete seasons. At least 30 are required.`));
  const exports=el('div','button-row');
  const json=el('button','button outline small-button','Download analysis JSON');json.type='button';json.onclick=()=>downloadJson(report,'cropguard-ethiopia-drought.json');exports.append(json);
  if(snapshot.complete)exports.append(actionLink('Download monthly CSV',`/api/weather/datasets/${snapshot.snapshotId}/csv`,'ethiopia-monthly.csv'));
  const raw=el('button','text-button','Download source manifest');raw.type='button';raw.onclick=()=>downloadJson(snapshot,'ethiopia-source-snapshot.json');exports.append(raw);detail.append(exports);root.append(detail);
  const evidence=el('details','panel weather-evidence');evidence.append(el('summary','','Raw source files, hashes & limitations'));
  for(const p of report.provenance){const block=el('div','weather-source');block.append(el('p','small',p.url),el('code','hash',p.sha256),actionLink(`Archived ${p.extension.toUpperCase()}`,`/api/weather/sources/${p.sha256}`,`ethiopia-${p.sha256.slice(2,10)}.${p.extension}`));evidence.append(block);}
  evidence.append(el('p','small','SHA-256 commitments make versions comparable; they do not themselves prove a provider signature or guarantee archive availability.'),el('h4','','Evidence hash'),el('code','hash',report.evidenceHash||'Not generated for incomplete/unfinished observations'),el('h4','','Analysis hash'),el('code','hash',report.analysisHash));
  for(const warning of report.warnings)evidence.append(el('p','small',warning));root.append(evidence);
  $('weather-result').replaceChildren(root);
}
async function analyse(snapshot) {
  const body={snapshot_id:snapshot.snapshotId,threshold_mm:$('weather-threshold').value.trim(),start:$('weather-start').value,end:$('weather-end').value,
    baseline_snapshot_id:$('weather-baseline-select').value||null,baseline_start_year:Number($('weather-baseline-start').value),baseline_end_year:Number($('weather-baseline-end').value)};
  const report=await request('/api/weather/analyse',body);
  state.snapshot=snapshot;state.report=report;state.stale=false;render(report,snapshot);
  feedback(`Saved analysis · ${labels[report.status]}. Source version ${snapshot.snapshotId.slice(2,14)}. No blockchain transaction was sent.`);
}
function stale() {if(state.report&&!state.busy){state.stale=true;feedback('Settings changed. The displayed analysis still belongs to the previous settings; run again to update it.');}}
$('weather-form').addEventListener('submit',async e=>{
  e.preventDefault();if(isPreview()){configurePreview();return;}if(state.busy)return;busy(true);
  try{
    const hosting=await hostingConfiguration(),body={station:$('station').value,provider:$('weather-provider').value,start:$('weather-start').value,end:$('weather-end').value};
    if(hosting) {
      if(body.provider!=='era5_land')throw new Error('This dataset needs operator setup. Hosted downloads currently support standard ERA5-Land; saved source versions remain available.');
      const [startYear,startMonth]=body.start.split('-').map(Number),[endYear,endMonth]=body.end.split('-').map(Number);
      if((endYear-startYear)*12+endMonth-startMonth!==1)throw new Error('Choose exactly one month: for January, use January as the first included month and February as the first excluded month.');
      feedback('Saving your rainfall download request…');
      const job=await request('/api/weather/jobs',body);await refreshList();
      if(failedJob(job))feedback(`Download needs attention. ${job.error||'See the saved request below.'} No replacement rainfall was created.`,true);
      else feedback(completeJob(job)?'This download is already complete. Choose Analyse saved data below to inspect the verified source.':'Download queued. No new rainfall is available yet. The server resumes the request daily; use Check progress below to advance it now.');
    } else {
      feedback('Retrieving the selected dataset using backend credentials, validating daily coverage and archiving evidence…');
      const snapshot=await request('/api/weather/sync',body);await refreshList(snapshot.snapshotId);await analyse(snapshot);
    }
  }
  catch(e){feedback(`${e.message}${state.report?' The displayed analysis is from the previous successful run.':''}`,true);try{await refreshList();}catch{ /* Keep the original download error visible. */ }}finally{busy(false);}
});
async function loadSaved(id) {
  if(isHostedDemo()){configurePreview();renderHostedSourceLinks();return;}
  if(isPreview()){configurePreview();return;}if(state.busy)return;if(!id){feedback('Select a saved dataset first.',true);return;}busy(true);feedback('Reading the selected archived source version. No provider request is made.');
  try{const snapshot=await request(`/api/weather/datasets/${id}`);
    if(!era5Providers.has(snapshot.provider))throw new Error('This demo accepts ERA5-Land history only.');
    if(![...$('weather-provider').options].some(o=>o.value===snapshot.provider))$('weather-provider').append(new Option('ERA5-Land · time series (saved history)',snapshot.provider));
    $('station').value=snapshot.station;$('weather-provider').value=snapshot.provider;
    const span=(Number(snapshot.endMonthExclusive.slice(0,4))-Number(snapshot.startMonth.slice(0,4)))*12+Number(snapshot.endMonthExclusive.slice(5))-Number(snapshot.startMonth.slice(5));
    if(span<=12){$('weather-start').value=snapshot.startMonth;$('weather-end').value=snapshot.endMonthExclusive;}
    await analyse(snapshot);
  }catch(e){feedback(e.message,true);}finally{busy(false);}
}
$('weather-load-saved').onclick=()=>void loadSaved($('weather-dataset-select').value);
$('weather-dataset-select').addEventListener('change',renderHostedSourceLinks);
$('weather-history-form').addEventListener('submit',e=>{
  e.preventDefault();
  feedback(`Run locally in the project folder (provider credentials required): python -m services.cli weather-sync --provider ${$('weather-provider').value} --site ${$('station').value} --start ${$('weather-history-start').value} --end ${$('weather-history-end').value} . After it completes, refresh the saved-data list. Long provider jobs do not run through a browser request.`);
});
$('weather-refresh-list').onclick=()=>void refreshList().catch(e=>feedback(e.message,true));
document.querySelector('.weather-controls').addEventListener('input',event=>{if(['weather-start','weather-end'].includes(event.target?.id))state.datesEdited=true;stale();});
window.addEventListener('cropguard:navigate',e=>{if(e.detail.page==='weather')void refreshList().catch(e=>feedback(e.message,true));});
const year=new Date().getUTCFullYear()-1;$('weather-start').value=`${year}-06`;$('weather-end').value=`${year}-10`;
if(!$('page-weather').classList.contains('hidden'))void refreshList().catch(e=>feedback(e.message,true));

configurePreview();
function configureReplay(value) {
  if(value?.manifest?.era5Replay === true) $('weather-threshold').value = (Number(value.manifest.historicalReplay.thresholdMmX1000) / 1000).toFixed(3);
  if(value?.mode==='hosted_demo'||value?.hostedDemo===true) {
    const sourceYear=value.manifest?.historicalReplay?.sourceYear??2023;
    $('weather-start').value=`${sourceYear}-06`;$('weather-end').value=`${sourceYear}-10`;
    configurePreview();
  }
}
if(window.cropguardStatus) configureReplay(window.cropguardStatus);
else window.addEventListener('cropguard:status', event=>configureReplay(event.detail), {once:true});
