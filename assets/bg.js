/* ============================================================
   bg.js — анимированный фон (WebGL, в духе patrickheng.com).
   Плавно «текущий» фрактальный нойз (domain-warp fbm) в палитре ДС
   (тёмно-зелёный → бирюза → фиолет), мягкое свечение под курсором,
   лёгкое зерно. Один rAF-цикл, пауза на скрытой вкладке.
   Фолбэк: если WebGL недоступен или включён prefers-reduced-motion —
   остаются CSS-orb-градиенты (body::after).
   ============================================================ */
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion:reduce)').matches) return;

  var canvas = document.createElement('canvas');
  canvas.id = 'bgfx';
  var gl;
  try {
    gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, premultipliedAlpha: false })
      || canvas.getContext('experimental-webgl');
  } catch (e) { gl = null; }
  if (!gl) return; // CSS-orbs остаются

  (document.body || document.documentElement).insertBefore(canvas, (document.body || document.documentElement).firstChild);
  document.documentElement.classList.add('bg-live');

  var VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
  var FRAG = [
    'precision highp float;',
    'uniform vec2 u_res;uniform float u_time;uniform vec2 u_mouse;',
    'vec2 hash(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return -1.0+2.0*fract(sin(p)*43758.5453123);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);',
    ' return mix(mix(dot(hash(i+vec2(0.0,0.0)),f-vec2(0.0,0.0)),dot(hash(i+vec2(1.0,0.0)),f-vec2(1.0,0.0)),u.x),',
    '            mix(dot(hash(i+vec2(0.0,1.0)),f-vec2(0.0,1.0)),dot(hash(i+vec2(1.0,1.0)),f-vec2(1.0,1.0)),u.x),u.y);}',
    'float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.0;a*=0.5;}return v;}',
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/u_res.xy;',
    ' vec2 p=(gl_FragCoord.xy-0.5*u_res.xy)/u_res.y;',
    ' float t=u_time*0.05;',
    ' vec2 q=vec2(fbm(p+vec2(0.0,t)),fbm(p+vec2(5.2,-t)));',
    ' vec2 r=vec2(fbm(p+1.7*q+vec2(8.3,2.8)+0.15*t),fbm(p+1.7*q+vec2(2.6,9.2)-0.12*t));',
    ' float f=fbm(p+2.3*r);',
    ' vec2 m=(u_mouse-0.5*u_res.xy)/u_res.y;',
    ' float glow=smoothstep(0.8,0.0,length(p-m))*0.34;',
    ' vec3 base=vec3(0.028,0.068,0.065);',
    ' vec3 deep=vec3(0.016,0.180,0.176);',
    ' vec3 turq=vec3(0.173,0.690,0.659);',
    ' vec3 viol=vec3(0.800,0.831,0.992);',
    ' vec3 col=base;',
    ' col=mix(col,deep,smoothstep(0.05,0.8,f+0.25));',
    ' col=mix(col,turq,smoothstep(0.62,1.2,f)*0.42);',
    ' col=mix(col,viol,smoothstep(0.7,1.25,length(r))*0.16);',
    ' col+=turq*glow*(0.3+0.7*f);',
    ' col*=1.0-0.42*length(uv-0.5);',
    ' col*=0.9;',
    ' float g=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233))+u_time)*43758.5453);',
    ' col+=(g-0.5)*0.022;',
    ' gl_FragColor=vec4(max(col,0.0),1.0);',
    '}'
  ].join('\n');

  function sh(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { return null; }
    return s;
  }
  var vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { canvas.remove(); document.documentElement.classList.remove('bg-live'); return; }
  var prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { canvas.remove(); document.documentElement.classList.remove('bg-live'); return; }
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'u_res');
  var uTime = gl.getUniformLocation(prog, 'u_time');
  var uMouse = gl.getUniformLocation(prog, 'u_mouse');

  var SCALE = 0.62; // рендерим мельче и растягиваем — эффект мягкий, апскейл незаметен
  var W = 0, H = 0;
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = Math.max(2, Math.floor(window.innerWidth * SCALE * dpr));
    H = Math.max(2, Math.floor(window.innerHeight * SCALE * dpr));
    canvas.width = W; canvas.height = H;
    gl.viewport(0, 0, W, H);
  }
  resize();
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 150); }, { passive: true });

  // указатель (сглаженный); на тач/без мыши — мягкий автодрейф
  var mx = W * 0.5, my = H * 0.55, tx = mx, ty = my, auto = true;
  window.addEventListener('pointermove', function (e) {
    auto = false;
    tx = e.clientX * SCALE * (W / (window.innerWidth || 1));
    ty = (window.innerHeight - e.clientY) * SCALE * (H / (window.innerHeight || 1));
  }, { passive: true });

  var t0 = null, raf = 0, running = true;
  function frame(ts) {
    if (!running) return;
    if (t0 === null) t0 = ts;
    var time = (ts - t0) * 0.001;
    if (auto) { tx = W * (0.5 + 0.35 * Math.sin(time * 0.13)); ty = H * (0.5 + 0.3 * Math.cos(time * 0.11)); }
    mx += (tx - mx) * 0.05; my += (ty - my) * 0.05;
    gl.uniform2f(uRes, W, H);
    gl.uniform1f(uTime, time);
    gl.uniform2f(uMouse, mx, my);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { running = false; cancelAnimationFrame(raf); }
    else if (!running) { running = true; t0 = null; raf = requestAnimationFrame(frame); }
  });
})();
