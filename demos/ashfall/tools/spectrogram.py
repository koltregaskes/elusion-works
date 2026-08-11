#!/usr/bin/env python3
"""Render log-frequency spectrograms of the game's audio so they can be looked at.

A real gunshot has a near-vertical broadband onset (energy at every frequency within a
millisecond), a steep high-frequency decay, and a low-frequency body that rings a little
longer. A synthetic one usually shows horizontal banding (filter resonances held too long),
a soft diagonal onset (envelope attack instead of an impulse), or a flat noise rectangle.
"""
import sys, wave, numpy as np
from PIL import Image

def read_wav(p):
    w = wave.open(p, 'rb')
    n = w.getnframes(); sr = w.getframerate(); ch = w.getnchannels()
    d = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    if ch == 2:
        d = d.reshape(-1, 2).mean(axis=1)
    return d, sr

def spectrogram(x, sr, win=1024, hop=128, fmin=40, fmax=18000, height=420):
    w = np.hanning(win)
    frames = 1 + (len(x) - win) // hop
    S = np.empty((win // 2 + 1, frames), dtype=np.float32)
    for i in range(frames):
        seg = x[i*hop:i*hop+win] * w
        S[:, i] = np.abs(np.fft.rfft(seg))
    db = 20*np.log10(S + 1e-8)
    db = np.clip(db, db.max()-85, db.max())
    freqs = np.fft.rfftfreq(win, 1/sr)
    # Resample linear-frequency bins onto a log axis, which is how hearing is laid out.
    logf = np.logspace(np.log10(fmin), np.log10(fmax), height)
    idx = np.searchsorted(freqs, logf).clip(1, len(freqs)-1)
    out = db[idx, :]
    out = (out - out.min()) / max(1e-6, out.max() - out.min())
    return np.flipud(out)

def colourise(a):
    # simple magma-ish ramp so structure is easy to see
    r = np.clip(a*3.0 - 0.2, 0, 1)
    g = np.clip(a*2.2 - 0.8, 0, 1)
    b = np.clip(np.sin(a*np.pi)*0.85 + a*0.3, 0, 1)
    return (np.dstack([r, g, b])*255).astype(np.uint8)

for path in sys.argv[1:]:
    x, sr = read_wav(path)
    # trim to the interesting part: from first energy to 1.2 s later
    e = np.abs(x)
    on = int(np.argmax(e > e.max()*0.002))
    x = x[max(0, on-int(0.01*sr)): on + int(1.2*sr)]
    S = spectrogram(x, sr)
    img = Image.fromarray(colourise(S)).resize((1100, 420), Image.BILINEAR)
    out = path.rsplit('.', 1)[0] + '_spec.png'
    img.save(out)
    pk = 20*np.log10(np.abs(x).max()+1e-9)
    print(f'{path}: {len(x)/sr:.2f}s  peak {pk:.1f} dBFS -> {out}')
