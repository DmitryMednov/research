/* ============================================================
   RESEARCH — анимации (vanilla, без внешних CDN)
   1. Посимвольно/пословно «проявление» заголовков на скролле
      (translateY + blur + opacity + stagger) — в духе Codrops
      On-Scroll Typography.
   2. Reveal блоков (секции, карточки) по IntersectionObserver.
   3. Лёгкий параллакс заголовка hero.
   4. Плавный переход между страницами (overlay) для внутренних
      ссылок + проявление при загрузке.
   Уважает prefers-reduced-motion.
   ============================================================ */
(function(){
  'use strict';
  var reduce = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion:reduce)').matches;

  /* ---------- 0. boot fade-in ---------- */
  document.documentElement.classList.add('js');
  document.body.classList.add('booting');
  function boot(){
    document.body.classList.remove('booting');
    document.body.classList.add('booted');
  }

  /* ---------- 1. split headings into words ---------- */
  function splitHeading(el){
    if(el.dataset.split === 'done') return;
    el.dataset.split = 'done';
    var words = el.textContent.split(/(\s+)/); // keep spaces
    el.textContent = '';
    el.classList.add('split');
    words.forEach(function(tok){
      if(/^\s+$/.test(tok)){ el.appendChild(document.createTextNode(' ')); return; }
      if(tok === '') return;
      var w = document.createElement('span'); w.className = 'w';
      var i = document.createElement('span'); i.className = 'i';
      i.textContent = tok;
      w.appendChild(i);
      el.appendChild(w);
    });
  }

  function applyStagger(el){
    var items = el.querySelectorAll('.i');
    for(var k=0;k<items.length;k++){
      items[k].style.transitionDelay = (k*55) + 'ms';
    }
  }

  /* ---------- 2. observers ---------- */
  function setupReveal(){
    var heads = document.querySelectorAll('h1, h2, [data-split]');
    heads.forEach(function(h){
      // skip tiny / nav headings
      if(h.closest('.brandbar')) return;
      splitHeading(h);
      applyStagger(h);
    });

    if(reduce || !('IntersectionObserver' in window)){
      document.querySelectorAll('.split').forEach(function(s){s.classList.add('in');});
      document.querySelectorAll('[data-reveal]').forEach(function(s){s.classList.add('in');});
      return;
    }

    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, {rootMargin:'0px 0px -12% 0px', threshold:0.15});

    document.querySelectorAll('.split, [data-reveal]').forEach(function(el){io.observe(el);});
  }

  /* auto-tag blocks for reveal */
  function tagReveals(){
    var sel = 'section > .card, .grid > .card, .grid > .stat, .plat, ul.links > li, .callout, .vs > div, .phases > div, .pay, .disc, .reveal';
    document.querySelectorAll(sel).forEach(function(el){
      if(el.closest('.hero')) return;
      if(!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal','');
    });
  }

  /* ---------- 3. hero parallax ---------- */
  function setupParallax(){
    if(reduce) return;
    var h1 = document.querySelector('.hero h1');
    var hero = document.querySelector('.hero');
    if(!h1 || !hero) return;
    var ticking = false;
    function upd(){
      ticking = false;
      var y = window.pageYOffset;
      if(y > window.innerHeight) return;
      h1.style.transform = 'translateY(' + (y * 0.12) + 'px)';
      hero.style.setProperty('--hy', (y * 0.04) + 'px');
    }
    window.addEventListener('scroll', function(){
      if(!ticking){ window.requestAnimationFrame(upd); ticking = true; }
    }, {passive:true});
  }

  /* ---------- 4. page transitions ---------- */
  function sameOrigin(a){
    return a.hostname === location.hostname &&
      a.protocol === location.protocol;
  }
  function isInternalDoc(a){
    if(!sameOrigin(a)) return false;
    if(a.target && a.target !== '_self') return false;
    if(a.hasAttribute('download')) return false;
    var href = a.getAttribute('href') || '';
    if(href.charAt(0) === '#') return false;
    if(/^(mailto:|tel:)/i.test(href)) return false;
    // only intercept .html / directory links inside the site
    return /\.html?($|[?#])/.test(a.pathname) || /\/$/.test(a.pathname) || a.pathname === location.pathname;
  }
  function setupTransitions(){
    var pt = document.getElementById('pt');
    if(!pt){
      pt = document.createElement('div'); pt.id = 'pt';
      document.body.appendChild(pt);
    }
    // reveal overlay on load
    if(!reduce){
      pt.classList.add('cover');
      requestAnimationFrame(function(){
        requestAnimationFrame(function(){ pt.classList.remove('cover'); pt.classList.add('reveal'); });
      });
    }
    if(reduce) return;

    document.addEventListener('click', function(ev){
      var a = ev.target.closest && ev.target.closest('a');
      if(!a) return;
      if(ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
      if(!isInternalDoc(a)) return;
      var url = a.href;
      if(url === location.href) return;
      ev.preventDefault();
      pt.classList.remove('reveal');
      pt.classList.add('cover');
      setTimeout(function(){ window.location.href = url; }, 480);
    });
    // restore on bfcache back
    window.addEventListener('pageshow', function(e){
      if(e.persisted){ pt.classList.remove('cover'); pt.classList.add('reveal'); }
    });
  }

  /* ---------- 5. roadmap / accordion toggles ---------- */
  function setupAccordions(){
    document.querySelectorAll('.ritem').forEach(function(b){
      if(b.dataset.acc) return; b.dataset.acc = '1';
      b.setAttribute('type','button');
      b.setAttribute('aria-expanded','false');
      b.addEventListener('click', function(){
        var open = b.classList.toggle('open');
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }

  /* ---------- run ---------- */
  function init(){
    tagReveals();
    setupReveal();
    setupParallax();
    setupTransitions();
    setupAccordions();
    requestAnimationFrame(boot);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
