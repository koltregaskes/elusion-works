# Teardown kit

Shared parts for Elusion Works teardown simulators (the study-model style first built for
`demos/hoover-dam/teardown/`). The folder starts with `_` so the demos index and the
"every demo has an index.html" CI check skip it; it still deploys with the rest of `demos/`.

| File | What it gives a new machine |
| --- | --- |
| `stage.js` | `Stage`: paper backdrop, key/fill/rim lights, shadow-catcher floor, turntable with a degree ring, RoomEnvironment reflections, GTAO + bloom + vignette, quality tiers (`setQuality(0..2)`). Exports `INK` and `ACCENT`. |
| `materials.js` | `MAT.shell / graphite / orange / steel` and `addInk(mesh)` / `inked(mesh)` for thin ink edges. |

## Use

The page's import map must resolve `three` and `three/addons/` (the Hoover pages use
`../vendor/` under `demos/hoover-dam/`). Then:

```js
import { Stage, ACCENT } from '../../_teardown-kit/stage.js';
import { MAT, inked } from '../../_teardown-kit/materials.js';
const stage = new Stage(document.querySelector('#scene'));
stage.pivot.add(inked(new THREE.Mesh(geometry, MAT.shell())));
```

## Rules the kit assumes

- One model drives every part and panel; nothing is keyframed by hand.
- Orange (`ACCENT`) only marks the part that is working right now.
- Review stills at each operation-log beat before shipping.

Still to extract when a second machine needs them: the operation log, console cards,
drafting overlay and callouts (currently in `demos/hoover-dam/teardown/src/main.js`).
