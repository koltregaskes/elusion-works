/* GOLDEN ENCYCLOPEDIA — shared chrome + behaviours */
(function () {
  'use strict';

  // ---------- Icons (inline SVG strings) ----------
  const SVG = {
    paw: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="9" r="1.6"/><circle cx="10" cy="6" r="1.6"/><circle cx="14" cy="6" r="1.6"/><circle cx="18" cy="9" r="1.6"/><path d="M7 16c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5c0 2-1.7 3.2-3.4 3.2-1.6 0-1.6-1-3.2-1S8.4 19.2 6.7 19.2 5 17.9 5 16.6"/></svg>',
    search: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    arrowSm: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
    arrowLeft: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>',
    play: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4" fill="currentColor"/></svg>',
    download: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>',
    menu: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6 18 18M18 6 6 18"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 6.6a5.4 5.4 0 0 0-7.7 0L12 7.7l-1.1-1.1a5.4 5.4 0 1 0-7.7 7.7l1.1 1.1L12 23l7.7-7.6 1.1-1.1a5.4 5.4 0 0 0 0-7.7z"/></svg>',
    brain: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8 3 3 0 0 0 1 2.3v.6A3 3 0 0 0 7 17a3 3 0 0 0 2 1.8V20a2 2 0 0 0 4 0V4a3 3 0 0 0-4 0z"/><path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 2.8 3 3 0 0 1-1 2.3v.6A3 3 0 0 1 17 17a3 3 0 0 1-2 1.8"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z"/></svg>',
    home: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/></svg>',
    bowl: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18l-1.4 6.2A3 3 0 0 1 16.7 20H7.3a3 3 0 0 1-2.9-2.8z"/><path d="M6 11c1.5-3 4-4 6-4s4.5 1 6 4"/></svg>',
    run: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="5" r="2"/><path d="M5 21l3-5 3 1 1-4 3 3 4-1"/><path d="m9 13 2-3 3 1"/></svg>',
    pulse: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
    brush: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11 18.5 1.5a2 2 0 0 1 3 3L12 14"/><path d="M5 17a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-6-3v3z"/></svg>',
    star: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15 9 22 10 17 15 18 22 12 18 6 22 7 15 2 10 9 9 12 2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.6 7-13a7 7 0 1 0-14 0c0 5.4 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>',
    quote: '<svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor"><path d="M9 7H5a3 3 0 0 0-3 3v8h8v-8H6c0-1.7 1.3-3 3-3V7zm12 0h-4a3 3 0 0 0-3 3v8h8v-8h-4c0-1.7 1.3-3 3-3V7z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 12h14"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M14 9h3V5h-3a4 4 0 0 0-4 4v2H7v4h3v8h4v-8h3l1-4h-4V9z"/></svg>',
    youtube: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23 7.4a3 3 0 0 0-2.1-2.1C19 4.8 12 4.8 12 4.8s-7 0-8.9.5A3 3 0 0 0 1 7.4 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.6a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.4-1.5.5-3 .5-4.6s-.1-3.1-.5-4.6zM10 15.2V8.8L15.5 12 10 15.2z"/></svg>',
    pinterest: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.6 19.3c0-.8 0-1.7.2-2.5l1.3-5.4s-.3-.7-.3-1.6c0-1.5.9-2.7 2-2.7.9 0 1.4.7 1.4 1.5 0 .9-.6 2.3-.9 3.6-.3 1 .5 1.9 1.6 1.9 1.9 0 3.3-2 3.3-4.9 0-2.6-1.8-4.4-4.5-4.4-3 0-4.8 2.3-4.8 4.6 0 .9.3 1.9.8 2.4.1.1.1.2.1.3l-.4 1.4c0 .2-.2.3-.4.2-1.4-.7-2.3-2.7-2.3-4.4 0-3.6 2.6-6.9 7.5-6.9 4 0 7 2.8 7 6.6 0 4-2.5 7.1-5.9 7.1-1.2 0-2.3-.6-2.6-1.3l-.7 2.7c-.3 1-1 2.2-1.4 3A10 10 0 1 0 12 2z"/></svg>',
    crosshair: '<svg viewBox="0 0 60 60" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><circle cx="30" cy="30" r="20"/><circle cx="30" cy="30" r="2" fill="currentColor"/><path d="M30 6v8M30 46v8M6 30h8M46 30h8"/><path d="m18 18 4 4M42 18l-4 4M18 42l4-4M42 42l-4-4" opacity=".6"/></svg>',
    book: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4z"/><path d="M20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7z"/></svg>',
    filter: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18M6 12h12M10 19h4"/></svg>',
    expand: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5"/><path d="M15 20h5v-5"/><path d="M4 4l6 6"/><path d="M20 20l-6-6"/></svg>',
  };

  window.GE_SVG = SVG;

  // ---------- Header ----------
  function buildHeader(activePage) {
    // Order matches sections on the homepage, with cross-page destinations at the end.
    const navItems = [
      { label: 'Overview',  href: 'index.html#overview',     key: 'overview' },
      { label: 'Gallery',   href: 'index.html#gallery',      key: 'gallery'  },
      { label: 'Care',      href: 'index.html#care',         key: 'care'     },
      { label: 'History',   href: 'index.html#history',      key: 'history'  },
      { label: 'Full Gallery', href: 'gallery.html',         key: 'gallery-page' },
      { label: 'Breed Guide',  href: 'breed-guide.html',     key: 'breed'    },
    ];
    return `
      <header class="site-header" id="siteHeader">
        <div class="container">
          <a href="index.html" class="brand-mark" aria-label="Golden Encyclopedia home">
            <span class="brand-icon">${SVG.paw}</span>
            <span class="brand-text"><span class="name">GOLDEN</span><span class="sub">Encyclopedia</span></span>
          </a>
          <nav class="site-nav" aria-label="Primary">
            ${navItems.map(n => `<a href="${n.href}"${n.key === activePage ? ' class="active"' : ''}>${n.label}</a>`).join('')}
          </nav>
          <div class="header-right">
            <button class="icon-btn" id="searchBtn" aria-label="Open search" aria-controls="searchOverlay" aria-expanded="false">${SVG.search}</button>
            <button class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu" aria-controls="mobileMenu" aria-expanded="false">${SVG.menu}</button>
          </div>
        </div>
      </header>
      <div class="mobile-menu" id="mobileMenu" role="dialog" aria-modal="true" aria-label="Mobile menu">
        <button class="close-btn" id="menuClose" aria-label="Close menu">${SVG.close}</button>
        <nav>
          ${navItems.map((n, i) => `<a href="${n.href}"><span>0${i + 1}</span> ${n.label}</a>`).join('')}
        </nav>
      </div>
      <div class="scroll-progress" id="scrollProgress"></div>
      <div class="search-overlay" id="searchOverlay" role="dialog" aria-modal="true" aria-label="Search" hidden>
        <button class="search-scrim" id="searchScrim" aria-label="Close search"></button>
        <div class="search-panel">
          <div class="search-bar">
            <span class="search-icn">${SVG.search}</span>
            <input id="searchInput" type="search" placeholder="Search the encyclopedia…" autocomplete="off" spellcheck="false">
            <button class="icon-btn search-close" id="searchClose" aria-label="Close search">${SVG.close}</button>
          </div>
          <div class="search-hint" id="searchHint">Try “temperament”, “grooming”, or “nutrition”.</div>
          <ul class="search-results" id="searchResults" role="listbox"></ul>
          <div class="search-footer"><kbd>↵</kbd> open <span class="sep">·</span> <kbd>↑</kbd><kbd>↓</kbd> navigate <span class="sep">·</span> <kbd>esc</kbd> close</div>
        </div>
      </div>
    `;
  }

  // ---------- Footer ----------
  function buildFooter() {
    return `
      <section class="footer-cta" aria-label="Demo status and contact">
        <div class="container inner">
          <div class="quote">
            A bond like no other.
            <span class="small">Loyal. Gentle. Golden.</span>
          </div>
          <div class="newsletter">
            <h4>Prototype status</h4>
            <p>This Golden site is a static Elusion Works demo. It does not run a real newsletter, business, or support desk.</p>
            <a class="btn btn-primary" href="../../">Back to Elusion Works <span class="arrow">${SVG.arrowSm}</span></a>
            <div class="ok" id="nlOk" role="status" aria-live="polite">No signup data is collected here.</div>
          </div>
          <div class="social-block">
            <h4>Demo links</h4>
            <div class="social-icons">
              <a href="../../demos/" aria-label="Elusion Works demos">${SVG.book}</a>
              <a href="../../design-notes/" aria-label="Elusion Works design notes">${SVG.star}</a>
              <a href="../../security.txt" aria-label="Elusion Works security contact">${SVG.pin}</a>
            </div>
          </div>
        </div>
      </section>
      <footer class="site-footer">
        <div class="container inner">
          <a href="index.html" class="brand-mark">
            <span class="brand-icon">${SVG.paw}</span>
            <span class="brand-text"><span class="name">GOLDEN</span><span class="sub">Encyclopedia</span></span>
          </a>
          <nav class="links" aria-label="Footer">
            <a href="about.html">About</a>
            <a href="contact.html">Contact</a>
            <a href="privacy.html">Privacy</a>
            <a href="terms.html">Terms</a>
            <a href="sitemap.html">Sitemap</a>
          </nav>
          <nav class="links" aria-label="Elusion Works project links">
            <a href="../../">Elusion Works</a>
            <a href="https://koltregaskes.com/">Kol's Korner</a>
            <a href="https://theairesourcehub.com/">AI Resource Hub</a>
            <a href="https://axylusion.com/">Axy Lusion</a>
            <a href="https://ghostinthemodels.com/">Ghost in the Models</a>
            <a href="https://koltregaskesphotography.com/">KT Photography</a>
          </nav>
          <p class="copy">Golden Encyclopedia is a prototype demo inside Elusion Works.</p>
        </div>
      </footer>
    `;
  }

  // ---------- Ambient Particles ----------
  function initParticles() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'particles';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let w, h, particles = [];
    function resize() {
      w = canvas.width = window.innerWidth * window.devicePixelRatio;
      h = canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    }
    function init() {
      particles = [];
      const count = Math.min(60, Math.floor((window.innerWidth * window.innerHeight) / 28000));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: (Math.random() * 1.6 + 0.4) * window.devicePixelRatio,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15 - 0.08,
          a: Math.random() * 0.5 + 0.15,
          tw: Math.random() * Math.PI * 2,
        });
      }
    }
    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy;
        p.tw += 0.02;
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
        const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        grd.addColorStop(0, `rgba(233, 201, 120, ${alpha})`);
        grd.addColorStop(1, 'rgba(233, 201, 120, 0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(255, 247, 230, ${alpha * 0.9})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.7, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(draw);
    }
    resize(); init(); draw();
    window.addEventListener('resize', () => { resize(); init(); });
  }

  // ---------- Reveals ----------
  function initReveals() {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach(e => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(e => io.observe(e));
  }

  // ---------- Scroll Progress + Header bg ----------
  function initScrollProgress() {
    const bar = document.getElementById('scrollProgress');
    const header = document.getElementById('siteHeader');
    function update() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const y = window.scrollY;
      const p = max > 0 ? Math.min(1, y / max) : 0;
      if (bar) bar.style.width = (p * 100) + '%';
      if (header) header.classList.toggle('scrolled', y > 24);
    }
    update();
    window.addEventListener('scroll', update, { passive: true });
  }

  // ---------- Mobile menu ----------
  function initMobileMenu() {
    const btn = document.getElementById('menuBtn');
    const menu = document.getElementById('mobileMenu');
    const close = document.getElementById('menuClose');
    if (!btn || !menu) return;
    function open() {
      menu.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }
    function shut() {
      menu.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }
    btn.addEventListener('click', open);
    close && close.addEventListener('click', shut);
    menu.querySelectorAll('a').forEach(a => a.addEventListener('click', shut));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') shut(); });
  }

  // ---------- Search ----------
  const SEARCH_INDEX = [
    { title: 'Home', url: 'index.html', section: 'Page', kw: 'home overview hero golden retriever' },
    { title: 'Breed Overview', url: 'index.html#overview', section: 'Home', kw: 'overview history breed cards built field people pleasers family' },
    { title: 'Gallery teaser', url: 'index.html#gallery', section: 'Home', kw: 'gallery photos imagery' },
    { title: 'Care essentials', url: 'index.html#care', section: 'Home', kw: 'care exercise nutrition grooming health training' },
    { title: 'A history of devotion', url: 'index.html#history', section: 'Home', kw: 'history scotland 1860 1900 1930 origin timeline' },
    { title: 'Breed Guide', url: 'breed-guide.html#introduction', section: 'Page', kw: 'breed guide encyclopedia introduction inside the golden' },
    { title: 'Introduction', url: 'breed-guide.html#introduction', section: 'Breed Guide', kw: 'introduction summary about origin scotland sporting' },
    { title: 'Temperament', url: 'breed-guide.html#temperament', section: 'Breed Guide', kw: 'temperament personality friendly gentle social patience children dogs' },
    { title: 'Exercise', url: 'breed-guide.html#exercise', section: 'Breed Guide', kw: 'exercise activity walks running energy 60 minutes mental stimulation' },
    { title: 'Grooming', url: 'breed-guide.html#grooming', section: 'Breed Guide', kw: 'grooming coat brushing shedding double coat water repellent' },
    { title: 'Nutrition', url: 'breed-guide.html#nutrition', section: 'Breed Guide', kw: 'nutrition diet food feeding life stage' },
    { title: 'Health', url: 'breed-guide.html#health', section: 'Breed Guide', kw: 'health lifespan genetic conditions hips elbows vet' },
    { title: 'Training', url: 'breed-guide.html#training', section: 'Breed Guide', kw: 'training obedience positive reinforcement eager to please food motivated' },
    { title: 'FAQs', url: 'breed-guide.html#faqs', section: 'Breed Guide', kw: 'faq frequently asked questions hypoallergenic shed kids apartment' },
    { title: 'Full Gallery', url: 'gallery.html', section: 'Page', kw: 'gallery photos pictures portraits puppies field studio' },
    { title: 'About', url: 'about.html', section: 'Page', kw: 'about mission editorial team values' },
    { title: 'Contact', url: 'contact.html', section: 'Page', kw: 'contact email get in touch' },
    { title: 'Privacy', url: 'privacy.html', section: 'Page', kw: 'privacy policy gdpr cookies data' },
    { title: 'Terms', url: 'terms.html', section: 'Page', kw: 'terms of use legal copyright' },
  ];

  function initSearch() {
    const btn = document.getElementById('searchBtn');
    const overlay = document.getElementById('searchOverlay');
    const scrim = document.getElementById('searchScrim');
    const close = document.getElementById('searchClose');
    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    const hint = document.getElementById('searchHint');
    if (!btn || !overlay || !input) return;
    let activeIdx = -1;
    let currentItems = [];

    function open() {
      overlay.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => {
        overlay.classList.add('open');
        input.focus();
      });
    }
    function shut() {
      overlay.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      setTimeout(() => { overlay.hidden = true; }, 200);
      input.value = '';
      render('');
    }
    function score(q, item) {
      q = q.toLowerCase();
      const t = item.title.toLowerCase();
      const k = (item.title + ' ' + item.kw + ' ' + item.section).toLowerCase();
      if (t === q) return 100;
      if (t.startsWith(q)) return 80;
      if (t.includes(q)) return 60;
      if (k.includes(q)) return 30;
      // word-by-word soft match
      const terms = q.split(/\s+/).filter(Boolean);
      const hits = terms.filter(term => k.includes(term)).length;
      return hits ? hits * 8 : 0;
    }
    function render(q) {
      activeIdx = -1;
      if (!q || !q.trim()) {
        currentItems = [];
        results.innerHTML = '';
        hint.style.display = 'block';
        return;
      }
      hint.style.display = 'none';
      const ranked = SEARCH_INDEX
        .map(it => ({ it, s: score(q.trim(), it) }))
        .filter(r => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 8);
      currentItems = ranked.map(r => r.it);
      if (!currentItems.length) {
        results.innerHTML = '<li class="empty">No matches. Try a different word.</li>';
        return;
      }
      results.innerHTML = currentItems.map((it, i) => {
        const re = new RegExp('(' + q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
        const t = it.title.replace(re, '<mark>$1</mark>');
        return `<li role="option" data-i="${i}"><a href="${it.url}"><span class="sec">${it.section}</span><span class="ttl">${t}</span><span class="go">${SVG.arrowSm}</span></a></li>`;
      }).join('');
    }
    function highlight(i) {
      const items = results.querySelectorAll('li');
      items.forEach(li => li.classList.remove('hl'));
      if (i >= 0 && items[i]) items[i].classList.add('hl');
      activeIdx = i;
    }

    btn.addEventListener('click', open);
    scrim && scrim.addEventListener('click', shut);
    close && close.addEventListener('click', shut);
    input.addEventListener('input', e => render(e.target.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { shut(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (currentItems.length) highlight(Math.min(activeIdx + 1, currentItems.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (currentItems.length) highlight(Math.max(activeIdx - 1, 0)); }
      else if (e.key === 'Enter') {
        if (activeIdx >= 0 && currentItems[activeIdx]) { window.location.href = currentItems[activeIdx].url; }
        else if (currentItems[0]) { window.location.href = currentItems[0].url; }
      }
    });
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !overlay.classList.contains('open') && !/^(input|textarea)$/i.test((document.activeElement && document.activeElement.tagName) || '')) {
        e.preventDefault(); open();
      }
    });
  }

  // ---------- Newsletter ----------
  function initNewsletter() {
    const form = document.getElementById('newsletterForm');
    if (!form) return;
  }

  // ---------- Public mount ----------
  window.GE = {
    SVG,
    mountChrome(activeKey) {
      const headHost = document.getElementById('siteHeaderHost');
      const footHost = document.getElementById('siteFooterHost');
      if (headHost) headHost.innerHTML = buildHeader(activeKey);
      if (footHost) footHost.innerHTML = buildFooter();
      initScrollProgress();
      initMobileMenu();
      initSearch();
      initNewsletter();
      initReveals();
      initParticles();
    },
    initReveals,
  };
})();
