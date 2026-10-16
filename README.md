# TON 618 Observatory

[Open the live observatory](https://v44m4n.github.io/ton618-observatory/)

A local, dependency-free WebGL2 visualization. Double-click **Start.command** on this Mac, or run `npm start` with Node.js 20+ and open http://127.0.0.1:6180. Keep the serving terminal open. Opening `dist/index.html` directly does not work because the light-path worker requires HTTP.

## GitHub Pages

The GitHub Actions workflow in `.github/workflows/pages.yml` tests the physics and publishes the contents of `dist/` to GitHub Pages on every push to `main`. In the repository's Settings → Pages, the publishing source is **GitHub Actions**. The visualization runs entirely in the browser; the local Node server is not needed for the hosted version. The workflow can also be run manually from the Actions tab.

## Explore

Drag or use arrow keys to orbit a full 360° horizontally and vertically, including above and below the disk. The Vertical orbit slider spans a complete circle. Scroll, pinch, or press +/− to change field of view. Press Space to pause, R to reset the view, H to hide the interface. Click Fall into the black hole (or press F) for a NASA-inspired spiral plunge. The camera makes nearly two loops before crossing the horizon. The journey starts in a 360° × 180° all-sky panorama, with a button to switch to perspective. The edges of the panorama stretch like a world map. Scroll, pinch or +/− switches to perspective for zooming. A camera-path inset and a mass-scaled proper-time readout explain the journey; the Journey position slider pauses and revisits any moment. Drag or use arrows to look freely during the journey; F or Look back turns toward the outside sky. Escape or Return to orbit exits. The journey continues to 0.02rs, deep inside the horizon, and ends with a smooth fade to complete darkness. Scrub backward to replay any stage, or return to orbit. Camera presets offer a NASA-inspired 82° view, face-on and edge-on views. Capture opens a PNG preview without the interface, with an explicit Save PNG link. If the embedded browser cannot download, right-click or hold the preview image to save it, or use Safari/Chrome. Science mode exposes clickable educational labels and reduces cinematic color and glow. Model & sources explains assumptions and links to research.

## Physics and limitations

Distances use Schwarzschild horizon radii (rs = 2GM/c²). A static observer is located at 40rs; zoom changes field of view, not observer radius. Inclination is measured from the disk normal. All orbit camera presets use this same observer radius. The plunge camera follows a timelike Schwarzschild geodesic starting at 40rs, with specific energy E=1 and angular momentum L=1.9985rs, just below the marginally bound capture threshold L=2rs. It winds nearly twice before falling through the horizon. The orbital plane follows the starting camera orientation. The view tracks the direction of motion, with independent drag controls for looking around; this guided orientation is not a Fermi-transported camera frame.

A worker precomputes the Schwarzschild null-geodesic equation `u'' + u = 1.5u²`, where `u=rs/r`, using fourth-order Runge–Kutta in orbital angle. The initial derivative comes from the conserved impact parameter and the observer's local ray direction. The 4096 × 1024 RG32F table stores inverse radius and its derivative. A second table stores the escape/capture angle. The shader transforms each ray into its orbital plane and samples up to four disk-plane crossings. Background direction comes from the asymptotic escape angle. This is an independently implemented lookup approach; it does not copy Bruneton's shader or implement its beam-footprint filtering.

The circular-orbit disk extends from Schwarzschild ISCO (3rs) to 12rs. A zero-torque thin-disk flux profile sets a blackbody-inspired palette. The energy-shift factor includes the static observer lapse, emitter circular motion, and photon angular momentum; emitted bolometric radiance scales as g⁴. Disk surface opacity, five-octave procedural turbulence, narrow flowing ribbons, spiral filaments, clumps, visual exposure, and the cinematic palette are artistic approximations. These structures advect with differential circular rotation but are not fluid dynamics. High quality includes more fine-scale texture; Battery attenuates it. Light travel-time delays in the animated texture, detailed radiative transfer, disk self-shadowing, fluid dynamics, full spectral blackbody integration, Kerr rotation, and cosmological redshift are not modeled.

The 66-billion-solar-mass reference is the approximate Hβ-based mass scale associated with Shemmer et al. (2004), not a unique settled measurement. Derived values use G=6.67430e−11 SI, M☉=1.98847e30 kg, c=299792458 m/s, AU=149597870700 m. rs≈1303 AU and the horizon diameter light-crossing time≈15.05 days. One rs/c≈650,165 seconds; animation advances 7.7 natural time units per real second (approximately 500,000×). The background is a procedural illustrative starfield, not the measured environment around TON 618.

Finite table sampling limits photon subrings near the critical curve; geodesics winding beyond 4π are truncated. Disk bands use an approximate projected phase-footprint filter to reduce flicker; disk features and starfield lack full relativistic beam-footprint filtering. The image is a physically informed educational simulation, not a reconstruction of TON 618's observed appearance.

## Plunge physics

The moving-observer renderer uses a Painlevé–Gullstrand (PG) rain frame, regular at the future event horizon, plus a local Lorentz boost to the curved infaller. For E=1 and specific angular momentum L, its worldline satisfies dr/dτ = −sqrt(1−(1−1/r)(1+L²/r²)) and dφ/dτ=L/r². The PG-frame four-velocity follows from its conserved energy and angular momentum. A rationalized expression for u^T avoids division by zero at the horizon. The CPU worldline uses small RK4 proper-time steps, precomputed into a playback timeline with interpolation for seeking.

For a local backward ray n, the Lorentz boost converts (−1,n) into the PG rain frame. If the resulting past time component is −ω and spatial component is k, then the coordinate spatial tangent is k + sqrt(1/r) ω er. The future-directed photon Killing energy is Eγ = ω + sqrt(1/r) dot(k,er). Rays follow x'' = −1.5 Lγ² x / r⁵, integrated using adaptive fourth-order Runge–Kutta. Circular-disk emission uses g = sqrt(1−1.5/r_em)/(Eγ−ΩLγ_y). This incorporates the observer's aberration and energy shift, including tangential motion. Exterior stars have an approximate, capped frequency-independent intensity shift; their spectrum is not integrated.

The approximately 36.7-second playback advances proper time at a radius-dependent accelerated rate so the approach remains inspectable. Interior playback slows as radius decreases, preserving several seconds of descent after the horizon. Adaptive proper-time steps limit fractional radius changes so the timelike solver remains finite near the center; the ray solver also permits much smaller affine steps in the deep interior. It does not represent elapsed physical seconds. The camera's own time readout uses τ × rs/c at the TON 618 reference mass. The transition into the moving camera changes apparent angles, since it already has infall and tangential velocity at 40rs. The path inset is a view in the camera's orbital plane that zooms in as radius decreases. It is not a view of the accretion disk plane.

The worldline continues to a numerical endpoint at 0.02rs, before the singularity at r=0. Light still arrives after crossing the horizon. A cinematic camera-signal envelope fades the final image smoothly from full strength at 0.12rs to exactly black at 0.02rs, after tone mapping and glow, so exposure, rendering quality, projection and viewing direction cannot brighten the completed view. The ending represents loss of the imagined camera signal, not a claim that all incoming light vanishes at a particular radius or a calculation of what the singularity looks like. The final black image remains until the user rewinds or returns to orbit. Negative Killing-energy rays in the interior are rendered dark because the eternal white-hole region is omitted from this illustrative collapse-inspired scene. The bounded ray-step count and finite precision limit near-critical rays. The return button restores orbit mode; it is a visualization control, not a physically possible escape.

## Performance

In orbit mode, the approximately 32 MiB lookup table is computed off the main thread once. GPU work per frame uses a few lookup samples rather than per-pixel geodesic integration. An HDR target and a restrained multi-scale glow pass provide the image. No runtime dependencies, external textures, network requests, or particle systems are needed.

In orbit mode, Battery targets 30 fps; Balanced and High target 60 fps. Plunge mode targets 30 fps with a smaller rendering target because it integrates moving-observer rays rather than sampling the fixed-radius table. These targets are not a guarantee. Internal rendering resolution adapts gradually to GPU timing when available, with frame cadence as fallback. Retina device scale is capped at 1.5. Battery caps internal width at 1100, Balanced at 1600, High at 2400. Pausing stops redundant draws; hidden tabs stop their animation loop. Reduced-motion users start paused. WebGL context restoration rebuilds GPU resources. Use the on-screen frame-time readings to assess sustained performance on your Mac.

## Project layout

`dist/index.html` and `style.css`: accessible responsive interface.
`dist/app.js`: renderer, camera interaction, adaptive quality and lifecycle.
`dist/geodesics.js` and `physics-worker.js`: geodesic solver and lookup generation. `dist/freefall.js`: camera basis, curved worldline, seekable flight timeline and a CPU ray integrator for validation.
`dist/shaders.js`: curved-ray disk/sky rendering and HDR compositing.
`serve.mjs`: local-only static server. `test/physics.test.mjs`: physical reference checks.

The planned React/Three.js shell was simplified to native browser modules and WebGL2 because this single-view renderer does not need a scene graph. There is no build or installation step.

## Visual reference

The orange disk, illustrative galaxy, all-sky projection, looping flight and camera-track inset are inspired by [NASA Simulation’s Plunge Into a Black Hole: Explained](https://youtu.be/chhcwk4-esM), by NASA Goddard (J. Schnittman and B. Powell). This independently implemented approximation uses no video frames, textures or code from their renderer. Their reference film depicts a 4.3-million-solar-mass black hole; we retain TON 618’s much larger reference mass and scale the educational readouts accordingly. We do not reproduce NASA’s exact trajectory, full ray tracing, deep interior sequence, supercomputer detail, or film timing. The simulation stays local and interactive.

## Sources

- [Shemmer et al. (2004), near-infrared quasar spectroscopy](https://arxiv.org/abs/astro-ph/0406559)
- [Bruneton (2020), Real-time High-Quality Rendering of Non-Rotating Black Holes](https://arxiv.org/abs/2010.08735)
- [Hamilton, journey into a Schwarzschild black hole](https://jila.colorado.edu/~ajsh/courses/insidebh/schw.html)
- [NASA reference visualization and explanation](https://svs.gsfc.nasa.gov/14576)
- [NASA black-hole overview](https://science.nasa.gov/universe/black-holes/)

Run physical reference checks with `npm test`.
