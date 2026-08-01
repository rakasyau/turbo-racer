/* ============================================================
   TURBO RACER — game balapan mobil pseudo-3D
   Algoritma road/perspektif diadaptasi dari "Javascript Racer"
   oleh Jake Gordon (codeincomplete.com/games/racer, MIT License)
   — dimodifikasi besar: sprite & background 100% prosedural
   (tanpa file gambar), HUD, suara WebAudio, sistem nyawa,
   kontrol sentuh, high-score, state menu/countdown/pause.
   ============================================================ */

'use strict';

// ==================== CANVAS ====================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const wrapEl = document.getElementById('wrap');
let W = 1024, H = 768;   // ukuran canvas (device pixel) — dinamis via resize()
canvas.width = W; canvas.height = H;

// Ukuran canvas adaptif: portrait = layar penuh, landscape/desktop = rasio 4:3
function resize() {
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  let w, h;
  if (vw >= vh) {               // landscape / desktop
    h = vh;
    w = h * 4 / 3;
    if (w > vw) { w = vw; h = w * 3 / 4; }
  } else {                      // portrait → manfaatkan layar penuh
    w = vw; h = vh;
  }
  wrapEl.style.width = w + 'px';
  wrapEl.style.height = h + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);   // cap biar tetap lancar
  const cw = Math.max(320, Math.round(w * dpr));
  const ch = Math.max(240, Math.round(h * dpr));
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  W = canvas.width; H = canvas.height;
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 120));
resize();

// ==================== KONSTANTA ====================
const SEGMENT_LENGTH = 200;   // panjang 1 segmen (satuan dunia)
const RUMBLE_LENGTH  = 3;     // segmen per strip rumble
const ROAD_WIDTH     = 2000;  // setengah lebar jalan (satuan dunia)
const LANES          = 4;     // jumlah lajur
const FOV            = 100;   // derajat
const CAMERA_HEIGHT  = 1000;  // tinggi kamera
const DRAW_DISTANCE  = 300;   // jumlah segmen yang digambar
const FOG_DENSITY    = 5;
const CENTRIFUGAL    = 0.3;
const STEP           = 1/60;

const cameraDepth = 1 / Math.tan((FOV/2) * Math.PI/180);   // ≈ 0.839
const playerZ     = CAMERA_HEIGHT * cameraDepth;           // ≈ 839 (jarak mobil ke kamera)

const maxSpeed      = SEGMENT_LENGTH / STEP;   // 12000 satuan/detik
const accel         = maxSpeed / 5;
const braking       = -maxSpeed;
const decel         = -maxSpeed / 5;
const offRoadDecel  = -maxSpeed / 2;
const offRoadLimit  = maxSpeed / 4;

const SPRITE_SCALE  = 7.5;  // faktor skala sprite (setara 0.3 * 1/80 * roadWidth)

// ==================== STATE GAME ====================
let segments = [];   // segmen jalan
let cars     = [];   // mobil AI
let position = 0;    // posisi kamera (z)
let speed    = 0;    // kecepatan pemain
let playerX  = 0;    // posisi lateral pemain (-1..1 = di jalan)
let trackLength = 0;
let totalDist = 0;   // jarak tempuh total (untuk skor)
let hearts    = 3;
let invuln    = 0;
let crashFlash = 0;
let shake     = 0;
let state     = 'menu';        // menu | countdown | racing | paused | gameover
let countdownT = 3;
let lastBeepInt = 3;
let best = parseInt(localStorage.getItem('tr_best') || '0', 10) || 0;
let muted = localStorage.getItem('tr_muted') === '1';

const keys = { left:false, right:false, up:false, down:false };

const $ = id => document.getElementById(id);
const hud = {};

// ==================== UTIL ====================
const Util = {
  limit:      (v,min,max) => Math.max(min, Math.min(v,max)),
  randomInt:  (min,max)   => Math.round(Util.interpolate(min, max, Math.random())),
  randomChoice: arr       => arr[Util.randomInt(0, arr.length-1)],
  percentRemaining: (n,total) => (n % total) / total,
  accelerate: (v,a,dt)    => v + a*dt,
  interpolate:(a,b,p)     => a + (b-a)*p,
  easeInOut:  (a,b,p)     => a + (b-a)*((-Math.cos(p*Math.PI)/2) + 0.5),
  easeIn:     (a,b,p)     => a + (b-a)*Math.pow(p,2),
  exponentialFog: (d,den) => 1 / Math.pow(Math.E, d*d*den),
  increase: function(start, inc, max) {
    let r = start + inc;
    while (r >= max) r -= max;
    while (r < 0)    r += max;
    return r;
  },
  project: function(p, cameraX, cameraY, cameraZ, roadWidth) {
    p.camera.x = (p.world.x || 0) - cameraX;
    p.camera.y = (p.world.y || 0) - cameraY;
    p.camera.z = (p.world.z || 0) - cameraZ;
    p.screen.scale = cameraDepth / p.camera.z;
    p.screen.x = Math.round(W/2 + p.screen.scale * p.camera.x * W/2);
    p.screen.y = Math.round(H/2 - p.screen.scale * p.camera.y * H/2);
    p.screen.w = Math.round(p.screen.scale * roadWidth * W/2);
  },
  overlap: function(x1,w1,x2,w2,pct) {
    const half = (pct || 1)/2;
    return !((x1 - w1*half > x2 + w2*half) || (x1 + w1*half < x2 - w2*half));
  }
};

// ==================== WARNA ====================
const COLORS = {
  LIGHT: { road:'#6d6d6d', grass:'#57a838', rumble:'#f2f2f2', lane:'#ffffff' },
  DARK:  { road:'#5f5f5f', grass:'#4c9c30', rumble:'#e02424' },
  START: { road:'#ffffff', grass:'#ffffff', rumble:'#ffffff' },
  FOG:   '#cfe4f2'
};

// ==================== SPRITE PROSEDURAL ====================
const S = {
  CAR_RED:   { type:'car',   w:80,  h:55,  color:'#e53935' },
  CAR_BLUE:  { type:'car',   w:80,  h:55,  color:'#1e88e5' },
  CAR_YELLOW:{ type:'car',   w:80,  h:55,  color:'#fdd835' },
  CAR_GREEN: { type:'car',   w:80,  h:55,  color:'#43a047' },
  CAR_WHITE: { type:'car',   w:80,  h:55,  color:'#f5f5f5' },
  CAR_BLACK: { type:'car',   w:80,  h:55,  color:'#37474f' },
  CAR_PURPLE:{ type:'car',   w:80,  h:55,  color:'#8e24aa' },
  TRUCK:     { type:'truck', w:122, h:144, color:'#78909c' },
  SEMI:      { type:'truck', w:122, h:144, color:'#26a69a' },
  TREE:      { type:'tree',  w:150, h:150 },
  PALM:      { type:'palm',  w:120, h:200 },
  BUSH:      { type:'bush',  w:110, h:60 },
  PLAYER:    { type:'player',w:80,  h:55 }
};
S.CARS = [S.CAR_RED, S.CAR_BLUE, S.CAR_YELLOW, S.CAR_GREEN, S.CAR_WHITE, S.CAR_BLACK, S.CAR_PURPLE];
S.TRUCKS = [S.TRUCK, S.SEMI];
S.PLANTS = [S.TREE, S.TREE, S.PALM, S.BUSH, S.BUSH, S.TREE];
const BILLBOARD_TEXTS = ['TURBO RACER','BENSIN MURAH','PIT STOP','HOTEL SENTOSA','BALAPAN 88','SUPER TIRE','OIL 24 JAM','KM 100'];

function roundRectPath(x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y,   x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x,   y+h, r);
  ctx.arcTo(x,   y+h, x,   y,   r);
  ctx.arcTo(x,   y,   x+w, y,   r);
  ctx.closePath();
}

// gambar mobil (tampak belakang) di dalam kotak (x,y,w,h)
function drawCar(x, y, w, h, color, isPlayer) {
  if (w < 2 || h < 2) return;
  // roda
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + w*0.02, y + h*0.66, w*0.16, h*0.3);
  ctx.fillRect(x + w*0.82, y + h*0.66, w*0.16, h*0.3);
  // body
  roundRectPath(x + w*0.06, y + h*0.12, w*0.88, h*0.72, w*0.18);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, w*0.03);
  ctx.stroke();
  // kaca belakang
  ctx.fillStyle = 'rgba(15,25,45,0.9)';
  roundRectPath(x + w*0.22, y + h*0.24, w*0.56, h*0.34, w*0.1);
  ctx.fill();
  // bumper
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + w*0.1, y + h*0.78, w*0.8, h*0.1);
  // lampu rem
  ctx.fillStyle = isPlayer ? '#ff8a65' : '#ff1744';
  ctx.fillRect(x + w*0.14, y + h*0.62, w*0.2, h*0.13);
  ctx.fillRect(x + w*0.66, y + h*0.62, w*0.2, h*0.13);
  if (isPlayer) {
    // spoiler
    ctx.fillStyle = '#263238';
    ctx.fillRect(x + w*0.08, y + h*0.02, w*0.84, h*0.1);
    ctx.fillRect(x + w*0.05, y + h*0.08, w*0.1, h*0.18);
    ctx.fillRect(x + w*0.85, y + h*0.08, w*0.1, h*0.18);
  }
}

function drawTruck(x, y, w, h, color) {
  if (w < 2 || h < 2) return;
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x + w*0.02, y + h*0.85, w*0.14, h*0.14);
  ctx.fillRect(x + w*0.84, y + h*0.85, w*0.14, h*0.14);
  // kabin
  roundRectPath(x + w*0.1, y + h*0.55, w*0.8, h*0.32, w*0.12);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = 'rgba(15,25,45,0.9)';
  roundRectPath(x + w*0.24, y + h*0.6, w*0.52, h*0.2, w*0.06);
  ctx.fill();
  // kontainer
  roundRectPath(x + w*0.06, y + h*0.02, w*0.88, h*0.56, w*0.06);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = Math.max(1, w*0.04);
  ctx.stroke();
  // garis kontainer
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + w*0.06, y + h*0.3, w*0.88, h*0.03);
  ctx.fillRect(x + w*0.06, y + h*0.42, w*0.88, h*0.03);
}

function drawTree(x, y, w, h) {
  if (w < 2 || h < 2) return;
  ctx.fillStyle = '#6d4c2f';
  ctx.fillRect(x + w*0.44, y + h*0.55, w*0.12, h*0.4);
  const cx = x + w/2, r = w*0.34;
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath(); ctx.arc(cx, y + h*0.42, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#388e3c';
  ctx.beginPath(); ctx.arc(cx - w*0.12, y + h*0.5, r*0.72, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + w*0.12, y + h*0.5, r*0.72, 0, 7); ctx.fill();
}

function drawPalm(x, y, w, h) {
  if (w < 2 || h < 2) return;
  ctx.strokeStyle = '#7a5230';
  ctx.lineWidth = Math.max(1.5, w*0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + w*0.5, y + h*0.95);
  ctx.quadraticCurveTo(x + w*0.45, y + h*0.55, x + w*0.5, y + h*0.38);
  ctx.stroke();
  ctx.fillStyle = '#2f9e44';
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI/2 + (i - 2.5) * 0.42;
    ctx.beginPath();
    ctx.moveTo(x + w*0.5, y + h*0.38);
    ctx.quadraticCurveTo(
      x + w*0.5 + Math.cos(a)*w*0.16, y + h*0.38 + Math.sin(a)*h*0.1,
      x + w*0.5 + Math.cos(a)*w*0.34, y + h*0.38 + Math.sin(a)*h*0.16
    );
    ctx.stroke();
  }
}

function drawBush(x, y, w, h) {
  if (w < 2 || h < 2) return;
  ctx.fillStyle = '#1b5e20';
  ctx.beginPath(); ctx.arc(x + w*0.3, y + h*0.55, w*0.28, 0, 7); ctx.fill();
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath(); ctx.arc(x + w*0.6, y + h*0.5, w*0.32, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(x + w*0.78, y + h*0.65, w*0.22, 0, 7); ctx.fill();
}

function drawBillboard(x, y, w, h, text, color) {
  if (w < 2 || h < 2) return;
  // tiang
  ctx.fillStyle = '#5d4037';
  ctx.fillRect(x + w*0.08, y + h*0.6, w*0.08, h*0.4);
  ctx.fillRect(x + w*0.84, y + h*0.6, w*0.08, h*0.4);
  // papan
  ctx.fillStyle = color;
  roundRectPath(x, y + h*0.12, w, h*0.6, w*0.06);
  ctx.fill();
  ctx.strokeStyle = '#263238';
  ctx.lineWidth = Math.max(1, w*0.04);
  ctx.stroke();
  // teks (hanya kalau cukup besar untuk dibaca)
  if (w > 34 && h > 16) {
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold ' + Math.max(6, h*0.26) + 'px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w/2, y + h*0.42, w*0.9);
  }
}

const BILLBOARD_COLORS = ['#0d47a1', '#b71c1c', '#004d40', '#4a148c', '#e65100', '#1a237e'];

function drawSprite(spr, x, y, w, h, variant) {
  switch (spr.type) {
    case 'car':   drawCar(x, y, w, h, spr.color, false); break;
    case 'player':drawCar(x, y, w, h, '#ff6d00', true); break;
    case 'truck': drawTruck(x, y, w, h, spr.color); break;
    case 'tree':  drawTree(x, y, w, h); break;
    case 'palm':  drawPalm(x, y, w, h); break;
    case 'bush':  drawBush(x, y, w, h); break;
    case 'billboard': drawBillboard(x, y, w, h, spr.text, spr.boardColor); break;
  }
}

// ==================== BANGUN JALAN ====================
function lastY() { return segments.length === 0 ? 0 : segments[segments.length-1].p2.world.y; }

function addSegment(curve, y) {
  const n = segments.length;
  segments.push({
    index: n,
    p1: { world: { y: lastY(), z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
    p2: { world: { y: y,       z: (n+1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
    curve: curve,
    sprites: [],
    cars: [],
    color: Math.floor(n / RUMBLE_LENGTH) % 2 ? COLORS.DARK : COLORS.LIGHT
  });
}

function addSprite(n, sprite, offset) {
  if (n >= 0 && n < segments.length) segments[n].sprites.push({ source: sprite, offset: offset });
}

function addRoad(enter, hold, leave, curve, y) {
  const startY = lastY();
  const endY   = startY + (y || 0) * SEGMENT_LENGTH;
  const total  = enter + hold + leave;
  for (let n = 0; n < enter; n++)
    addSegment(Util.easeIn(0, curve, n/enter), Util.easeInOut(startY, endY, n/total));
  for (let n = 0; n < hold; n++)
    addSegment(curve, Util.easeInOut(startY, endY, (enter+n)/total));
  for (let n = 0; n < leave; n++)
    addSegment(Util.easeInOut(curve, 0, n/leave), Util.easeInOut(startY, endY, (enter+hold+n)/total));
}

const RD = {
  LEN:   { NONE:0, SHORT:25, MEDIUM:50, LONG:100 },
  HILL:  { NONE:0, LOW:20, MEDIUM:40, HIGH:60 },
  CURVE: { NONE:0, EASY:2, MEDIUM:4, HARD:6 }
};

function addStraight(num) { num = num || RD.LEN.MEDIUM; addRoad(num, num, num, 0, 0); }
function addHill(num, height) { num = num || RD.LEN.MEDIUM; height = height || RD.HILL.MEDIUM; addRoad(num, num, num, 0, height); }
function addCurve(num, curve, height) { num = num || RD.LEN.MEDIUM; curve = curve || RD.CURVE.MEDIUM; height = height || RD.HILL.NONE; addRoad(num, num, num, curve, height); }

function addLowRollingHills(num, height) {
  num    = num    || RD.LEN.SHORT;
  height = height || RD.HILL.LOW;
  addRoad(num, num, num,  0,               height/2);
  addRoad(num, num, num,  0,              -height);
  addRoad(num, num, num,  RD.CURVE.EASY,   height);
  addRoad(num, num, num,  0,               0);
  addRoad(num, num, num, -RD.CURVE.EASY,   height/2);
  addRoad(num, num, num,  0,               0);
}

function addSCurves() {
  addRoad(RD.LEN.MEDIUM, RD.LEN.MEDIUM, RD.LEN.MEDIUM, -RD.CURVE.EASY,    RD.HILL.NONE);
  addRoad(RD.LEN.MEDIUM, RD.LEN.MEDIUM, RD.LEN.MEDIUM,  RD.CURVE.MEDIUM,  RD.HILL.MEDIUM);
  addRoad(RD.LEN.MEDIUM, RD.LEN.MEDIUM, RD.LEN.MEDIUM,  RD.CURVE.EASY,   -RD.HILL.LOW);
  addRoad(RD.LEN.MEDIUM, RD.LEN.MEDIUM, RD.LEN.MEDIUM, -RD.CURVE.EASY,    RD.HILL.MEDIUM);
  addRoad(RD.LEN.MEDIUM, RD.LEN.MEDIUM, RD.LEN.MEDIUM, -RD.CURVE.MEDIUM, -RD.HILL.MEDIUM);
}

function addBumps() {
  addRoad(10, 10, 10, 0,  5);
  addRoad(10, 10, 10, 0, -2);
  addRoad(10, 10, 10, 0, -5);
  addRoad(10, 10, 10, 0,  8);
  addRoad(10, 10, 10, 0,  5);
  addRoad(10, 10, 10, 0, -7);
  addRoad(10, 10, 10, 0,  5);
  addRoad(10, 10, 10, 0, -2);
}

function addDownhillToEnd(num) {
  num = num || 200;
  addRoad(num, num, num, -RD.CURVE.EASY, -lastY()/SEGMENT_LENGTH);
}

function resetRoad() {
  segments = [];
  addStraight(RD.LEN.SHORT);
  addLowRollingHills();
  addSCurves();
  addCurve(RD.LEN.MEDIUM, RD.CURVE.MEDIUM, RD.HILL.LOW);
  addBumps();
  addLowRollingHills();
  addCurve(RD.LEN.LONG*2, RD.CURVE.MEDIUM, RD.HILL.MEDIUM);
  addStraight();
  addHill(RD.LEN.MEDIUM, RD.HILL.HIGH);
  addSCurves();
  addCurve(RD.LEN.LONG, -RD.CURVE.MEDIUM, RD.HILL.NONE);
  addHill(RD.LEN.LONG, RD.HILL.HIGH);
  addCurve(RD.LEN.LONG, RD.CURVE.MEDIUM, -RD.HILL.LOW);
  addBumps();
  addHill(RD.LEN.LONG, -RD.HILL.MEDIUM);
  addStraight();
  addSCurves();
  addDownhillToEnd();
  trackLength = segments.length * SEGMENT_LENGTH;

  // garis start
  const startSeg = Math.floor(playerZ / SEGMENT_LENGTH);
  segments[startSeg + 2].color = COLORS.START;
  segments[startSeg + 3].color = COLORS.START;
}

function resetSprites() {
  for (const seg of segments) seg.sprites = [];

  // billboard dekat start
  addSprite(8,  { type:'billboard', w:300, h:150, text:'TURBO RACER', boardColor:'#0d47a1' }, -1.15);
  addSprite(10, { type:'billboard', w:300, h:150, text:'BENSIN MURAH', boardColor:'#b71c1c' },  1.15);

  // billboard acak di sirkuit
  for (let n = 150; n < segments.length - 60; n += Util.randomInt(90, 160)) {
    const side = Util.randomChoice([-1, 1]);
    addSprite(n, {
      type:'billboard',
      w: 300, h: 150,
      text: Util.randomChoice(BILLBOARD_TEXTS),
      boardColor: Util.randomChoice(BILLBOARD_COLORS)
    }, side * 1.15);
  }

  // pepohonan & semak di sepanjang jalan
  for (let n = 6; n < segments.length; n += Util.randomInt(3, 6)) {
    const side = Util.randomChoice([-1, 1]);
    const spr  = Util.randomChoice(S.PLANTS);
    const off  = side * (1.35 + Math.random() * 2.6);
    addSprite(n, spr, off);
  }
  // pohon palem rimbun di beberapa area
  for (let n = 40; n < segments.length; n += 12) {
    addSprite(n, S.PALM, 1.4 + Math.random() * 2);
    addSprite(n + 2, S.PALM, -1.4 - Math.random() * 2);
  }
}

function resetCars(count) {
  cars = [];
  for (const seg of segments) seg.cars = [];
  for (let n = 0; n < count; n++) {
    const isTruck = Math.random() < 0.18;
    const spr = isTruck ? Util.randomChoice(S.TRUCKS) : Util.randomChoice(S.CARS);
    const off = Util.randomChoice([-0.75, -0.25, 0.25, 0.75]);
    const z   = Math.floor(Math.random() * segments.length) * SEGMENT_LENGTH;
    const spd = maxSpeed/4 + Math.random() * maxSpeed / (isTruck ? 4 : 2);
    const car = { offset: off, z: z, sprite: spr, speed: spd, percent: 0 };
    findSegment(car.z).cars.push(car);
    cars.push(car);
  }
}

function findSegment(z) {
  return segments[Math.floor(z / SEGMENT_LENGTH) % segments.length];
}

// ==================== SUARA (WebAudio) ====================
let audioCtx = null, engineOsc1, engineOsc2, engineGain, noiseBuf;

function initAudio() {
  if (audioCtx) { if (audioCtx.state === 'suspended') audioCtx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  audioCtx = new AC();
  engineGain = audioCtx.createGain();
  engineGain.gain.value = 0;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 420;
  engineOsc1 = audioCtx.createOscillator(); engineOsc1.type = 'sawtooth'; engineOsc1.frequency.value = 55;
  engineOsc2 = audioCtx.createOscillator(); engineOsc2.type = 'square';   engineOsc2.frequency.value = 27;
  engineOsc1.connect(lp); engineOsc2.connect(lp);
  lp.connect(engineGain); engineGain.connect(audioCtx.destination);
  engineOsc1.start(); engineOsc2.start();
  noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.4, audioCtx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  // channel suara skid / rumput (noise loop dengan filter)
  skidSrc = audioCtx.createBufferSource();
  skidSrc.buffer = noiseBuf;
  skidSrc.loop = true;
  skidFilter = audioCtx.createBiquadFilter();
  skidFilter.type = 'bandpass'; skidFilter.frequency.value = 900; skidFilter.Q.value = 1.2;
  skidGain = audioCtx.createGain(); skidGain.gain.value = 0;
  skidSrc.connect(skidFilter); skidFilter.connect(skidGain); skidGain.connect(audioCtx.destination);
  skidSrc.start();

  startMusic(); // musik chiptune mulai setelah interaksi pertama
}

let skidSrc = null, skidFilter = null, skidGain = null;

function setEngine(v) {
  if (!audioCtx || muted) { if (engineGain) engineGain.gain.value = 0; return; }
  engineGain.gain.value = 0.04 + 0.05 * v;
  engineOsc1.frequency.value = 55 + v * 210;
  engineOsc2.frequency.value = 27 + v * 105;
}

function beep(freq, dur, type, gain) {
  if (!audioCtx || muted) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type || 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(gain || 0.2, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + dur + 0.05);
}

function playCrash() {
  if (!audioCtx || muted) return;
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuf;
  const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
  const g = audioCtx.createGain(); g.gain.setValueAtTime(0.5, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
  src.connect(f); f.connect(g); g.connect(audioCtx.destination);
  src.start();
  beep(90, 0.35, 'sawtooth', 0.35);
}

function playBump() {
  if (!audioCtx || muted) return;
  beep(150, 0.1, 'triangle', 0.22);
  beep(85, 0.14, 'sine', 0.18);
}

// kontrol suara skid (900Hz) / rumput (200Hz)
function setSkid(v, freq) {
  if (!audioCtx || muted) { if (skidGain) skidGain.gain.value = 0; return; }
  if (skidFilter) skidFilter.frequency.value = freq || 900;
  if (skidGain) skidGain.gain.value = v;
}

// ==================== MUSIK (chiptune WebAudio, tanpa file aset) ====================
const MNOTE = n => 440 * Math.pow(2, (n - 69) / 12);  // MIDI → Hz
const music = { bpm: 140, step: 0, nextTime: 0, timer: null, gain: null, playing: false };
const stepDur = () => 60 / music.bpm / 4;  // not 1/16

// melodi utama (A minor), 64 langkah = 4 bar
const MELODY = [
  76,0,76,0, 72,0,74,0, 76,0,74,0, 72,0,71,0,
  77,0,76,0, 74,0,72,0, 74,0,72,0, 71,0,69,0,
  72,0,72,0, 76,0,79,0, 76,0,74,0, 72,0,71,0,
  69,0,71,0, 72,0,74,0, 76,0,74,0, 72,0,0,0
];
const BASS = [
  45,0,0,0, 45,0,0,0, 45,0,0,0, 45,0,0,0,
  41,0,0,0, 41,0,0,0, 41,0,0,0, 41,0,0,0,
  48,0,0,0, 48,0,0,0, 48,0,0,0, 48,0,0,0,
  43,0,0,0, 43,0,0,0, 43,0,0,0, 43,0,0,0
];

function startMusic() {
  if (!audioCtx || music.playing || muted) return;
  music.playing = true;
  music.step = 0;
  music.nextTime = audioCtx.currentTime + 0.06;
  music.gain = audioCtx.createGain();
  music.gain.gain.value = 0;
  music.gain.connect(audioCtx.destination);
  music.gain.gain.linearRampToValueAtTime(0.16, audioCtx.currentTime + 1.5); // fade in
  music.timer = setInterval(scheduleMusic, 25);
}

function stopMusic() {
  if (!music.playing) return;
  music.playing = false;
  clearInterval(music.timer);
  music.timer = null;
  if (music.gain && audioCtx) {
    const t = audioCtx.currentTime;
    music.gain.gain.cancelScheduledValues(t);
    music.gain.gain.setValueAtTime(music.gain.gain.value, t);
    music.gain.gain.linearRampToValueAtTime(0.0001, t + 0.8);
  }
}

function duckMusic() {
  if (music.gain && audioCtx) music.gain.gain.linearRampToValueAtTime(0.03, audioCtx.currentTime + 0.3);
}
function restoreMusic() {
  if (music.gain && audioCtx && !muted) music.gain.gain.linearRampToValueAtTime(0.16, audioCtx.currentTime + 0.4);
}

function scheduleMusic() {
  if (!audioCtx) return;
  const sd = stepDur();
  while (music.nextTime < audioCtx.currentTime + 0.12) {
    const s = music.step % 64;
    const m = MELODY[s], b = BASS[s];
    if (m) playNote(MNOTE(m), music.nextTime, 0.11, 'square', 0.085, music.gain);
    if (b) playNote(MNOTE(b), music.nextTime, 0.16, 'sawtooth', 0.07, music.gain);
    if (s % 4 === 0)      playKick(music.nextTime);       // empat di lantai
    if (s === 4 || s === 12) playSnare(music.nextTime);   // ketuk 2 & 4
    if (s % 4 === 2)      playHat(music.nextTime);        // off-beat
    music.nextTime += sd;
    music.step++;
  }
}

function playNote(freq, t, dur, type, gain, dest) {
  if (!audioCtx || muted) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dest || audioCtx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

function playKick(t) {
  if (!audioCtx || muted) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
  g.gain.setValueAtTime(0.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t); o.stop(t + 0.14);
}

function playSnare(t) {
  if (!audioCtx || muted) return;
  const src = audioCtx.createBufferSource(); src.buffer = noiseBuf;
  const f = audioCtx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.13, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  src.connect(f); f.connect(g); g.connect(audioCtx.destination);
  src.start(t); src.stop(t + 0.11);
}

function playHat(t) {
  if (!audioCtx || muted) return;
  const src = audioCtx.createBufferSource(); src.buffer = noiseBuf;
  const f = audioCtx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
  src.connect(f); f.connect(g); g.connect(audioCtx.destination);
  src.start(t); src.stop(t + 0.045);
}

// countdown & sting game over
function playGo() {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  playNote(880, t, 0.15, 'square', 0.12);
  playNote(1108.7, t + 0.09, 0.22, 'square', 0.1);
  playNote(55, t, 0.3, 'sine', 0.22);
}

function playGameOver(newRecord) {
  if (!audioCtx || muted) return;
  const t = audioCtx.currentTime;
  playNote(392, t, 0.22, 'sawtooth', 0.1);
  playNote(311, t + 0.18, 0.22, 'sawtooth', 0.1);
  playNote(233, t + 0.36, 0.55, 'sawtooth', 0.1);
  if (newRecord) {
    playNote(523.25, t + 1.0, 0.12, 'square', 0.09);
    playNote(659.25, t + 1.12, 0.12, 'square', 0.09);
    playNote(783.99, t + 1.24, 0.3, 'square', 0.09);
  }
}

function toggleMute() {
  muted = !muted;
  localStorage.setItem('tr_muted', muted ? '1' : '0');
  if (!audioCtx) return;
  if (muted) {
    if (engineGain) engineGain.gain.value = 0;
    if (skidGain) skidGain.gain.value = 0;
    if (music.gain) music.gain.gain.value = 0;
  } else {
    if (!music.playing) startMusic();
    else if (music.gain) music.gain.gain.value = 0.16;
  }
}

// ==================== UPDATE ====================
function update(dt) {
  const playerSegment = findSegment(position + playerZ);
  const playerW = 0.3; // setengah lebar mobil pemain (satuan jalan)

  if (state === 'racing' || state === 'countdown') {
    updateCars(dt);
  }

  if (state === 'countdown') {
    countdownT -= dt;
    const i = Math.ceil(countdownT);
    if (i !== lastBeepInt && i > 0) { beep([440, 554.37, 659.25][3 - i], 0.09); lastBeepInt = i; }
    if (countdownT <= 0) { playGo(); state = 'racing'; }
    setEngine(0);
    setSkid(0, 900);
    return; // mobil pemain masih diam
  }

  if (state !== 'racing') { setEngine(0); setSkid(0, 900); return; }

  const speedPercent = speed / maxSpeed;
  const dx = dt * 2 * speedPercent; // dari kiri ke kanan (±1) dalam 1 detik di kecepatan penuh

  // ----- input -----
  if (keys.left)  playerX -= dx;
  if (keys.right) playerX += dx;
  playerX -= dx * speedPercent * playerSegment.curve * CENTRIFUGAL; // efek gaya sentrifugal di tikungan

  if (keys.up)   speed = Util.accelerate(speed, accel, dt);
  else if (keys.down) speed = Util.accelerate(speed, braking, dt);
  else speed = Util.accelerate(speed, decel, dt);

  // ----- keluar jalur (rumput) -----
  if (playerX < -1 || playerX > 1) {
    if (speed > offRoadLimit) speed = Util.accelerate(speed, offRoadDecel, dt);
    // tabrakan dengan pohon/papan di pinggir jalan
    for (const spr of playerSegment.sprites) {
      const sprW = spr.source.w * 0.3 / 80; // lebar sprite (satuan jalan)
      if (Util.overlap(playerX, playerW, spr.offset + sprW/2 * (spr.offset > 0 ? 1 : -1), sprW)) {
        speed = maxSpeed/5;
        position = Util.increase(playerSegment.p1.world.z, -playerZ, trackLength);
        break;
      }
    }
  }

  // ----- tabrakan dengan mobil AI -----
  if (invuln <= 0) {
    for (const car of playerSegment.cars) {
      const carW = 0.3;
      if (speed > car.speed && Util.overlap(playerX, playerW, car.offset, carW, 0.8)) {
        const diff = speed - car.speed;
        if (diff > maxSpeed * 0.25) {
          // tabrakan keras → hilang 1 nyawa
          hearts--;
          crashFlash = 1; shake = 0.7;
          playCrash();
          invuln = 0.9;
          speed = car.speed * 0.6;
          if (hearts <= 0) { gameOver(); break; }
        } else {
          speed = car.speed * (car.speed / speed); // menabrak ringan → terdorong balik
          playBump();
        }
        position = Util.increase(car.z, -playerZ, trackLength);
        break;
      }
    }
  }

  position = Util.increase(position, dt * speed, trackLength);
  totalDist += dt * speed;

  // ----- skala kesulitan: tambah lalu lintas tiap 10 km -----
  const target = Math.min(220, 120 + Math.floor(totalDist / 10000) * 12);
  if (cars.length < target) {
    for (let i = 0; i < 8 && cars.length < target; i++) spawnCarAhead();
  }

  // ----- invulnerability & efek -----
  if (invuln > 0) invuln -= dt;
  if (crashFlash > 0) crashFlash = Math.max(0, crashFlash - dt * 2.5);
  if (shake > 0) shake = Math.max(0, shake - dt * 2);

  playerX = Util.limit(playerX, -3, 3);
  speed   = Util.limit(speed, 0, maxSpeed);

  // ----- suara skid & rumput -----
  const onGrass = (playerX < -1 || playerX > 1);
  const steering = (keys.left || keys.right) ? 1 : 0;
  if (onGrass && speed > maxSpeed * 0.15) {
    setSkid(0.1 + 0.04 * speedPercent, 190);       // gemuruh di rumput
  } else if (steering && speed > maxSpeed * 0.35) {
    setSkid(0.05 + 0.08 * speedPercent, 950);      // ban selip saat belok kencang
  } else {
    setSkid(0, 900);
  }

  setEngine(speed / maxSpeed);
  updateHud();
}

function spawnCarAhead() {
  const isTruck = Math.random() < 0.15;
  const spr = isTruck ? Util.randomChoice(S.TRUCKS) : Util.randomChoice(S.CARS);
  const off = Util.randomChoice([-0.75, -0.25, 0.25, 0.75]);
  const ahead = position + 6000 + Math.random() * 18000;
  const z = ahead % trackLength;
  const spd = maxSpeed/4 + Math.random() * maxSpeed / (isTruck ? 4 : 2);
  const car = { offset: off, z: z, sprite: spr, speed: spd, percent: 0 };
  findSegment(car.z).cars.push(car);
  cars.push(car);
}

function updateCars(dt) {
  for (let n = 0; n < cars.length; n++) {
    const car = cars[n];
    const oldSegment = findSegment(car.z);
    car.offset += updateCarOffset(car, oldSegment);
    car.z = Util.increase(car.z, dt * car.speed, trackLength);
    car.percent = Util.percentRemaining(car.z, SEGMENT_LENGTH);
    const newSegment = findSegment(car.z);
    if (oldSegment !== newSegment) {
      oldSegment.cars.splice(oldSegment.cars.indexOf(car), 1);
      newSegment.cars.push(car);
    }
  }
}

function updateCarOffset(car, carSegment) {
  const playerSegment = findSegment(position + playerZ);
  const lookahead = 20;
  const carW = 0.3;
  const playerW = 0.3;

  if ((carSegment.index - playerSegment.index) > DRAW_DISTANCE) return 0;

  for (let i = 1; i < lookahead; i++) {
    const segment = segments[(carSegment.index + i) % segments.length];

    // menghindari pemain jika lebih cepat
    if (segment === playerSegment && car.speed > speed && Util.overlap(playerX, playerW, car.offset, carW, 1.2)) {
      let dir = (car.offset > playerX) ? 1 : -1;
      if (playerX > 0.5) dir = -1;
      else if (playerX < -0.5) dir = 1;
      return dir * 1/i * (car.speed - speed) / maxSpeed;
    }

    // menghindari mobil lain
    for (const other of segment.cars) {
      if (car.speed > other.speed && Util.overlap(car.offset, carW, other.offset, carW, 1.2)) {
        let dir = (car.offset > other.offset) ? 1 : -1;
        if (other.offset > 0.5) dir = -1;
        else if (other.offset < -0.5) dir = 1;
        return dir * 1/i * (car.speed - other.speed) / maxSpeed;
      }
    }
  }

  // kembali ke jalan kalau terlalu melebar
  if (car.offset < -0.9) return 0.1;
  if (car.offset >  0.9) return -0.1;
  return 0;
}

function fmtDist(m) {
  return (m / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' km';
}

function gameOver() {
  state = 'gameover';
  setEngine(0);
  setSkid(0, 900);
  duckMusic();
  const score = Math.floor(totalDist);
  const newRecord = score > best;
  if (newRecord) {
    best = score;
    localStorage.setItem('tr_best', String(best));
  }
  playGameOver(newRecord);
  $('go-score').textContent = 'Skor: ' + fmtDist(score);
  $('go-best').textContent  = 'Rekor: ' + fmtDist(best);
  show($('gameover'));
}

// ==================== HUD ====================
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

const hudCache = {};
function updateHud() {
  const kmh = Math.round(speed / maxSpeed * 320);
  const score = Math.floor(totalDist);
  if (hudCache.kmh !== kmh) { hudCache.kmh = kmh; $('speed-value').textContent = kmh; }
  if (hudCache.score !== score) {
    hudCache.score = score;
    $('score-value').textContent = fmtDist(score);
  }
  if (hudCache.best !== best) { hudCache.best = best; $('best-value').textContent = fmtDist(best); }
  if (hudCache.hearts !== hearts) {
    hudCache.hearts = hearts;
    $('hearts').textContent = '❤'.repeat(hearts) + '🖤'.repeat(3 - hearts);
  }
}

// ==================== RENDER ====================
function drawBackground() {
  // langit
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.5);
  g.addColorStop(0, '#2f9fe3');
  g.addColorStop(1, '#cfeaf7');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // matahari
  const sun = ctx.createRadialGradient(W*0.76, H*0.16, 4, W*0.76, H*0.16, 60);
  sun.addColorStop(0, 'rgba(255,244,200,0.95)');
  sun.addColorStop(0.3, 'rgba(255,236,160,0.55)');
  sun.addColorStop(1, 'rgba(255,236,160,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(W*0.76-70, H*0.16-70, 140, 140);

  // bukit jauh (parallax halus)
  const yBase = H * 0.5;
  const scroll = (position * 0.00018) % 2000;
  const climb  = playerYNow * 0.04;

  ctx.fillStyle = '#9cc4a4';
  ctx.beginPath();
  ctx.moveTo(0, yBase - climb);
  for (let x = 0; x <= W; x += 16) {
    const t = (x + scroll * 0.5) / W;
    ctx.lineTo(x, yBase - climb - 46 - Math.sin(t * 12) * 16 - Math.sin(t * 5.3) * 26);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = '#6fa86f';
  ctx.beginPath();
  ctx.moveTo(0, yBase - climb);
  for (let x = 0; x <= W; x += 16) {
    const t = (x + scroll) / W;
    ctx.lineTo(x, yBase - climb - 22 - Math.sin(t * 9 + 2) * 18 - Math.sin(t * 4) * 22);
  }
  ctx.lineTo(W, H); ctx.lineTo(0, H);
  ctx.closePath(); ctx.fill();
}

let playerYNow = 0;

function render() {
  const baseSegment = findSegment(position);
  const basePercent = Util.percentRemaining(position, SEGMENT_LENGTH);
  const playerSegment = findSegment(position + playerZ);
  const playerPercent = Util.percentRemaining(position + playerZ, SEGMENT_LENGTH);
  playerYNow = Util.interpolate(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);

  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random()-0.5) * shake * 14, (Math.random()-0.5) * shake * 14);
  }
  ctx.clearRect(0, 0, W, H);
  drawBackground();

  let maxy = H;
  let x = 0;
  let dx = -(baseSegment.curve * basePercent);
  const cameraY = playerYNow + CAMERA_HEIGHT;

  // pass 1: jalan (terdekat → terjauh)
  for (let n = 0; n < DRAW_DISTANCE; n++) {
    const segment = segments[(baseSegment.index + n) % segments.length];
    segment.looped = segment.index < baseSegment.index;
    segment.fog = Util.exponentialFog(n / DRAW_DISTANCE, FOG_DENSITY);
    segment.clip = maxy;

    Util.project(segment.p1, (playerX * ROAD_WIDTH) - x, cameraY,
                 position - (segment.looped ? trackLength : 0), ROAD_WIDTH);
    Util.project(segment.p2, (playerX * ROAD_WIDTH) - x - dx, cameraY,
                 position - (segment.looped ? trackLength : 0), ROAD_WIDTH);

    x  += dx;
    dx += segment.curve;

    if (segment.p1.camera.z <= cameraDepth ||   // di belakang kamera
        segment.p2.screen.y >= segment.p1.screen.y || // menghadap ke belakang
        segment.p2.screen.y >= maxy)             // tertutup bukit
      continue;

    drawSegment(segment);
    maxy = segment.p1.screen.y;
  }

  // pass 2: sprite & mobil (terjauh → terdekat)
  for (let n = DRAW_DISTANCE - 1; n > 0; n--) {
    const segment = segments[(baseSegment.index + n) % segments.length];
    if (segment.p1.camera.z <= cameraDepth) continue;

    // mobil AI
    for (const car of segment.cars) {
      const scale = Util.interpolate(segment.p1.screen.scale, segment.p2.screen.scale, car.percent);
      const sx = Util.interpolate(segment.p1.screen.x, segment.p2.screen.x, car.percent) + scale * car.offset * ROAD_WIDTH * W/2;
      const sy = Util.interpolate(segment.p1.screen.y, segment.p2.screen.y, car.percent);
      ctx.globalAlpha = Math.max(0.45, segment.fog);
      drawSpriteWorld(car.sprite, scale, sx, sy, -0.5, -1, segment.clip);
      ctx.globalAlpha = 1;
    }

    // pohon / billboard
    for (const spr of segment.sprites) {
      const scale = segment.p1.screen.scale;
      const sx = segment.p1.screen.x + scale * spr.offset * ROAD_WIDTH * W/2;
      const sy = segment.p1.screen.y;
      ctx.globalAlpha = Math.max(0.55, segment.fog);
      drawSpriteWorld(spr.source, scale, sx, sy, spr.offset < 0 ? -1 : 0, -1, segment.clip);
      ctx.globalAlpha = 1;
    }

    // mobil pemain
    if (segment === playerSegment) {
      const playerScale = cameraDepth / playerZ;
      const playerCamY = Util.interpolate(playerSegment.p1.camera.y, playerSegment.p2.camera.y, playerPercent);
      const steer = keys.left ? -1 : keys.right ? 1 : 0;
      const bounce = (1.5 * Math.random() * (speed / maxSpeed)) * Util.randomChoice([-1, 1]);
      drawSpriteWorld(S.PLAYER, playerScale, W/2, H/2 - playerScale * playerCamY * H/2 + bounce, -0.5, -1, H);
    }
  }

  ctx.restore();

  // kilatan tabrakan
  if (crashFlash > 0) {
    ctx.fillStyle = 'rgba(255,40,40,' + (crashFlash * 0.35).toFixed(3) + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

function drawSegment(segment) {
  const p1 = segment.p1.screen, p2 = segment.p2.screen;
  const color = segment.color;
  const r1 = p1.w / Math.max(6, 2 * LANES);
  const r2 = p2.w / Math.max(6, 2 * LANES);
  const l1 = p1.w / Math.max(32, 8 * LANES);
  const l2 = p2.w / Math.max(32, 8 * LANES);

  // rumput
  ctx.fillStyle = color.grass;
  ctx.fillRect(0, p2.y, W, p1.y - p2.y);

  // strip rumble kiri & kanan
  polygon(p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, color.rumble);
  polygon(p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, color.rumble);
  // aspal
  polygon(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, color.road);

  // marka lajur (hanya segmen "terang" → jadi putus-putus)
  if (color.lane) {
    const lanew1 = p1.w * 2 / LANES;
    const lanew2 = p2.w * 2 / LANES;
    let lanex1 = p1.x - p1.w + lanew1;
    let lanex2 = p2.x - p2.w + lanew2;
    for (let lane = 1; lane < LANES; lanex1 += lanew1, lanex2 += lanew2, lane++) {
      polygon(lanex1 - l1/2, p1.y, lanex1 + l1/2, p1.y, lanex2 + l2/2, p2.y, lanex2 - l2/2, p2.y, color.lane);
    }
  }

  // kabut jarak
  if (segment.fog < 1) {
    ctx.globalAlpha = 1 - segment.fog;
    ctx.fillStyle = COLORS.FOG;
    ctx.fillRect(0, p2.y, W, p1.y - p2.y);
    ctx.globalAlpha = 1;
  }
}

function polygon(x1,y1,x2,y2,x3,y3,x4,y4,color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.lineTo(x3,y3); ctx.lineTo(x4,y4);
  ctx.closePath();
  ctx.fill();
}

function drawSpriteWorld(sprite, scale, destX, destY, offsetX, offsetY, clipY) {
  let destW = sprite.w * scale * W/2 * SPRITE_SCALE;
  let destH = sprite.h * scale * W/2 * SPRITE_SCALE;
  destX += destW * (offsetX || 0);
  destY += destH * (offsetY || 0);

  // clip agar sprite tidak menembus segmen yang lebih dekat
  const over = destY + destH - clipY;
  if (over > 0) destH -= over;
  if (destH <= 0 || destW <= 0) return;
  if (destX + destW < 0 || destX > W) return; // di luar layar horizontal

  drawSprite(sprite, destX, destY, destW, destH);
}

// ==================== GAME FLOW ====================
function resetRace() {
  resetRoad();
  resetSprites();
  resetCars(120);
  position = 0;
  speed = 0;
  playerX = 0;
  totalDist = 0;
  hearts = 3;
  invuln = 0;
  crashFlash = 0;
  shake = 0;
  countdownT = 3;
  lastBeepInt = 3;
  hide($('menu')); hide($('gameover')); hide($('paused'));
  show($('hud'));
  show($('countdown'));
  $('countdown-text').textContent = '3';
  state = 'countdown';
  updateHud();
}

function startGame() {
  initAudio();
  resetRace();
}

function togglePause() {
  if (state === 'racing') {
    state = 'paused';
    setEngine(0);
    setSkid(0, 900);
    duckMusic();
    show($('paused'));
  } else if (state === 'paused') {
    state = 'racing';
    hide($('paused'));
    restoreMusic();
  }
}

// ==================== INPUT ====================
const keyMap = {
  'ArrowLeft': 'left', 'a': 'left', 'A': 'left',
  'ArrowRight':'right', 'd': 'right', 'D': 'right',
  'ArrowUp': 'up', 'w': 'up', 'W': 'up',
  'ArrowDown': 'down', 's': 'down', 'S': 'down'
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    if (state === 'menu' || state === 'gameover') { e.preventDefault(); startGame(); return; }
  }
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
    if (state === 'racing' || state === 'paused') { e.preventDefault(); togglePause(); return; }
  }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  const k = keyMap[e.key];
  if (k) { e.preventDefault(); keys[k] = true; initAudio(); }
});

document.addEventListener('keyup', (e) => {
  const k = keyMap[e.key];
  if (k) { keys[k] = false; }
});

// kontrol sentuh
const touchEl = $('touch');
const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0 ||
                (window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
if (isTouch) touchEl.classList.remove('hidden');

for (const btn of touchEl.querySelectorAll('.t-btn')) {
  const k = btn.dataset.k;
  const set = (v) => { keys[k] = v; if (v) initAudio(); };
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); set(true); });
  btn.addEventListener('pointerup',    () => set(false));
  btn.addEventListener('pointerleave', () => set(false));
  btn.addEventListener('pointercancel',() => set(false));
}

$('start-btn').addEventListener('click', startGame);
$('again-btn').addEventListener('click', startGame);

// ==================== GAME LOOP ====================
let last = performance.now();
let acc = 0;

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let steps = 0;
  while (acc >= STEP && steps < 4) {
    update(STEP);
    acc -= STEP;
    steps++;
  }
  if (steps === 4) acc = 0;

  if (state === 'menu') {
    // mode demo: jalan perlahan melaju
    position = Util.increase(position, dt * maxSpeed * 0.12, trackLength);
  }

  render();

  // HUD countdown
  if (state === 'countdown') {
    const t = Math.max(0, Math.ceil(countdownT));
    $('countdown-text').textContent = t === 0 ? 'GO!' : String(t);
    hide($('hud'));
  } else if (state === 'racing' || state === 'gameover') {
    hide($('countdown'));
    if (state === 'racing') show($('hud'));
  }

  requestAnimationFrame(frame);
}

// ==================== INIT ====================
resetRoad();
resetSprites();
resetCars(120);
playerYNow = 0;
$('menu-best').textContent = best > 0 ? 'Rekor: ' + fmtDist(best) : '';
$('best-value').textContent = fmtDist(best);
updateHud();
requestAnimationFrame(frame);

// hook tes (dipakai oleh test harness / konsol)
window.__tr = {
  getState: () => state, getSpeed: () => speed, setState: s => state = s,
  gameOver, resize, toggleMute,
  getMusic: () => ({ playing: music.playing, step: music.step, gain: music.gain ? +music.gain.gain.value.toFixed(3) : 0 }),
  getSkid: () => skidGain ? +skidGain.gain.value.toFixed(3) : 0
};

