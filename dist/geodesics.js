// rs = 2GM/c² = 1. Schwarzschild null geodesics in their orbital plane:
// u'' + u = 3u²/2, with u = rs/r and angle phi measured from the camera.
// A static observer's local ray angle determines b = r sin(alpha)/sqrt(1-1/r).
export const CAMERA_RADIUS = 40;
export const TABLE_WIDTH = 1024;
export const TABLE_HEIGHT = 4096;
export const MAX_PHI = 4 * Math.PI;
export const MAX_B = CAMERA_RADIUS / Math.sqrt(1 - 1 / CAMERA_RADIUS);
export const CRITICAL_B = Math.sqrt(27) / 2;

export function rk4(u, v, h) {
  const accel = x => -x + 1.5 * x * x;
  const a = accel(u);
  const u2 = u + h * v / 2, v2 = v + h * a / 2;
  const u3 = u + h * v2 / 2, v3 = v + h * accel(u2) / 2;
  const u4 = u + h * v3, v4 = v + h * accel(u3);
  return [u + h * (v + 2 * v2 + 2 * v3 + v4) / 6,
    v + h * (a + 2 * accel(u2) + 2 * accel(u3) + accel(u4)) / 6];
}

export function traceRay(b, step = MAX_PHI / (TABLE_WIDTH - 1), radius = CAMERA_RADIUS) {
  if (b < 0.001) return { captured: true, angle: 0, minRadius: 1 };
  let u = 1 / radius, v = Math.sqrt(Math.max(0, 1 / (b * b) - u * u + u * u * u));
  let angle = 0, maxU = u;
  while (angle < MAX_PHI) {
    const [nextU, nextV] = rk4(u, v, step);
    if (nextU >= 1) return { captured: true, angle: angle + step * (1 - u) / (nextU - u), minRadius: 1 };
    if (nextU <= 0) return { captured: false, angle: angle + step * u / (u - nextU), minRadius: 1 / maxU };
    u = nextU; v = nextV; angle += step; maxU = Math.max(maxU, u);
  }
  return { captured: true, angle: MAX_PHI, minRadius: 1 / maxU, truncated: true };
}

export function buildTables(progress) {
  const paths = new Float32Array(TABLE_WIDTH * TABLE_HEIGHT * 2);
  const endings = new Float32Array(TABLE_HEIGHT * 2);
  const step = MAX_PHI / (TABLE_WIDTH - 1);
  for (let j = 0; j < TABLE_HEIGHT; j++) {
    const b = Math.max(0.00001, MAX_B * j / (TABLE_HEIGHT - 1));
    let u = 1 / CAMERA_RADIUS;
    let v = Math.sqrt(Math.max(0, 1 / (b * b) - u * u + u * u * u));
    let stopped = false;
    endings[j * 2] = MAX_PHI;
    endings[j * 2 + 1] = 1;
    for (let i = 0; i < TABLE_WIDTH; i++) {
      const offset = (j * TABLE_WIDTH + i) * 2;
      paths[offset] = u; paths[offset + 1] = v;
      if (!stopped) {
        const [nu, nv] = rk4(u, v, step);
        if (nu >= 1 || nu <= 0) {
          const captured = nu >= 1;
          const fraction = captured ? (1 - u) / (nu - u) : u / (u - nu);
          endings[j * 2] = (i + Math.max(0, Math.min(1, fraction))) * step;
          endings[j * 2 + 1] = captured ? 1 : 0;
          u = captured ? 1 : 0; v = 0; stopped = true;
        } else { u = nu; v = nv; }
      }
    }
    if (progress && j % 512 === 0) progress(j / TABLE_HEIGHT);
  }
  return { paths, endings };
}
