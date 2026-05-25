// acts.jsx — five act components for the horizontal film strip
const { useEffect: useEffectA, useRef: useRefA, useState: useStateA, useMemo: useMemoA, useCallback: useCallbackA } = React;

/* ============================================================
   ACT I — OPENING TITLE
   ============================================================ */
function ActHero({ onLaunch }) {
  return (
    <section className="act hero" data-act="hero" data-screen-label="Act I — Opening Title">
      <div className="hero-bg-slot">
        <image-slot
          id="hero-bg"
          shape="rect"
          placeholder="Optional · drop a film still here for a subtle backdrop"
        ></image-slot>
      </div>

      <header className="act-head">
        <div className="num">I</div>
        <div className="title" data-text>The Opening Title<br/>
          <span className="meta" style={{ display: 'inline-block', marginTop: 4 }}>A film by you · Roll 01 · Take 04</span>
        </div>
        <div className="crumbs">
          <span>21:9 LETTERBOX</span>
          <span style={{ color: 'var(--copper)' }}>SHOT 001 / 142</span>
          <span>F2.8 · 1/50s · ISO 400</span>
        </div>
      </header>

      <div className="hero-center">
        <h1 className="hero-title" data-text>
          <span className="frag">Chronicles</span>
          <span className="frag">of <em>Bone</em>.</span>
          <span className="frag label">A motion picture in six chapters</span>
        </h1>
        <div className="hero-right">
          <div className="meta meta-strong" data-text>// LOGLINE</div>
          <p className="hero-sub" data-text>
            Five thousand years after the last city fell, a lone cartographer follows
            impossible footprints into the dust — and finds a copper-boned colossus
            walking out of memory. A study in how one director can conduct an entire
            lost world, frame by frame.
          </p>

          <div className="hero-cta-row">
            <MagneticButton onClick={onLaunch}>Enter the Film</MagneticButton>
            <a className="secondary-cta" href="#blade" data-hot>
              <span className="play" aria-hidden="true" />
              90-Second Trailer
            </a>
          </div>
        </div>
      </div>

      <Ticker />

      <div className="hero-foot">
        <div>
          <div className="meta" style={{ marginBottom: 6 }}>Written · Directed · Edited by a single hand</div>
          <div className="meta" style={{ color: 'var(--ink-faint)' }}>Principal photography · MMXXVI</div>
        </div>
        <div className="hero-stat">
          <div className="num">142</div>
          <div className="lbl">Cinematic Shots</div>
        </div>
        <div className="hero-stat">
          <div className="num">34<small style={{ fontSize: '0.5em', color: 'var(--ink-dim)', marginLeft: 4 }}>min</small></div>
          <div className="lbl">Final Runtime</div>
        </div>
        <div className="hero-stat">
          <div className="num">21<small style={{ fontSize: '0.5em', color: 'var(--ink-dim)', marginLeft: 4 }}>:9</small></div>
          <div className="lbl">Anamorphic Aspect</div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   ACT II — ANATOMY OF A SHOT
   ============================================================ */
const BLADES = [
  {
    id: 1, x: 50, y: 22,
    cat: 'Cinematography',
    title: 'The Low-Angle Colossus',
    desc: 'A 12mm anamorphic camera placed six metres below the figure, dollied on a slow forward push — establishing the scale of the bone colossus against the receding sandscape.',
    note: '$ shot --camera\n  12mm anamorphic. Low angle. Dolly-in 0.4 m/s.\n  Subject occupies central third, head crops top of frame.\n  Shot on Alexa 65 emulation. Shallow f/2.0 isolation.',
    params: { aspect: '21:9', focal: '12mm', motion: 'DOLLY-IN', lens: 'ANAMORPHIC' }
  },
  {
    id: 2, x: 50, y: 60,
    cat: 'Lighting',
    title: 'Copper Keylight @ Golden Hour',
    desc: 'A single high-contrast key sweeps in at 14° elevation, refracted through micro-particulate dust to produce volumetric god-rays that wrap the colossus in molten light.',
    note: '$ shot --light\n  Single hard key, 14° elevation, 2400K.\n  Heavy atmospheric diffusion.\n  Subsurface bounce off bone surfaces.\n  Negative fill camera-right.',
    params: { kelvin: '2400K', angle: '14°', diffusion: 'HEAVY', mode: 'VOLUMETRIC' }
  },
  {
    id: 3, x: 22, y: 78,
    cat: 'Atmospherics',
    title: 'Approaching Dust Storm',
    desc: 'Layered particulates: a coarse pass for the storm body, a finer pass for the embered micro-particles drifting through the light shafts. The wind reads as a character.',
    note: '$ shot --atmos\n  Approaching sandstorm. Density curve 0–0.84.\n  Three drift layers: coarse / mid / ember.\n  Wind reads camera-left to camera-right.\n  Match-move with the colossus stride.',
    params: { layers: '3', density: '0.84', wind: '12 KT', res: '8K' }
  },
  {
    id: 4, x: 80, y: 45,
    cat: 'Subject Design',
    title: 'Copper-Bone Anatomy',
    desc: 'A fourteen-metre humanoid skeleton designed down to the cortical patina, the molten luminescence inside the femoral shafts, and the wind-polished orbital sockets.',
    note: '$ shot --subject\n  14m humanoid colossus, oxidised copper patina.\n  Internal amber luminescence at joints.\n  Wind-polished surfaces, micro-erosion on edges.\n  Weighted silhouette — the bones remember weight.',
    params: { height: '14M', material: 'CU-PATINA', emission: 'MOLTEN', detail: 'HYPERREAL' }
  },
];

function useTypewriter(text, speed = 14) {
  const [out, setOut] = useStateA('');
  useEffectA(() => {
    setOut('');
    if (!text) return;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setOut(text.slice(0, i));
      if (i >= text.length) clearInterval(id);
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return out;
}

function ActDeconstruct() {
  const [active, setActive] = useStateA(2); // start on Lighting
  const blade = BLADES.find(b => b.id === active);
  const typed = useTypewriter(blade ? blade.note : '', 10);

  return (
    <section className="act act-deconstruct" data-act="blade" data-screen-label="Act II — Anatomy of a Shot">
      <header className="act-head">
        <div className="num">II</div>
        <div className="title" data-text>Anatomy of a Shot<br/>
          <span className="meta" style={{ display: 'inline-block', marginTop: 4 }}>Scene 04 · Colossus Rising · the four craft decisions inside a single frame</span>
        </div>
        <div className="crumbs">
          <span>HOVER · PIN</span>
          <span style={{ color: 'var(--copper)' }}>4 DECISIONS</span>
          <span>DIRECTOR'S NOTES · LIVE</span>
        </div>
      </header>

      <div className="deconstruct-grid">
        <div className="frame" data-hot>
          <image-slot
            id="act2-still"
            shape="rect"
            placeholder="Drop the film still for SCN 04 here · or leave for the matte"
            class="frame-slot"
          ></image-slot>
          <div className="keylight" />
          <div className="colossus" />
          <div className="horizon" />
          <div className="dust" />
          <div className="frame-noise" />
          <div className="quad-grid" />
          <div className="crop tl" /><div className="crop tr" /><div className="crop bl" /><div className="crop br" />
          <div className="slate"><span className="clap">▶</span> SCN 04 · TK 04 · CAM A · COLOSSUS RISING</div>
          <div className="tc">01:47:08:12</div>
          <div className="frame-caption" data-text>
            <b>SCN 04 — COLOSSUS RISING.</b>&nbsp; The cartographer's first sighting.
            A bone giant, hip-deep in dust, walks east at the speed of an oncoming storm.
          </div>

          {BLADES.map(b => (
            <button
              key={b.id}
              className={"pin" + (b.id === active ? " is-active" : "")}
              style={{ left: b.x + '%', top: b.y + '%' }}
              onClick={() => setActive(b.id)}
              onMouseEnter={() => setActive(b.id)}
              aria-label={"Decision " + b.id + ": " + b.cat}
              data-hot
            >
              <span className="ring" />
              <span className="ring r2" />
              <span className="dot" />
              <span className="num">0{b.id} · {b.cat.toUpperCase()}</span>
            </button>
          ))}
        </div>

        <div className="blade-panel">
          <div className="blade-head">
            <span className="lbl">DECISION 0{blade.id} / 04</span>
            <span className="idx">SCN 04 · {blade.cat.toUpperCase()}</span>
          </div>
          <div className="blade-body">
            <div className="blade-cat">{blade.cat}</div>
            <div className="blade-title" data-text>{blade.title}</div>
            <div className="blade-desc" data-text>{blade.desc}</div>

            <div className="params">
              {Object.entries(blade.params).map(([k, v]) => (
                <div key={k} className="p"><b>{k.toUpperCase()}</b>{v}</div>
              ))}
            </div>
          </div>
          <div className="terminal">
            <div className="promptline">// DIRECTOR'S NOTES — SCN 04 — TK 04</div>
            <div className="typed">{typed}<span className="caret" /></div>
          </div>
        </div>
      </div>

      <div className="act-foot">
        <span>HOVER / CLICK PINS · EACH IS ONE CRAFT DECISION INSIDE THE SAME FRAME</span>
        <span className="right">Every shot is a stack of decisions. Anatomy makes them visible.</span>
      </div>
    </section>
  );
}

/* ============================================================
   ACT III — UPSCALE COMPARISON LAB
   ============================================================ */
function ActUpscale() {
  const wrapRef = useRefA(null);
  const [split, setSplit] = useStateA(50);
  const draggingRef = useRefA(false);

  const setFromEvent = useCallbackA((e) => {
    const r = wrapRef.current.getBoundingClientRect();
    const x = (e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0].clientX)) - r.left;
    const pct = Math.max(0, Math.min(100, (x / r.width) * 100));
    setSplit(pct);
  }, []);

  useEffectA(() => {
    const onMove = (e) => { if (draggingRef.current) setFromEvent(e); };
    const onUp = () => { draggingRef.current = false; };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [setFromEvent]);

  return (
    <section className="act act-upscale" data-act="upscale" data-screen-label="Act III — Before / After">
      <header className="act-head">
        <div className="num">III</div>
        <div className="title" data-text>Before · After<br/>
          <span className="meta" style={{ display: 'inline-block', marginTop: 4 }}>The raw daily · vs · the finished frame after grade, regrain and upscale</span>
        </div>
        <div className="crumbs">
          <span>DRAG · HANDLE</span>
          <span style={{ color: 'var(--copper)' }}>FINISHING PASS</span>
          <span>1080P → 8192P</span>
        </div>
      </header>

      <div
        ref={wrapRef}
        className="upscale-wrap"
        style={{ '--split': split + '%' }}
        onPointerDown={(e) => { draggingRef.current = true; setFromEvent(e); }}
        data-hot
      >
        <div className="upscale-side left">
          <div className="img" />
          <image-slot
            id="act3-before"
            shape="rect"
            placeholder="Drop the raw daily here · 1080p preferred"
            class="frame-slot"
          ></image-slot>
        </div>
        <div className="upscale-side right">
          <div className="img" />
          <image-slot
            id="act3-after"
            shape="rect"
            placeholder="Drop the finished 8K frame here"
            class="frame-slot"
          ></image-slot>
        </div>

        <div className="upscale-tag left"><b>BEFORE · RAW DAILY</b>SCN 04 · TK 04 · 1080P · BASE PASS</div>
        <div className="upscale-tag right"><b>AFTER · FINISHED</b>GRADE + REGRAIN + 8K UPSCALE</div>

        <div className="upscale-handle" style={{ left: split + '%' }}>
          <div className="knob" />
        </div>

        <div className="upscale-readout">
          {split < 50
            ? `RAW SIDE · ${Math.round(50 - split) * 2}% EXPOSED`
            : `FINISHED SIDE · ${Math.round(split - 50) * 2}% EXPOSED`}
        </div>
      </div>

      <div className="upscale-bar">
        <div className="cell"><div className="k">Resolution Δ</div><div className="v">7.6×<small>linear</small></div></div>
        <div className="cell"><div className="k">Detail Density</div><div className="v">+312%<small>vs raw</small></div></div>
        <div className="cell"><div className="k">Finishing Time</div><div className="v">38m<small>per frame</small></div></div>
        <div className="cell"><div className="k">Final Master</div><div className="v">DCI 4K<small>+ 8K archival</small></div></div>
      </div>
    </section>
  );
}

/* ============================================================
   ACT IV — THE DIRECTOR'S TOOLKIT
   ============================================================ */
// Real, well-known tools. Featured (big) plates are categories the user knows.
const STACK_PLATES = [
  { sym: 'Vo', name: 'Veo', num: '01', cat: 'Motion · Hero Shots', mass: 'PRIMARY', layout: 's-22', primary: true,
    copy: 'Hero motion plates. The colossus walking, the storm rolling.' },
  { sym: 'Gm', name: 'Gemini Omni', num: '02', cat: 'Video Edit · Multi-modal', mass: 'OMNI', layout: 's-11' },
  { sym: 'Mj', name: 'Midjourney v7', num: '03', cat: 'Concept · Stills', mass: 'STILLS', layout: 's-21' },
  { sym: 'To', name: 'Topaz Video AI', num: '04', cat: 'Upscale · Finishing', mass: '8K', layout: 's-12' },
  { sym: 'El', name: 'ElevenLabs', num: '05', cat: 'Voice · Score · Mix', mass: 'AUDIO', layout: 's-21' },
  { sym: 'Gp', name: 'GPT Image · gpt-image-1', num: '06', cat: 'Image Edit · Touch-up', mass: 'EDIT', layout: 's-11' },
  { sym: 'Rw', name: 'Runway Gen-4', num: '07', cat: 'In-betweens · Cuts', mass: 'EDIT', layout: 's-11' },
  { sym: 'Mg', name: 'Magnific', num: '08', cat: 'Detail · Relight', mass: 'POLISH', layout: 's-21' },
  { sym: 'Su', name: 'Suno · Score', num: '09', cat: 'Score · Themes', mass: 'MUSIC', layout: 's-11' },
  { sym: 'Lu', name: 'Luma Dream', num: '10', cat: 'Light · Motion', mass: 'LIGHT', layout: 's-11' },
];

// Lesser-known / supporting — runs along the bottom ticker
const STACK_TICKER = [
  'KLING 2 · CHARACTER PERFORMANCE',
  'PIKA · MOTION POLISH',
  'FLUX KONTEXT · STYLE LOCK',
  'KREA · STORYBOARDING',
  'HIGGSFIELD · PHYSICS SIM',
  'IDEOGRAM · TYPOGRAPHIC PLATES',
  'STABLE VIDEO · REGRAIN',
  'DEFLICKER · TEMPORAL COHERENCE',
  'WAN · INFERENCE QUEUE',
  'LATENT MAGIC · COLOUR SCRIPT',
];

function PlateBig({ p }) {
  return (
    <div className={"plate plate-feature " + p.layout + (p.primary ? " is-primary" : "")}
         data-hot
         onPointerMove={(e) => {
           const r = e.currentTarget.getBoundingClientRect();
           const x = ((e.clientX - r.left) / r.width) * 100;
           const y = ((e.clientY - r.top) / r.height) * 100;
           e.currentTarget.style.setProperty('--px', x + '%');
           e.currentTarget.style.setProperty('--py', y + '%');
           const rx = (y - 50) / 12;
           const ry = (x - 50) / -12;
           e.currentTarget.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg)`;
         }}
         onPointerLeave={(e) => { e.currentTarget.style.transform = ''; }}
    >
      <div className="num">{p.num} · {p.cat.toUpperCase()}</div>
      <div className="mass">{p.mass}<b>{p.sym}</b></div>
      <div className="title" data-text>{p.name}</div>
      {p.copy && <div className="copy" data-text>{p.copy}</div>}
      <div className="meter">
        <span className="on" />
        <span className="on" />
        <span className={p.primary ? "on" : ""} />
        <span className={p.primary ? "on" : ""} />
        <span className={p.primary ? "on" : ""} />
      </div>
    </div>
  );
}

function PlateSmall({ p }) {
  return (
    <div className={"plate " + p.layout}
         data-hot
         onPointerMove={(e) => {
           const r = e.currentTarget.getBoundingClientRect();
           const x = ((e.clientX - r.left) / r.width) * 100;
           const y = ((e.clientY - r.top) / r.height) * 100;
           e.currentTarget.style.setProperty('--px', x + '%');
           e.currentTarget.style.setProperty('--py', y + '%');
           const rx = (y - 50) / 14;
           const ry = (x - 50) / -14;
           e.currentTarget.style.transform = `perspective(800px) rotateX(${rx}deg) rotateY(${ry}deg)`;
         }}
         onPointerLeave={(e) => { e.currentTarget.style.transform = ''; }}
    >
      <div className="num">{p.num}</div>
      <div className="mass">{p.mass}</div>
      <div className="sym">{p.sym}</div>
      <div className="name" data-text>{p.name}</div>
      <div className="cat">{p.cat}</div>
    </div>
  );
}

function ActStack({ variant }) {
  const tickerRow = [...STACK_TICKER, ...STACK_TICKER];
  return (
    <section className="act act-stack" data-act="stack" data-screen-label="Act IV — The Director's Toolkit">
      <header className="act-head">
        <div className="num">IV</div>
        <div className="title" data-text>The Director's Toolkit<br/>
          <span className="meta" style={{ display: 'inline-block', marginTop: 4 }}>Ten instruments the director reached for · with a wider bench below</span>
        </div>
        <div className="crumbs">
          <span>POINTER · TILT</span>
          <span style={{ color: 'var(--copper)' }}>10 + 10 TOOLS</span>
          <span>4 DISCIPLINES</span>
        </div>
      </header>

      <div className={"stack-grid stack-variant-" + variant}>
        {STACK_PLATES.map((p) =>
          p.copy ? <PlateBig key={p.sym} p={p} /> : <PlateSmall key={p.sym} p={p} />
        )}
      </div>

      <div className="stack-bench">
        <div className="bench-lbl">// SUPPORTING BENCH · ALSO ON SET</div>
        <div className="bench-ticker">
          <div className="bench-track">
            {tickerRow.map((t, i) => (
              <span key={i} className="bench-item">
                <span className="dot" />{t}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="stack-foot">
        <div className="cell"><div className="k">Total Tools</div><div className="v">20</div></div>
        <div className="cell"><div className="k">Disciplines</div><div className="v">Motion · Image · Audio · Polish</div></div>
        <div className="cell"><div className="k">Hero Plates</div><div className="v">Veo · Gemini Omni</div></div>
        <div className="cell"><div className="k">Finishing</div><div className="v">Topaz · Magnific</div></div>
        <div className="cell"><div className="k">Director</div><div className="v">One pair of hands</div></div>
      </div>
    </section>
  );
}

/* ============================================================
   ACT V — DIRECTOR'S CUT
   ============================================================ */
const REEL = [
  { n: '01', t: 'A Trail of Footprints',         tc: '00:00 – 03:42', st: 'CUT',     done: true },
  { n: '02', t: 'The Sand Cathedral',            tc: '03:42 – 09:18', st: 'CUT',     done: true },
  { n: '03', t: 'Migration of the Bones',        tc: '09:18 – 14:55', st: 'CUT',     done: true },
  { n: '04', t: 'Colossus Rising',               tc: '14:55 – 22:10', st: 'LOCKED'  },
  { n: '05', t: 'The Copper Hymn',               tc: '22:10 – 27:48', st: 'GRADING' },
  { n: '06', t: 'Last Light, First Memory',      tc: '27:48 – 34:02', st: 'RENDER'  },
];

function ActCut() {
  return (
    <section className="act act-cut" data-act="cut" data-screen-label="Act V — Director's Cut">
      <header className="act-head">
        <div className="num">V</div>
        <div className="title" data-text>The Director's Cut<br/>
          <span className="meta" style={{ display: 'inline-block', marginTop: 4 }}>Closing reel · statement of intent · chapter manifest</span>
        </div>
        <div className="crumbs">
          <span>FINAL ACT</span>
          <span style={{ color: 'var(--copper)' }}>6 CHAPTERS</span>
          <span>34 MIN RUNTIME</span>
        </div>
      </header>

      <div className="cut-grid">
        <div className="cut-left">
          <div className="meta meta-strong">// DIRECTOR'S STATEMENT</div>
          <p className="cut-quote" data-text>
            "I wanted a film that <em>remembered</em> something
            that was never shot. So I gathered the instruments,
            sat down with the bones, and built the light back —
            frame by frame — until it fell exactly where memory said it should."
          </p>
          <div className="cut-attr">
            <div className="av" aria-hidden="true">
              <image-slot id="director-avatar" shape="circle" placeholder="Drop your headshot" class="avatar-slot"></image-slot>
            </div>
            <div>
              <b>THE DIRECTOR</b><br/>
              <span style={{ color: 'var(--ink-faint)' }}>Writer · Director · Editor · MMXXVI</span>
            </div>
          </div>
          <div className="bone-note" data-text>Bones beneath the dust.</div>

          <div className="cut-cta" style={{ marginTop: 12 }}>
            <a className="secondary-cta" data-hot href="#">
              <span className="play" aria-hidden="true" />
              Stream the 34-min Cut
            </a>
            <a className="secondary-cta" data-hot href="#">
              <span className="play" aria-hidden="true" />
              Read the Production Notes
            </a>
            <a className="secondary-cta" data-hot href="#">
              <span className="play" aria-hidden="true" />
              Request a Screening
            </a>
          </div>
        </div>

        <div className="cut-right">
          <div className="reel">
            <div className="reel-head">
              <span className="lbl">// FINAL REEL · CHAPTER MANIFEST</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.28em' }}>R · 6 / 6</span>
            </div>
            <div className="reel-list">
              {REEL.map(r => (
                <div key={r.n} className="reel-row">
                  <span className="n">{r.n}</span>
                  <span className="t">{r.t}</span>
                  <span className="tc">{r.tc}</span>
                  <span className={"st" + (r.done ? " done" : "")}>{r.st}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="act-foot">
        <span>END OF FILM STRIP · LOOP RESETS TO ACT I ON ←</span>
        <span className="right">© MMXXVI · CHRONICLES OF BONE · ALL FRAMES CRAFTED, NONE STOCK</span>
      </div>
    </section>
  );
}

Object.assign(window, { ActHero, ActDeconstruct, ActUpscale, ActStack, ActCut });
