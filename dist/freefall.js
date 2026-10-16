// Horizon radii and rs/c time units. Playback reparameterizes proper time.
export const FALL_END_RADIUS = .02;
export const SIGNAL_FADE_RADIUS = .12;
// Cinematic loss of camera signal near the center, independent of exposure.
export function flightSignal(radius) {
  if (radius <= FALL_END_RADIUS) return 0;
  if (radius >= SIGNAL_FADE_RADIUS) return 1;
  const t = Math.log(radius / FALL_END_RADIUS) / Math.log(SIGNAL_FADE_RADIUS / FALL_END_RADIUS);
  return t*t*(3-2*t);
}
// Just below the marginally bound capture threshold L=2rs (specific energy=1).
export const FLIGHT_L = 1.9985;
export function wrapDegrees(angle) { return ((angle % 360) + 360) % 360; }
export function orbitalBasis(polarDegrees, azimuth) {
  const i = polarDegrees * Math.PI / 180;
  return {
    er: [Math.sin(i) * Math.sin(azimuth), Math.cos(i), Math.sin(i) * Math.cos(azimuth)],
    right: [Math.cos(azimuth), 0, -Math.sin(azimuth)],
    up: [-Math.cos(i) * Math.sin(azimuth), Math.sin(i), -Math.cos(i) * Math.cos(azimuth)]
  };
}
export function fallingBasis(basis, yaw, pitch) {
  const f = basis.er.map((e, i) => -e * Math.cos(yaw) + basis.right[i] * Math.sin(yaw));
  return {
    forward: f.map((e, i) => e * Math.cos(pitch) + basis.up[i] * Math.sin(pitch)),
    right: basis.right.map((e, i) => e * Math.cos(yaw) + basis.er[i] * Math.sin(yaw)),
    up: basis.up.map((e, i) => e * Math.cos(pitch) - f[i] * Math.sin(pitch))
  };
}
export function advanceFall(radius, dt) {
  // Exact radial proper-time solution, with a cinematic rate proportional to r^1.5.
  const properDelta = .22 * radius ** 1.5 * dt;
  return Math.max(FALL_END_RADIUS, Math.max(0, radius ** 1.5 - 1.5 * properDelta) ** (2 / 3));
}
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const norm = v => Math.sqrt(dot(v, v));
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
export function radialRate(r, angularMomentum = FLIGHT_L) {
  return -Math.sqrt(Math.max(0, 1 - (1 - 1/r) * (1 + angularMomentum**2/r**2)));
}
export function flightObserver(radius, er, tangent, angularMomentum = FLIGHT_L) {
  const flow = Math.sqrt(1/radius), ur = radialRate(radius, angularMomentum);
  const a = 1 + angularMomentum**2/radius**2;
  // Rationalized u^T in horizon-regular PG coordinates; finite at r=1.
  const gamma = (1 + flow*flow*a) / (1 - flow*ur);
  const velocity = er.map((v,i) => v * (ur/gamma + flow) + tangent[i] * angularMomentum / (radius*gamma));
  return { gamma, velocity, radialRate: ur };
}
export function flightFrame(entry, angle, radius) {
  const er = entry.er.map((v,i) => v*Math.cos(angle) + entry.right[i]*Math.sin(angle));
  const tangent = entry.right.map((v,i) => v*Math.cos(angle) - entry.er[i]*Math.sin(angle));
  const observer = flightObserver(radius, er, tangent);
  const heading = observer.velocity.map(v => v / norm(observer.velocity));
  return { er, tangent, observer, view: { er: heading.map(v => -v), right: cross(heading, entry.up), up: entry.up } };
}
export function advanceFlight(flight, dt, angularMomentum = FLIGHT_L) {
  let {radius: r, angle, properTime} = flight;
  // Slow the interior in playback time, while preserving the same worldline.
  const pace = r < 1 ? .85*r**2.5/(3-2*r) : .20*r**1.5+.65;
  let remaining = pace * Math.max(0,dt);
  const rate = radius => [radialRate(radius, angularMomentum), angularMomentum/radius**2];
  for (let i=0;i<4096 && remaining>0 && r>FALL_END_RADIUS;i++) {
    // Resolve the rapidly increasing radial speed without stepping through r=0.
    const h = Math.min(remaining,.025,.02*r/Math.max(-radialRate(r,angularMomentum),1e-12));
    const a=rate(r), b=rate(r+h*a[0]/2), c=rate(r+h*b[0]/2), d=rate(r+h*c[0]);
    const dr = h*(a[0]+2*b[0]+2*c[0]+d[0])/6;
    const fraction = Math.min(1, (r-FALL_END_RADIUS)/Math.max(-dr,1e-15));
    r += dr*fraction;
    angle += h*(a[1]+2*b[1]+2*c[1]+d[1])/6*fraction;
    properTime += h*fraction;
    remaining -= h;
    if (r <= FALL_END_RADIUS*(1+1e-12)) r=FALL_END_RADIUS;
  }
  return {radius: Math.max(FALL_END_RADIUS,r), angle, properTime};
}
export function createFlightTrajectory(step = 1/60) {
  const frames = [{radius:40,angle:0,properTime:0,elapsed:0}];
  while(frames.at(-1).radius>FALL_END_RADIUS && frames.length<12000) {
    const last=frames.at(-1);
    frames.push({...advanceFlight(last,step),elapsed:last.elapsed+step});
  }
  return frames;
}
export function sampleFlight(frames, elapsed) {
  const index=Math.min(frames.length-1,Math.max(0,elapsed/frames[1].elapsed));
  const a=frames[Math.floor(index)],b=frames[Math.min(frames.length-1,Math.floor(index)+1)],t=index%1;
  return {radius:a.radius+(b.radius-a.radius)*t,angle:a.angle+(b.angle-a.angle)*t,properTime:a.properTime+(b.properTime-a.properTime)*t};
}
export function initialPastRay(position, localDirection, observerVelocity = [0,0,0]) {
  const r = norm(position), er = position.map(x => x / r), flow = Math.sqrt(1 / r);
  const beta2 = dot(observerVelocity,observerVelocity), gamma=1/Math.sqrt(1-beta2);
  const projected=dot(observerVelocity,localDirection);
  const omega=gamma*(1-projected);
  const boost = beta2>1e-12 ? (gamma-1)*projected/beta2-gamma : 0;
  const spatial = localDirection.map((v,i)=>v+boost*observerVelocity[i]);
  const velocity = spatial.map((v,i)=>v+flow*omega*er[i]);
  return { position: [...position], velocity, energy: omega+flow*dot(spatial,er), angularMomentum: cross(position, velocity) };
}
export function integratePastRay(position, localDirection, precision = .035, observerVelocity = [0,0,0]) {
  const ray = initialPastRay(position, localDirection, observerVelocity);
  let x = ray.position, v = ray.velocity;
  const l2 = dot(ray.angularMomentum, ray.angularMomentum);
  const acceleration = p => { const r2 = dot(p, p); const k = -1.5 * l2 / (r2 * r2 * Math.sqrt(r2)); return p.map(c => c * k); };
  let maxEnergyError = 0;
  for (let step = 0; step < 1600; step++) {
    const r = norm(x);
    if (ray.energy <= 0 || r < .005) return { escaped: false, maxEnergyError, ...ray };
    if (r<1 && dot(x,v)<0) return {escaped:false,maxEnergyError,...ray};
    if (r > 80) return { escaped: true, direction: v.map(c => c / norm(v)), maxEnergyError, ...ray };
    const h = Math.min(1.5, Math.max(1e-8, precision * r / Math.max(norm(v), .15)));
    const a=acceleration(x);
    const v2=v.map((c,i)=>c+a[i]*h/2),a2=acceleration(x.map((c,i)=>c+v[i]*h/2));
    const v3=v.map((c,i)=>c+a2[i]*h/2),a3=acceleration(x.map((c,i)=>c+v2[i]*h/2));
    const v4=v.map((c,i)=>c+a3[i]*h),a4=acceleration(x.map((c,i)=>c+v3[i]*h));
    x=x.map((c,i)=>c+h/6*(v[i]+2*v2[i]+2*v3[i]+v4[i]));
    v=v.map((c,i)=>c+h/6*(a[i]+2*a2[i]+2*a3[i]+a4[i]));
    const rr = norm(x), radial = dot(x, v) / rr;
    const e2 = radial * radial + (1 - 1 / rr) * l2 / (rr * rr);
    maxEnergyError = Math.max(maxEnergyError, Math.abs(e2 - ray.energy ** 2));
  }
  return { escaped: false, truncated: true, maxEnergyError, ...ray };
}
