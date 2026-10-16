import test from 'node:test';
import assert from 'node:assert/strict';
import { traceRay, CRITICAL_B, MAX_PHI, TABLE_WIDTH } from '../dist/geodesics.js';
import { orbitalBasis, fallingBasis, initialPastRay, integratePastRay, advanceFall, FALL_END_RADIUS, FLIGHT_L, flightObserver, createFlightTrajectory, sampleFlight } from '../dist/freefall.js';

test('Schwarzschild capture boundary matches analytic critical impact parameter', () => {
  for (const offset of [.1, .01, .002]) {
    assert.equal(traceRay(CRITICAL_B - offset).captured, true);
    assert.equal(traceRay(CRITICAL_B + offset).captured, false);
  }
});
test('escaped ray has a turning point outside the photon sphere', () => {
  const ray = traceRay(3);
  assert.equal(ray.captured, false);
  assert.ok(ray.minRadius > 1.5);
  const u = 1 / ray.minRadius;
  assert.ok(Math.abs(u * u - u * u * u - 1 / 9) < .0001);
});
test('angular solver converges at table resolution away from separatrix', () => {
  const step = MAX_PHI / (TABLE_WIDTH - 1);
  for (const b of [2.61, 3, 5, 12, 25]) {
    const coarse = traceRay(b, step), fine = traceRay(b, step / 4);
    assert.equal(coarse.captured, fine.captured);
    assert.ok(Math.abs(coarse.angle - fine.angle) < .0005, `b=${b}`);
  }
});
test('weak-field deflection approaches 2rs/b for a remote observer', () => {
  const b = 1000, radius = 1e7;
  const angle = traceRay(b, .001, radius).angle;
  const deflection = angle + Math.asin(b / radius) - Math.PI;
  assert.ok(Math.abs(deflection - 2 / b) / (2 / b) < .005);
});
test('reference mass derives consistent horizon scale and time', () => {
  const rs = 2 * 6.67430e-11 * 66e9 * 1.98847e30 / 299792458 ** 2;
  assert.ok(Math.abs(rs / 149597870700 - 1303) < 1);
  assert.ok(Math.abs(2 * rs / 299792458 / 86400 - 15.05) < .03);
});

test('camera remains orthonormal and continuous through both poles and a full circle', () => {
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  for (const angle of [0, 90, 180, 270, 360, -1, 721]) {
    const basis = orbitalBasis(angle, .4);
    const view = fallingBasis(basis, 2.7, 4.1);
    for (const v of [basis.er, basis.up, basis.right, view.forward, view.up, view.right]) assert.ok(Math.abs(dot(v, v) - 1) < 1e-12);
    assert.ok(Math.abs(dot(view.forward, view.up)) < 1e-12);
    assert.ok(Math.abs(dot(view.forward, view.right)) < 1e-12);
  }
  const first = orbitalBasis(0, .4), last = orbitalBasis(360, .4);
  first.er.forEach((v, i) => assert.ok(Math.abs(v - last.er[i]) < 1e-12));
});
test('infalling tetrad produces null rays and energy invariants across the horizon', () => {
  for (const r of [40, 3, 1.01, 1, .82]) {
    for (const q of [-1, -.6, 0, .6, 1]) {
      const ray = initialPastRay([0, 0, r], [Math.sqrt(1-q*q), 0, q]);
      const l2 = ray.angularMomentum.reduce((s, v) => s+v*v, 0);
      const e2 = ray.velocity[2] ** 2 + (1-1/r)*l2/r**2;
      assert.ok(Math.abs(e2-ray.energy**2)<1e-12);
    }
  }
});
test('outward-looking infaller receives exterior light even inside the horizon', () => {
  for (const r of [1.1, 1, .82]) {
    const ray = integratePastRay([0, 0, r], [0, 0, 1]);
    assert.equal(ray.escaped, true);
    assert.ok(ray.maxEnergyError < 1e-10);
  }
  assert.equal(integratePastRay([0, 0, .82], [0, 0, -1]).escaped, false);
});
test('numerical plunge rays preserve Schwarzschild energy and converge', () => {
  for (const q of [-.4, 0, .4]) {
    const n = [Math.sqrt(1-q*q), 0, q];
    const ray = integratePastRay([0, 0, 4], n);
    const reference = integratePastRay([0, 0, 4], n, .00875);
    assert.equal(ray.escaped, reference.escaped);
    assert.ok(ray.maxEnergyError < .002);
    if (ray.escaped) assert.ok(ray.direction.every((v,i)=>Math.abs(v-reference.direction[i])<.003));
  }
});
test('fall playback crosses the horizon and stops before the singularity', () => {
  let r = 40;
  for (let frame = 0; frame < 1000; frame++) { const next = advanceFall(r, 1/30); assert.ok(next<=r); r=next; }
  assert.equal(r, FALL_END_RADIUS);
  assert.ok(r<1 && r>0);
});


test('curved infaller tetrad is timelike and conserves energy and angular momentum at the horizon', () => {
  for (const r of [40, 3, 2, 1.01, 1, .82]) {
    const {gamma, velocity} = flightObserver(r, [0,0,1], [1,0,0]);
    const beta2=velocity.reduce((s,v)=>s+v*v,0);
    assert.ok(beta2<1);
    assert.ok(Math.abs(gamma**2*(1-beta2)-1)<1e-12);
    assert.ok(Math.abs(gamma*(1-Math.sqrt(1/r)*velocity[2])-1)<1e-12);
    assert.ok(Math.abs(r*gamma*velocity[0]-FLIGHT_L)<1e-12);
    const radial=flightObserver(r,[0,0,1],[1,0,0],0);
    assert.ok(radial.velocity.every(v=>Math.abs(v)<1e-12));
  }
});
test('Lorentz-boosted observer rays preserve the null energy invariant', () => {
  for (const r of [40,3,2,1.01,1,.82]) {
    const observer=flightObserver(r,[0,0,1],[1,0,0]);
    for (const q of [-1,-.6,0,.6,1]) {
      const ray=initialPastRay([0,0,r],[Math.sqrt(1-q*q),0,q],observer.velocity);
      const l2=ray.angularMomentum.reduce((s,v)=>s+v*v,0);
      const e2=ray.velocity[2]**2+(1-1/r)*l2/r**2;
      assert.ok(Math.abs(e2-ray.energy**2)<1e-11);
    }
  }
});
test('near-critical worldline winds almost twice, crosses the horizon and converges with timestep', () => {
  const coarse=createFlightTrajectory(1/30),fine=createFlightTrajectory(1/120);
  for (let i=1;i<coarse.length;i++) {
    assert.ok(coarse[i].radius<=coarse[i-1].radius);
    assert.ok(coarse[i].angle>coarse[i-1].angle);
    assert.ok(coarse[i].properTime>coarse[i-1].properTime);
  }
  const end=coarse.at(-1),reference=fine.at(-1);
  assert.equal(end.radius,FALL_END_RADIUS);
  assert.ok(end.angle/(2*Math.PI)>1.9 && end.angle/(2*Math.PI)<2);
  assert.ok(Math.abs(end.angle-reference.angle)<.0003);
  assert.ok(Math.abs(end.properTime-reference.properTime)<.002);
  assert.ok(coarse.some(f=>f.radius>1) && coarse.some(f=>f.radius<1));
  assert.deepEqual(sampleFlight(coarse,-1),{radius:40,angle:0,properTime:0});
  assert.deepEqual(sampleFlight(coarse,999),{radius:end.radius,angle:end.angle,properTime:end.properTime});
  const middle=sampleFlight(coarse,end.elapsed*.7);
  assert.ok(middle.radius>FALL_END_RADIUS && middle.radius<40);
});


test('moving renderer resolves capture at the analytic separatrix without singularity artifacts', () => {
  const r=4;
  for (const offset of [-.001,-.0001,.0001,.001]) {
    const b=CRITICAL_B+offset,s=b*Math.sqrt(1-1/r)/r;
    const ray=integratePastRay([0,0,r],[s,0,-Math.sqrt(1-s*s)],.055,[0,0,Math.sqrt(1/r)]);
    assert.equal(ray.escaped,offset>0);
    assert.ok(!ray.truncated);
    assert.ok(ray.maxEnergyError<.00003);
  }
});
