import { vertex, scene, composite } from './shaders.js';
import { CAMERA_RADIUS, TABLE_WIDTH, TABLE_HEIGHT } from './geodesics.js';
import { orbitalBasis, fallingBasis, wrapDegrees, flightFrame, createFlightTrajectory, sampleFlight, flightSignal } from './freefall.js';

const $ = selector => document.querySelector(selector);
const canvas = $('#universe');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = { inclination: 82, azimuth: .15, fov: 40, exposure: 1, mode: 'cinematic', quality: 'balanced', paused: reducedMotion, orbit: false, labels: false, time: 0, falling: false, radius: CAMERA_RADIUS, fallYaw: 0, fallPitch: 0, completed: false, panorama: innerWidth > 740, flightElapsed: 0, flightAngle: 0, properTime: 0 };
const trajectory = createFlightTrajectory();
const flightDuration = trajectory.at(-1).elapsed;
const presets = { battery: { scale: .52, max: 1100, fps: 30, glow: .45 }, balanced: { scale: .8, max: 1600, fps: 60, glow: .9 }, high: { scale: 1, max: 2400, fps: 60, glow: 1.1 } };
let gl, sceneProgram, compositeProgram, target, framebuffer, pathTexture, endingTexture;
let displayWidth = 0, displayHeight = 0, adaptiveScale = 1, ready = false, dirty = true;
let raf = 0, lastFrame = 0, sampleStart = 0, frames = 0, fps = 0, lastAdapt = 0, performanceFrames = [];
let timerExtension, activeQuery = null, pendingQueries = [], gpuMs = null;
let worker, generation = 0, workerTimeout;
let fallBasis = null, lastFallStage = '', previousPause = false, fallStartTime = 0;

function fail(message) {
  ready = false; cancelAnimationFrame(raf); clearTimeout(workerTimeout);
  worker?.terminate(); $('#loading').hidden = true;
  $('#error').textContent = message; $('#error').hidden = false;
}
function program(fragment) {
  const shaders = [ [gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment] ].map(([type, source]) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  });
  const p = gl.createProgram(); shaders.forEach(s => gl.attachShader(p, s)); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  shaders.forEach(s => gl.deleteShader(s));
  return { program: p, uniforms: new Map() };
}
function uniform(p, name, method, ...values) {
  if (!p.uniforms.has(name)) p.uniforms.set(name, gl.getUniformLocation(p.program, name));
  gl[method](p.uniforms.get(name), ...values);
}
function texture(width, height, data, internal, format, type, filter = gl.NEAREST) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, format, type, data);
  return t;
}
function resize() {
  const bounds = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  // Display and simulation resolution are independent: the UI stays sharp.
  displayWidth = Math.max(1, Math.round(bounds.width * dpr)); displayHeight = Math.max(1, Math.round(bounds.height * dpr));
  canvas.width = displayWidth; canvas.height = displayHeight;
  const preset = presets[state.quality];
  const fallScale = state.quality === 'high' ? .6 : state.quality === 'battery' ? .36 : .48;
  const scale = Math.min((state.falling ? fallScale : preset.scale) * adaptiveScale, (state.falling ? 1000 : preset.max) / displayWidth);
  const w = Math.max(1, Math.round(displayWidth * scale)), h = Math.max(1, Math.round(displayHeight * scale));
  if (target) gl.deleteTexture(target);
  target = texture(w, h, null, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR);
  if (!framebuffer) framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('The HDR render target is unavailable on this GPU. Try a current version of Safari or Chrome.');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  target.width = w; target.height = h;
  $('#resolution').textContent = `${w} × ${h}`;
  dirty = true; updateLabels();
}
function cameraBasis() {
  if (state.falling) {
    const frame = flightFrame(fallBasis, state.flightAngle, state.radius);
    return { er: frame.er, observerVelocity: frame.observer.velocity, ...fallingBasis(frame.view, state.fallYaw, state.fallPitch) };
  }
  const basis = orbitalBasis(state.inclination, state.azimuth);
  return { ...basis, observerVelocity: [0,0,0], forward: basis.er.map(x => -x) };
}
function updateLabels() {
  if (!state.labels || state.falling) return;
  const box = canvas.getBoundingClientRect(), scale = box.height / (2 * Math.tan(state.fov * Math.PI / 360));
  const cx = box.width / 2 - (box.width / box.height > .95 ? .055 * box.height : 0), cy = box.height / 2;
  const shadowRadius = scale * Math.tan(Math.asin(Math.sqrt(27) / 2 * Math.sqrt(.975) / CAMERA_RADIUS));
  const positions = { shadow: [cx + shadowRadius * .6, cy + shadowRadius * .6], disk: [cx + scale * .21, cy + scale * .10 * Math.cos(state.inclination * Math.PI / 180)], lensing: [cx - shadowRadius * .2, cy - shadowRadius * 1.55] };
  for (const [key, pos] of Object.entries(positions)) {
    const el = $(`#${key}-label`); el.style.left = `${Math.min(box.width - el.offsetWidth - 16, Math.max(16, pos[0]))}px`; el.style.top = `${pos[1]}px`;
  }
}
function render() {
  const basis = cameraBasis();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.viewport(0, 0, target.width, target.height); gl.useProgram(sceneProgram.program);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pathTexture);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, endingTexture);
  uniform(sceneProgram, 'paths', 'uniform1i', 0); uniform(sceneProgram, 'endings', 'uniform1i', 1);
  uniform(sceneProgram, 'resolution', 'uniform2f', target.width, target.height);
  uniform(sceneProgram, 'camera', 'uniform3f', ...basis.er.map(x => x * state.radius));
  uniform(sceneProgram, 'right', 'uniform3f', ...basis.right); uniform(sceneProgram, 'up', 'uniform3f', ...basis.up);
  uniform(sceneProgram, 'forward', 'uniform3f', ...basis.forward);
  uniform(sceneProgram, 'falling', 'uniform1f', state.falling ? 1 : 0);
  uniform(sceneProgram, 'panorama', 'uniform1f', state.falling && state.panorama ? 1 : 0);
  uniform(sceneProgram, 'observerVelocity', 'uniform3f', ...basis.observerVelocity);
  uniform(sceneProgram, 'diskDetail', 'uniform1f', state.quality === 'battery' ? .25 : state.quality === 'high' ? 1 : .7);
  uniform(sceneProgram, 'rayPrecision', 'uniform1f', state.quality === 'high' ? .04 : state.quality === 'battery' ? .07 : .055);
  uniform(sceneProgram, 'raySteps', 'uniform1i', state.quality === 'high' ? 800 : state.quality === 'battery' ? 420 : 620);
  const mobile = canvas.getBoundingClientRect().width <= 740 && !document.body.classList.contains('clean');
  const effectiveFov = 2 * Math.atan(Math.tan(state.fov * Math.PI / 360) * Math.max(1, displayHeight / displayWidth));
  uniform(sceneProgram, 'fov', 'uniform1f', effectiveFov); uniform(sceneProgram, 'time', 'uniform1f', state.time);
  uniform(sceneProgram, 'mobile', 'uniform1f', mobile ? 1 : 0);
  uniform(sceneProgram, 'cinematic', 'uniform1f', state.mode === 'cinematic' ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, displayWidth, displayHeight); gl.useProgram(compositeProgram.program);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, target);
  uniform(compositeProgram, 'image', 'uniform1i', 0); uniform(compositeProgram, 'resolution', 'uniform2f', displayWidth, displayHeight);
  uniform(compositeProgram, 'exposure', 'uniform1f', state.exposure);
  uniform(compositeProgram, 'signalStrength', 'uniform1f', state.falling ? flightSignal(state.radius) : 1);
  uniform(compositeProgram, 'bloom', 'uniform1f', state.mode === 'cinematic' ? presets[state.quality].glow : .12);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
function collectGpuTimes() {
  if (!timerExtension) return;
  const disjoint = gl.getParameter(timerExtension.GPU_DISJOINT_EXT);
  pendingQueries = pendingQueries.filter(query => {
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return true;
    if (!disjoint) gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
    gl.deleteQuery(query); return false;
  });
}
function animate(now) {
  if (!ready || document.hidden) return;
  raf = requestAnimationFrame(animate);
  const interval = 1000 / (state.falling ? 30 : presets[state.quality].fps);
  if (now - lastFrame < interval - 1) return;
  const dt = Math.min((now - (lastFrame || now)) / 1000, .1); lastFrame = now;
  if (!state.paused && !state.falling) state.time += dt * 7.7;
  if (state.falling && !state.paused && !state.completed) {
    state.flightElapsed = Math.min(flightDuration, state.flightElapsed + dt);
    state.time = fallStartTime + state.flightElapsed * 7.7;
    const flight = sampleFlight(trajectory, state.flightElapsed);
    state.radius = flight.radius; state.flightAngle = flight.angle; state.properTime = flight.properTime;
    if (state.flightElapsed >= flightDuration) { state.completed = true; state.paused = true; sync(); }
    updateFallStatus(); dirty = true;
  }
  if (state.orbit && !state.paused) { state.azimuth += dt * .025; dirty = true; }
  if (state.paused && !dirty) { $('#fps').textContent = state.completed ? 'Journey complete · signal lost' : 'Paused · resting GPU'; return; }
  collectGpuTimes();
  if (timerExtension && pendingQueries.length < 4 && frames % 20 === 0) {
    activeQuery = gl.createQuery(); gl.beginQuery(timerExtension.TIME_ELAPSED_EXT, activeQuery);
  }
  render();
  if (activeQuery) { gl.endQuery(timerExtension.TIME_ELAPSED_EXT); pendingQueries.push(activeQuery); activeQuery = null; }
  dirty = false; frames++;
  performanceFrames.push(dt * 1000); if (performanceFrames.length > 90) performanceFrames.shift();
  if (now - sampleStart >= 1200) {
    fps = Math.round(frames * 1000 / (now - sampleStart)); frames = 0; sampleStart = now;
    $('#fps').textContent = `${fps} fps${gpuMs !== null ? ` · GPU ${gpuMs.toFixed(1)} ms` : ''}`;
    const budget = interval;
    const average = performanceFrames.reduce((a, b) => a + b, 0) / Math.max(1, performanceFrames.length);
    const cost = gpuMs ?? average;
    if (now - lastAdapt > 5000) {
      let next = adaptiveScale;
      if (cost > budget * 1.22 && adaptiveScale > .5) next = Math.max(.5, adaptiveScale * .85);
      else if (gpuMs !== null && cost < budget * .55 && adaptiveScale < 1) next = Math.min(1, adaptiveScale + .06);
      if (next !== adaptiveScale) { adaptiveScale = next; resize(); lastAdapt = now; }
    }
  }
}
function wake() { dirty = true; }
function sync() {
  $('#inclination').value = state.inclination;
  $('#inclination-value').textContent = `${Math.round(state.inclination)}°`;
  $('#camera-angle').textContent = state.falling ? `Free fall · ${state.radius.toFixed(2)} rₛ` : `${Math.round(state.inclination)}° vertical · ${Math.round(wrapDegrees(state.azimuth * 180 / Math.PI))}° horizontal`;
  $('#zoom-value').textContent = state.falling && state.panorama ? '360° × 180° all-sky panorama' : `${Math.round(state.fov)}° field of view`;
  $('#exposure').value = state.exposure; $('#exposure-value').textContent = `${state.exposure.toFixed(1)}×`;
  $('#pause').innerHTML = state.completed ? '✓ <span>Complete</span>' : state.paused ? '▷ <span>Resume</span>' : 'Ⅱ <span>Pause</span>';
  $('#pause').disabled = state.completed;
  $('#pause').setAttribute('aria-label', state.completed ? 'Journey complete' : state.paused ? 'Resume animation' : 'Pause animation');
  if (state.paused) $('#fps').textContent = state.completed ? 'Journey complete · signal lost' : 'Paused · resting GPU';
  else if (/^(Journey complete|Paused)/.test($('#fps').textContent)) {
    $('#fps').textContent = 'Measuring performance'; sampleStart = performance.now(); frames = 0;
  }
  $('#look-back').setAttribute('aria-pressed', Math.cos(state.fallYaw) < 0 ? 'true' : 'false');
  $('#look-back').textContent = Math.cos(state.fallYaw) < 0 ? '↶ Look forward' : '↶ Look back';
  $('#projection').textContent = state.panorama ? '360° all sky · switch to perspective' : 'Perspective · switch to 360° all sky';
  $('#projection').setAttribute('aria-pressed', String(state.panorama));
  $('#orbit').checked = state.orbit; $('#labels').checked = state.labels; $('#annotations').hidden = !state.labels || state.falling;
  $('#inclination').disabled = state.falling; $('#orbit').disabled = state.falling;
  $('#labels').disabled = state.falling;
  $('#fall-options').hidden = !state.falling; $('#fall-status').hidden = !state.falling; $('#plunge').hidden = state.falling;
  $('#fall-hint').textContent = state.completed ? 'Signal lost · scrub to replay or return to orbit' : state.falling ? 'Drag to look around · scrub to revisit any moment' : 'NASA-inspired spiral flight · nearly two loops';
  $('#adaptive').textContent = state.falling ? '30 FPS TARGET' : 'ADAPTIVE';
  $('#quality option[value="balanced"]').textContent = state.falling ? 'Balanced · plunge detail' : 'Balanced · 60 fps target';
  $('#quality option[value="high"]').textContent = state.falling ? 'High · plunge detail' : 'High · more detail';
  document.body.classList.toggle('in-flight', state.falling);
  document.querySelectorAll('[data-view]').forEach(el => el.disabled = state.falling);
  document.querySelectorAll('[data-mode]').forEach(el => { const active = el.dataset.mode === state.mode; el.classList.toggle('active', active); el.setAttribute('aria-pressed', active); });
  document.querySelectorAll('[data-view]').forEach(el => { const angle = el.dataset.view === 'face' ? 2 : el.dataset.view === 'edge' ? 88 : 82; const active = Math.abs(state.inclination - angle) < .5; el.classList.toggle('selected', active); el.setAttribute('aria-pressed', active); });
  updateLabels(); wake();
}
function reset() { if (state.falling) exitFall(); Object.assign(state, { inclination: 82, azimuth: .15, fov: 40, exposure: 1, orbit: false }); sync(); }
function updateFallStatus() {
  $('#fall-radius').textContent = `${state.radius.toFixed(2)} rₛ`;
  $('#camera-angle').textContent = `Free fall · ${state.radius.toFixed(2)} rₛ`;
  $('#fall-progress').value = state.flightElapsed / flightDuration * 1000;
  $('#flight-time').textContent = `${state.flightElapsed.toFixed(1)} / ${flightDuration.toFixed(1)} s`;
  $('#flight-loops').textContent = `${(state.flightAngle/(2*Math.PI)).toFixed(2)} loops`;
  $('#proper-time').textContent = `${(state.properTime * 650165 / 86400).toFixed(1)} days`;
  const extent = Math.max(4, state.radius * 1.2), scale=48/extent;
  const project = f => [100+f.radius*Math.sin(f.angle)*scale,55-f.radius*Math.cos(f.angle)*scale];
  const points = trajectory.filter((f,i)=>i%8===0 && f.elapsed<=state.flightElapsed);
  points.push({radius:state.radius,angle:state.flightAngle});
  $('#track-path').setAttribute('d',points.map((f,i)=>`${i?'L':'M'}${project(f).map(v=>v.toFixed(2)).join(',')}`).join(' '));
  const point=project({radius:state.radius,angle:state.flightAngle});
  $('#track-camera').setAttribute('cx',point[0]); $('#track-camera').setAttribute('cy',point[1]);
  $('#track-horizon').setAttribute('r',scale); $('#track-photon').setAttribute('r',1.5*scale);
  const stage = state.completed ? 'SIGNAL LOST · JOURNEY COMPLETE' : state.radius <= .12 ? 'CAMERA SIGNAL FADING' : state.radius <= .4 ? 'APPROACHING THE CENTER' : state.radius <= 1 ? 'HORIZON CROSSED' : state.radius <= 1.5 ? 'APPROACHING THE HORIZON' : state.radius <= 3 ? 'LOOPING INSIDE THE DISK' : 'APPROACHING THE BLACK HOLE';
  if (lastFallStage !== stage) {
    lastFallStage = stage; $('#fall-stage').textContent = stage;
    $('#fall-message').textContent = state.completed ? 'The journey ends in darkness as the simulated camera loses its signal near the center. Scrub to replay or return to orbit.' : state.radius <= .12 ? 'The camera signal fades to black for the end of the journey. This final fade is cinematic.' : state.radius <= .4 ? 'Continuing deep inside the horizon toward the central singularity. The final descent is slowed for viewing.' : state.radius <= 1 ? 'Incoming light can still reach you. Outgoing signals cannot escape. The descent continues.' : state.radius <= 1.5 ? 'The horizon is at 1 rₛ. Motion changes the apparent direction and brightness of light.' : state.radius <= 3 ? 'Nearly two loops inside the disk’s inner edge, then the final plunge.' : 'A curved free-fall path. Drag to look around; Space pauses.';
  }
}
function startFall() {
  if (!ready || state.falling) return;
  previousPause = state.paused; fallStartTime = state.time; fallBasis = orbitalBasis(state.inclination, state.azimuth);
  Object.assign(state, { falling: true, radius: CAMERA_RADIUS, fallYaw: 0, fallPitch: 0, completed: false, paused: false, orbit: false, flightElapsed: 0, flightAngle: 0, properTime: 0 });
  lastFallStage = ''; adaptiveScale = 1; gpuMs = null; performanceFrames = []; frames = 0; sampleStart = performance.now();
  $('#fps').textContent = 'Measuring performance';
  sync(); resize(); updateFallStatus();
}
function exitFall() {
  Object.assign(state, { falling: false, radius: CAMERA_RADIUS, completed: false, paused: previousPause });
  adaptiveScale = 1; gpuMs = null; performanceFrames = []; frames = 0; sampleStart = performance.now();
  $('#fps').textContent = 'Measuring performance';
  sync(); if (ready) resize();
}
function lookBack() {
  state.fallYaw = Math.abs(Math.cos(state.fallYaw) - 1) < .2 ? Math.PI : 0;
  state.fallPitch = 0; $('#look-back').setAttribute('aria-pressed', Math.cos(state.fallYaw) < 0 ? 'true' : 'false');
  $('#look-back').textContent = Math.cos(state.fallYaw) < 0 ? '↶ Look forward' : '↶ Look back'; wake();
}
$('#plunge').addEventListener('click', startFall); $('#exit-fall').addEventListener('click', exitFall); $('#look-back').addEventListener('click', lookBack);
$('#projection').addEventListener('click', () => { state.panorama=!state.panorama; sync(); });
$('#fall-progress').addEventListener('input', e => {
  state.flightElapsed=Number(e.target.value)/1000*flightDuration;
  state.time=fallStartTime+state.flightElapsed*7.7;
  const f=sampleFlight(trajectory,state.flightElapsed);
  state.radius=f.radius; state.flightAngle=f.angle; state.properTime=f.properTime;
  state.completed=state.flightElapsed>=flightDuration; state.paused=true;
  updateFallStatus(); sync();
});
function toggleUi() { const hidden = document.body.classList.toggle('clean'); $('#restore').hidden = !hidden; wake(); }
let toastTimer;
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
$('#inclination').addEventListener('input', e => { state.inclination = Number(e.target.value); sync(); });
$('#exposure').addEventListener('input', e => { state.exposure = Number(e.target.value); sync(); });
$('#quality').addEventListener('change', e => { state.quality = e.target.value; adaptiveScale = 1; performanceFrames = []; gpuMs = null; lastAdapt = performance.now(); if (ready) resize(); wake(); });
$('#labels').addEventListener('change', e => { state.labels = e.target.checked; sync(); });
$('#orbit').addEventListener('change', e => { state.orbit = e.target.checked; sync(); });
$('#pause').addEventListener('click', () => { if (!state.completed) state.paused = !state.paused; sync(); });
$('#reset').addEventListener('click', reset); $('.brand').addEventListener('click', e => { e.preventDefault(); reset(); });
$('#hide').addEventListener('click', toggleUi); $('#restore').addEventListener('click', toggleUi);
document.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => { state.mode = el.dataset.mode; state.labels = state.mode === 'science'; sync(); }));
document.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => { state.inclination = el.dataset.view === 'face' ? 2 : el.dataset.view === 'edge' ? 88 : 82; state.azimuth = .15; sync(); }));
const featureText = {
  shadow: 'The shadow is larger than the event horizon: it includes directions whose light is captured. For a distant observer of this non-spinning model, the critical impact parameter is √27 / 2 horizon radii.',
  disk: 'The modeled thin disk extends from the innermost stable circular orbit at 3 horizon radii to 12 horizon radii. A radial temperature profile and orbital Doppler shifts make its approaching side brighter. Its texture is procedural.',
  lensing: 'The arc above and below the shadow is light from the disk bending around the black hole. The renderer finds several disk crossings along curved light paths. Higher-order images gather near the critical curve; the finest subrings are below the lookup resolution.'
};
function openAbout() { if (!$('#about').open) $('#about').showModal(); }
$('#info').addEventListener('click', openAbout); $('#about-link').addEventListener('click', openAbout);
$('#close-about').addEventListener('click', () => $('#about').close());
$('#about').addEventListener('click', e => { if (e.target === $('#about')) { const r = $('#about').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) $('#about').close(); } });
document.querySelectorAll('[data-feature]').forEach(el => el.addEventListener('click', () => { $('#feature-description').textContent = featureText[el.dataset.feature]; openAbout(); }));
let captureUrl;
$('#close-capture').addEventListener('click', () => $('#capture-dialog').close());
$('#capture-dialog').addEventListener('close', () => { if (captureUrl) URL.revokeObjectURL(captureUrl); captureUrl = null; $('#capture-image').removeAttribute('src'); });
$('#capture').addEventListener('click', () => {
  if (!ready) return; render();
  canvas.toBlob(blob => {
    if (!blob) { toast('Capture could not be generated. Please try again.'); return; }
    if (captureUrl) URL.revokeObjectURL(captureUrl);
    captureUrl = URL.createObjectURL(blob); $('#capture-image').src = captureUrl; $('#save-capture').href = captureUrl; $('#capture-dialog').showModal();
  }, 'image/png');
});

const pointers = new Map(); let pinch = null;
canvas.addEventListener('pointerdown', e => { canvas.focus({ preventScroll: true }); canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); });
canvas.addEventListener('pointermove', e => {
  const old = pointers.get(e.pointerId); if (!old) return;
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size > 1) { const [a, b] = [...pointers.values()]; const distance = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) { state.fov = Math.max(22, Math.min(65, state.fov * pinch / distance)); state.panorama=false; } pinch = distance; }
  else if (state.falling) { state.fallYaw += (e.clientX - old[0]) * .006; state.fallPitch += (e.clientY - old[1]) * .006; }
  else { state.azimuth -= (e.clientX - old[0]) * .006; state.inclination = wrapDegrees(state.inclination + (e.clientY - old[1]) * .22); }
  sync();
});
function release(e) { pointers.delete(e.pointerId); pinch = null; }
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release); canvas.addEventListener('lostpointercapture', release);
canvas.addEventListener('wheel', e => { e.preventDefault(); state.panorama=false; state.fov = Math.max(22, Math.min(65, state.fov * Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * .0015))); sync(); }, { passive: false });
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open]') || /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(e.target.tagName)) return;
  let handled = true;
  switch (e.key.toLowerCase()) {
    case 'arrowleft': if (state.falling) state.fallYaw -= .06; else state.azimuth -= .06; break;
    case 'arrowright': if (state.falling) state.fallYaw += .06; else state.azimuth += .06; break;
    case 'arrowup': if (state.falling) state.fallPitch -= .04; else state.inclination = wrapDegrees(state.inclination - 2); break;
    case 'arrowdown': if (state.falling) state.fallPitch += .04; else state.inclination = wrapDegrees(state.inclination + 2); break;
    case '+': case '=': state.panorama=false; state.fov = Math.max(22, state.fov - 2); break;
    case '-': state.panorama=false; state.fov = Math.min(65, state.fov + 2); break;
    case ' ': if (!state.completed) state.paused = !state.paused; break;
    case 'f': if (state.falling) lookBack(); else startFall(); break;
    case 'escape': if (state.falling) exitFall(); break;
    case 'r': reset(); break; case 'h': toggleUi(); break; default: handled = false;
  }
  if (handled) { e.preventDefault(); sync(); }
});
window.addEventListener('resize', () => { if (ready) resize(); });
document.addEventListener('visibilitychange', () => {
  cancelAnimationFrame(raf); if (!document.hidden && ready) { lastFrame = 0; sampleStart = performance.now(); frames = 0; wake(); raf = requestAnimationFrame(animate); }
});
canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); ready = false; generation++; worker?.terminate(); clearTimeout(workerTimeout); cancelAnimationFrame(raf); $('#loading').hidden = false; $('#loading strong').textContent = 'Restoring the observatory'; });
canvas.addEventListener('webglcontextrestored', () => { target = null; framebuffer = null; pendingQueries = []; activeQuery = null; initialize(); });

function initialize() {
  const token = ++generation;
  try {
    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    if (!gl) throw new Error('This visualization needs WebGL2. Please enable hardware acceleration or open it in a current version of Safari or Chrome.');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This visualization needs floating-point GPU render targets. Please try a current version of Safari or Chrome with hardware acceleration enabled.');
    if (gl.getParameter(gl.MAX_TEXTURE_SIZE) < TABLE_HEIGHT) throw new Error('This GPU cannot fit the light-path table. Please try a browser with hardware acceleration enabled.');
    timerExtension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    sceneProgram = program(scene); compositeProgram = program(composite);
    worker = new Worker('./physics-worker.js', { type: 'module' });
    workerTimeout = setTimeout(() => fail('The light-path calculation took too long. Reload this page to try again.'), 30000);
    worker.onerror = event => { if (token === generation) fail(`The light-path calculation failed: ${event.message}. Serve the app over local HTTP, rather than opening the HTML file directly.`); };
    worker.onmessage = event => {
      if (token !== generation) return;
      if (event.data.error) { fail(event.data.error); return; }
      if (event.data.progress !== undefined) { $('#loading>span:last-child').textContent = `Calculating curved light paths… ${Math.round(event.data.progress * 100)}%`; return; }
      clearTimeout(workerTimeout);
      try {
        pathTexture = texture(TABLE_WIDTH, TABLE_HEIGHT, event.data.paths, gl.RG32F, gl.RG, gl.FLOAT);
        endingTexture = texture(TABLE_HEIGHT, 1, event.data.endings, gl.RG32F, gl.RG, gl.FLOAT);
        resize(); ready = true; $('#loading').hidden = true; $('#error').hidden = true;
        sync(); render(); sampleStart = performance.now(); raf = requestAnimationFrame(animate); worker.terminate();
        window.observatory = { getState: () => ({ ...state, fps, gpuMs, renderWidth: target.width, renderHeight: target.height, adaptiveScale }), gl, render };
      } catch (error) { console.error(error); fail(error.message); }
    };
  } catch (error) { console.error(error); fail(error.message); }
}
sync(); initialize();
