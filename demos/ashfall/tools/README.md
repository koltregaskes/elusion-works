# Ashfall measurement tools

Ashfall has no art assets to look at and no sound files to open, so the only way to judge a
change is to render the real thing and measure it. Every one of these tools exists because a
plausible-sounding change was made without measuring and turned out to be wrong.

They are dev-only. Nothing in `demos/ashfall/` imports them and nothing ships them.

## Prerequisites

```bash
npm i -D playwright          # or set PLAYWRIGHT_PATH to an existing install
pip install pillow numpy     # only for the histogram/spectrogram helpers
```

A static server must be serving the **repo root** (not the demo folder) on port 8123:

```bash
python3 -m http.server 8123        # single-threaded; fine for one capture at a time
```

Beware: a single-threaded server starves a Playwright page that pulls ~40 ES modules at once,
and the failure mode is silent — the screenshot succeeds and contains the *loading screen*.
If frames come back looking like the title card, that is why. Use a threading server for
concurrent work.

## The tools

| File | What it answers |
|---|---|
| `capture.mjs` | What does the game actually look like right now? |
| `gameplay-battery.mjs` | Did I break the game? (13 checks: movement, firing, reload, AI, errors) |
| `audio-scene.mjs` | What does a real firefight sound like through the real master bus? |
| `audio-voices.mjs` | Per-voice envelope and spectrum for all 59 sounds, in isolation |
| `material-probe.mjs` | Which materials are configured in a way that renders black? |
| `spectrogram.py` | Renders a `.wav` as a log-frequency spectrogram you can look at |

### capture.mjs

```bash
node capture.mjs <outdir> <quality> [vantage ...]
# e.g.
node capture.mjs shots high yard depot terraces
```

Vantages are defined in `src/main.js` (`VANTAGES`): `yard crane depot depotIn terraces
terracesUp sunline containers wide gunclose yardBack depotBack`.

Rendering in CI/containers is **software** (SwiftShader), so a single 960×540 frame takes
**3–8 minutes** and a 1280×720 frame can take 10+. Run one capture at a time. On a real GPU
this is instant.

Read the resulting PNG and *look at it*. Then measure it:

```bash
python3 -c "
from PIL import Image; import numpy as np
im=np.asarray(Image.open('shots/yard.png').convert('RGB')).astype(np.float32)
l=(0.2126*im[...,0]+0.7152*im[...,1]+0.0722*im[...,2]).flatten()
print('max',l.max(),'mean',round(l.mean(),1),'median',np.percentile(l,50))
print('below16',round((l<16).mean()*100,1),'%  above240',round((l>240).mean()*100,2),'%  stdev',round(l.std(),1))"
```

**A frame that never exceeds code ~240 has no highlights and will read as flat no matter what
the grade does.** That single measurement is what identified the core rendering problem.

### gameplay-battery.mjs

```bash
node gameplay-battery.mjs      # expect "13/13 checks passed"
```

Run this after every change. It catches boot failures, shader compile errors and console
errors, which is most of what actually goes wrong.

### audio-scene.mjs

```bash
node audio-scene.mjs <scene> [outdir]
# scenes: single | fullauto | firefight | reload | walk | ambience
NOAMB=1 node audio-scene.mjs single     # one-shots only, ambience bed suppressed
PORT=8124 node audio-scene.mjs firefight  # render against a different server
```

Renders scripted gameplay through the **real** bus chain (bus compressor → soft clip → limiter
→ master gain) into an `OfflineAudioContext`, writes a `.wav` plus a `.json` of level and crest
metrics. This is the harness that matters: measuring voices in isolation is exactly the
condition under which the master bus and the ambience bed do nothing, which is how a badly
mixed game passes every per-voice test.

Octave-band energy, which is the measurement that found both audio faults:

```bash
python3 -c "
import wave, numpy as np
w=wave.open('audio/ambience.wav','rb'); n=w.getnframes(); sr=w.getframerate()
d=np.frombuffer(w.readframes(n),dtype=np.int16).astype(np.float32)/32768.0
x=d.reshape(-1,2).mean(axis=1)[int(2.5*sr):]
X=np.abs(np.fft.rfft(x*np.hanning(len(x)))); f=np.fft.rfftfreq(len(x),1/sr)
print('RMS dBFS', round(20*np.log10(np.sqrt((x**2).mean())),2)); tot=(X**2).sum()
for a,b in zip([20,63,125,250,500,1000,2000,4000,8000,16000],[63,125,250,500,1000,2000,4000,8000,16000,22050]):
    m=(f>=a)&(f<b); print(f'{a:>5}-{b:<5} {10*np.log10((X[m]**2).sum()/tot):7.1f} dB')"
```

**Single shots vary by up to ±9 dB per octave from the deliberate per-shot jitter.** Always
average 8+ shots before concluding anything about a weapon's spectrum.
