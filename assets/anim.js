/* ============================================================
   RESEARCH — анимации (vanilla, без внешних CDN).
   Идемпотентно: window.RAnim.run() можно звать после каждой
   вставки контента (страница-вход открывает сценарии на месте).
   - пословное «проявление» заголовков на скролле (translateY+blur+stagger)
   - reveal блоков по IntersectionObserver
   - лёгкий параллакс hero
   Уважает prefers-reduced-motion.
   ============================================================ */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches;
  document.documentElement.classList.add('js');

  function splitHeading(el) {
    if (el.dataset.split === 'done') return;
    el.dataset.split = 'done';
    var toks = el.textContent.split(/(\s+)/);
    el.textContent = '';
    el.classList.add('split');
    toks.forEach(function (t) {
      if (t === '') return;
      if (/^\s+$/.test(t)) { el.appendChild(document.createTextNode(' ')); return; }
      var w = document.createElement('span'); w.className = 'w';
      var i = document.createElement('span'); i.className = 'i';
      i.textContent = t; w.appendChild(i); el.appendChild(w);
    });
    var items = el.querySelectorAll('.i');
    for (var k = 0; k < items.length; k++) items[k].style.transitionDelay = (k * 55) + 'ms';
  }

  function tagReveals(root) {
    var sel = 'section > .card, .grid > .card, .grid > .stat, .plat, ul.links > li, .callout, .vs > div, .phases > div, .pay, .disc, .reveal';
    root.querySelectorAll(sel).forEach(function (el) {
      if (el.closest('.hero')) return;
      if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', '');
    });
  }

  var io = null;
  function observe(root) {
    var heads = root.querySelectorAll('h1, h2, [data-split]');
    heads.forEach(function (h) {
      if (h.closest('.brandbar') || h.closest('.gatecard')) return;
      splitHeading(h);
    });
    if (reduce || !('IntersectionObserver' in window)) {
      root.querySelectorAll('.split, [data-reveal]').forEach(function (s) { s.classList.add('in'); });
      return;
    }
    if (!io) io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
    root.querySelectorAll('.split, [data-reveal]').forEach(function (el) {
      if (el.dataset.obs === '1' || el.classList.contains('in')) return;
      el.dataset.obs = '1'; io.observe(el);
    });
  }

  var parallaxBound = false;
  function bindParallax() {
    if (reduce || parallaxBound) return;
    parallaxBound = true;
    var ticking = false;
    function upd() {
      ticking = false;
      var h1 = document.querySelector('.hero h1');
      if (!h1) return;
      var y = window.pageYOffset;
      if (y > window.innerHeight) return;
      h1.style.transform = 'translateY(' + (y * 0.12) + 'px)';
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(upd); ticking = true; }
    }, { passive: true });
  }

  function bindAccordions(root) {
    root.querySelectorAll('.ritem').forEach(function (b) {
      if (b.dataset.acc) return; b.dataset.acc = '1';
      b.setAttribute('type', 'button');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function () {
        var open = b.classList.toggle('open');
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }

  function run(root) {
    root = root || document;
    tagReveals(root);
    observe(root);
    bindAccordions(root);
    bindParallax();
  }

  window.RAnim = { run: run };
})();
