const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const overlay = document.getElementById("overlay");
const titleEl = document.getElementById("title");
const messageEl = document.getElementById("message");
const startBtn = document.getElementById("startBtn");
const muteBtn = document.getElementById("muteBtn");
const pauseBtn = document.getElementById("pauseBtn");
const levelEl = document.getElementById("level");
const difficultyEl = document.getElementById("difficulty");
const difficultyBtns = difficultyEl.querySelectorAll("button");

const SIZE = 400;
const GRID = 20;                        // 20x20 격자
const CELL = SIZE / GRID;               // 칸 크기 (20px)
const BEST_KEY = "snakeBestScore";
const MUTE_KEY = "snakeMuted";
const DIFFICULTY_KEY = "snakeDifficulty";

// 난이도별 한 칸 이동 간격 (ms)
const DIFFICULTIES = {
  easy: 200,
  normal: 150,
  hard: 100,
  extreme: 50,
};
const POINTS_PER_LEVEL = 50;            // 50점마다 레벨업
const LEVEL_SPEEDUP = 10;               // 레벨업마다 10ms씩 빨라짐
const MIN_SPEED = 30;                   // 너무 빨라지지 않도록 하한선

// 고해상도 화면에서도 선명하게
const dpr = window.devicePixelRatio || 1;
canvas.width = SIZE * dpr;
canvas.height = SIZE * dpr;
ctx.scale(dpr, dpr);

const KEYS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

let snake, prevSnake, direction, inputQueue, food, score;
let running = false;
let paused = false;
let dead = false;
let difficulty = localStorage.getItem(DIFFICULTY_KEY);
if (!DIFFICULTIES[difficulty]) difficulty = "normal";
let level = 1;
let speed = DIFFICULTIES[difficulty];
let acc = 0;
let lastTime = 0;
let particles = [];
let popups = [];
let shake = 0;
let flash = 0;
let best = Number(localStorage.getItem(BEST_KEY)) || 0;
bestEl.textContent = best;

/* ---------------- 소리 (Web Audio API로 직접 합성) ---------------- */

const Sound = {
  ctx: null,
  muted: localStorage.getItem(MUTE_KEY) === "1",

  // 브라우저 정책상 사용자 입력 후에 오디오를 켜야 함
  init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === "suspended") this.ctx.resume();
  },

  tone(freq, dur, { type = "sine", vol = 0.2, delay = 0, slideTo } = {}) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  },

  start() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone(f, 0.18, { type: "triangle", vol: 0.15, delay: i * 0.07 })
    );
  },
  eat() {
    this.tone(660, 0.1, { type: "square", vol: 0.06, slideTo: 1320 });
    this.tone(1320, 0.12, { type: "sine", vol: 0.08, delay: 0.05 });
  },
  turn() {
    this.tone(280, 0.04, { type: "sine", vol: 0.04 });
  },
  gameOver() {
    this.tone(440, 0.6, { type: "sawtooth", vol: 0.1, slideTo: 60 });
    this.tone(220, 0.6, { type: "square", vol: 0.05, slideTo: 40, delay: 0.05 });
  },
  levelUp() {
    [659, 880, 1319].forEach((f, i) =>
      this.tone(f, 0.15, { type: "square", vol: 0.07, delay: 0.08 + i * 0.08 })
    );
  },
  pause() {
    this.tone(880, 0.08, { type: "sine", vol: 0.1 });
    this.tone(587, 0.1, { type: "sine", vol: 0.1, delay: 0.08 });
  },
  resume() {
    this.tone(587, 0.08, { type: "sine", vol: 0.1 });
    this.tone(880, 0.1, { type: "sine", vol: 0.1, delay: 0.08 });
  },
  record() {
    [784, 988, 1175, 1568].forEach((f, i) =>
      this.tone(f, 0.25, { type: "triangle", vol: 0.14, delay: 0.6 + i * 0.1 })
    );
  },
};

function updateMuteBtn() {
  muteBtn.textContent = Sound.muted ? "🔇" : "🔊";
}

function toggleMute() {
  Sound.init();
  Sound.muted = !Sound.muted;
  localStorage.setItem(MUTE_KEY, Sound.muted ? "1" : "0");
  updateMuteBtn();
  muteBtn.blur();
}

/* ---------------- 게임 로직 ---------------- */

function reset() {
  snake = [
    { x: 10, y: 10 },
    { x: 9, y: 10 },
    { x: 8, y: 10 },
  ];
  prevSnake = snake.map((s) => ({ ...s }));
  direction = { x: 1, y: 0 };
  inputQueue = [];
  dead = false;
  paused = false;
  score = 0;
  scoreEl.textContent = score;
  level = 1;
  levelEl.textContent = level;
  speed = DIFFICULTIES[difficulty];
  particles = [];
  popups = [];
  placeFood();
}

function startGame() {
  Sound.init();
  reset();
  acc = 0;
  running = true;
  overlay.classList.add("hidden");
  startBtn.blur();
  updateControls();
  Sound.start();
}

/* ---------------- 난이도 / 일시정지 / 레벨 ---------------- */

function setDifficulty(name) {
  if (running || !DIFFICULTIES[name]) return;
  difficulty = name;
  speed = DIFFICULTIES[name];
  localStorage.setItem(DIFFICULTY_KEY, name);
  difficultyBtns.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.level === name)
  );
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  if (paused) {
    Sound.pause();
  } else {
    Sound.resume();
  }
  updateControls();
  pauseBtn.blur();
}

// 게임 상태에 맞춰 버튼 표시/활성화
function updateControls() {
  pauseBtn.disabled = !running;
  pauseBtn.textContent = paused ? "▶ 재개" : "⏸ 일시정지";
  pauseBtn.classList.toggle("paused", paused);
  // 게임 중에는 난이도 변경 불가
  difficultyBtns.forEach((btn) => (btn.disabled = running));
}

function checkLevelUp() {
  const newLevel = Math.floor(score / POINTS_PER_LEVEL) + 1;
  if (newLevel <= level) return;
  level = newLevel;
  levelEl.textContent = level;
  bump(levelEl);
  speed = Math.max(MIN_SPEED, DIFFICULTIES[difficulty] - (level - 1) * LEVEL_SPEEDUP);
  popups.push({ x: SIZE / 2, y: SIZE / 2, life: 1.5, text: "LEVEL UP!", big: true });
  Sound.levelUp();
}

function placeFood() {
  do {
    food = {
      x: Math.floor(Math.random() * GRID),
      y: Math.floor(Math.random() * GRID),
    };
  } while (snake.some((s) => s.x === food.x && s.y === food.y));
}

function step() {
  if (inputQueue.length) direction = inputQueue.shift();
  const head = { x: snake[0].x + direction.x, y: snake[0].y + direction.y };

  // 벽 충돌
  if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
    return gameOver();
  }

  const ate = head.x === food.x && head.y === food.y;
  // 먹지 않았다면 꼬리가 빠지므로 꼬리 칸은 충돌 검사에서 제외
  const body = ate ? snake : snake.slice(0, -1);
  if (body.some((s) => s.x === head.x && s.y === head.y)) {
    return gameOver();
  }

  prevSnake = snake.map((s) => ({ ...s }));
  snake.unshift(head);

  if (ate) {
    score += 10;
    scoreEl.textContent = score;
    bump(scoreEl);
    burst(food.x, food.y);
    popups.push({ x: food.x * CELL + CELL / 2, y: food.y * CELL, life: 1, text: "+10" });
    Sound.eat();
    checkLevelUp();
    placeFood();
  } else {
    snake.pop();
  }
}

function gameOver() {
  running = false;
  paused = false;
  dead = true;
  updateControls();
  prevSnake = snake.map((s) => ({ ...s }));
  shake = 12;
  flash = 1;
  Sound.gameOver();

  const isRecord = score > best;
  if (isRecord) {
    best = score;
    localStorage.setItem(BEST_KEY, best);
    bestEl.textContent = best;
    bump(bestEl);
    Sound.record();
  }

  setTimeout(() => {
    if (running) return; // 그 사이 이미 재시작한 경우
    titleEl.textContent = "GAME OVER";
    titleEl.classList.add("over");
    messageEl.textContent = isRecord
      ? `🏆 최고 기록 달성!\n점수: ${score} · 레벨 ${level}`
      : `점수: ${score} · 레벨 ${level}`;
    startBtn.textContent = "다시 시작";
    overlay.classList.remove("hidden");
  }, 500);
}

function bump(el) {
  el.classList.add("bump");
  setTimeout(() => el.classList.remove("bump"), 150);
}

/* ---------------- 효과 ---------------- */

function burst(gx, gy) {
  const cx = gx * CELL + CELL / 2;
  const cy = gy * CELL + CELL / 2;
  for (let i = 0; i < 18; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 110;
    particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1,
      size: 1.5 + Math.random() * 2.5,
      hue: Math.random() < 0.5 ? 350 : 40,
    });
  }
}

function updateEffects(dt) {
  const s = dt / 1000;
  particles.forEach((p) => {
    p.x += p.vx * s;
    p.y += p.vy * s;
    p.vx *= 0.94;
    p.vy *= 0.94;
    p.life -= s * 1.6;
  });
  particles = particles.filter((p) => p.life > 0);

  popups.forEach((p) => {
    p.y -= 30 * s;
    p.life -= s * 1.2;
  });
  popups = popups.filter((p) => p.life > 0);

  shake = Math.max(0, shake - dt * 0.04);
  flash = Math.max(0, flash - s * 2.5);
}

/* ---------------- 그리기 ---------------- */

// 배경은 한 번만 그려두고 재사용
const bgCanvas = document.createElement("canvas");
bgCanvas.width = SIZE * dpr;
bgCanvas.height = SIZE * dpr;
(function drawBackground() {
  const b = bgCanvas.getContext("2d");
  b.scale(dpr, dpr);

  const grad = b.createRadialGradient(SIZE / 2, SIZE / 2, 50, SIZE / 2, SIZE / 2, SIZE * 0.75);
  grad.addColorStop(0, "#152036");
  grad.addColorStop(1, "#090d18");
  b.fillStyle = grad;
  b.fillRect(0, 0, SIZE, SIZE);

  // 은은한 체크무늬
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if ((x + y) % 2 === 0) {
        b.fillStyle = "rgba(255, 255, 255, 0.025)";
        b.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  // 격자 교차점에 작은 점
  b.fillStyle = "rgba(61, 255, 176, 0.12)";
  for (let y = 1; y < GRID; y++) {
    for (let x = 1; x < GRID; x++) {
      b.beginPath();
      b.arc(x * CELL, y * CELL, 0.8, 0, Math.PI * 2);
      b.fill();
    }
  }
})();

function drawFood(time) {
  const cx = food.x * CELL + CELL / 2;
  const cy = food.y * CELL + CELL / 2;
  const pulse = 1 + Math.sin(time / 180) * 0.1;
  const r = (CELL / 2 - 2) * pulse;

  // 바닥 광채
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, CELL * 1.4);
  glow.addColorStop(0, "rgba(255, 77, 109, 0.45)");
  glow.addColorStop(1, "rgba(255, 77, 109, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - CELL * 1.5, cy - CELL * 1.5, CELL * 3, CELL * 3);

  // 열매 본체
  const body = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  body.addColorStop(0, "#ffb3c1");
  body.addColorStop(0.45, "#ff4d6d");
  body.addColorStop(1, "#a4133c");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // 잎사귀
  ctx.fillStyle = "#3dffb0";
  ctx.beginPath();
  ctx.ellipse(cx + r * 0.35, cy - r * 0.95, r * 0.4, r * 0.18, -0.6, 0, Math.PI * 2);
  ctx.fill();

  // 하이라이트
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.35, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawSnake(t) {
  const n = snake.length;

  // 이전 위치 → 현재 위치를 보간해서 부드럽게 이동
  const pts = snake.map((s, i) => {
    const p = prevSnake[Math.min(i, prevSnake.length - 1)];
    return {
      x: (p.x + (s.x - p.x) * t) * CELL + CELL / 2,
      y: (p.y + (s.y - p.y) * t) * CELL + CELL / 2,
    };
  });

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 몸통 광채
  ctx.save();
  ctx.shadowColor = dead ? "rgba(255, 77, 109, 0.8)" : "rgba(61, 255, 176, 0.6)";
  ctx.shadowBlur = 16;
  ctx.strokeStyle = "rgba(61, 255, 176, 0.25)";
  ctx.lineWidth = CELL * 0.8;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.restore();

  // 몸통: 꼬리로 갈수록 가늘고 어두워짐
  for (let i = n - 1; i > 0; i--) {
    const k = i / n;
    const light = 62 - k * 28;
    ctx.strokeStyle = dead ? `hsl(350, 70%, ${light}%)` : `hsl(${155 + k * 30}, 85%, ${light}%)`;
    ctx.lineWidth = CELL * (0.82 - k * 0.32);
    ctx.beginPath();
    ctx.moveTo(pts[i].x, pts[i].y);
    ctx.lineTo(pts[i - 1].x, pts[i - 1].y);
    ctx.stroke();
  }

  // 비늘 무늬
  ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
  for (let i = 1; i < n; i++) {
    const r = CELL * (0.18 - (i / n) * 0.08);
    ctx.beginPath();
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 머리
  const h = pts[0];
  const hr = CELL * 0.5;
  const headGrad = ctx.createRadialGradient(h.x - 3, h.y - 3, 1, h.x, h.y, hr);
  headGrad.addColorStop(0, dead ? "#ffccd5" : "#c8ffe8");
  headGrad.addColorStop(1, dead ? "#ff4d6d" : "#3dffb0");
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.arc(h.x, h.y, hr, 0, Math.PI * 2);
  ctx.fill();

  // 눈: 진행 방향을 바라봄
  const d = direction;
  const px = -d.y;
  const py = d.x;
  [-1, 1].forEach((side) => {
    const ex = h.x + d.x * 3 + px * side * 4.5;
    const ey = h.y + d.y * 3 + py * side * 4.5;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ex, ey, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0b0f1a";
    ctx.beginPath();
    if (dead) {
      // 게임 오버 시 X 눈
      ctx.strokeStyle = "#0b0f1a";
      ctx.lineWidth = 1.5;
      ctx.moveTo(ex - 2, ey - 2);
      ctx.lineTo(ex + 2, ey + 2);
      ctx.moveTo(ex + 2, ey - 2);
      ctx.lineTo(ex - 2, ey + 2);
      ctx.stroke();
    } else {
      ctx.arc(ex + d.x * 1.2, ey + d.y * 1.2, 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawEffects() {
  particles.forEach((p) => {
    ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${p.life})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  popups.forEach((p) => {
    ctx.font = p.big ? "900 30px Orbitron, sans-serif" : "700 14px Orbitron, sans-serif";
    ctx.fillStyle = p.big
      ? `rgba(255, 214, 10, ${Math.min(p.life, 1)})`
      : `rgba(61, 255, 176, ${p.life})`;
    ctx.fillText(p.text, p.x, p.y);
  });

  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 77, 109, ${flash * 0.25})`;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  if (paused) {
    ctx.fillStyle = "rgba(8, 12, 22, 0.6)";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.font = "900 32px Orbitron, sans-serif";
    ctx.fillStyle = "#3dffb0";
    ctx.fillText("PAUSED", SIZE / 2, SIZE / 2 - 10);
    ctx.font = "600 14px 'Malgun Gothic', sans-serif";
    ctx.fillStyle = "#8a9bb8";
    ctx.fillText("P 키 또는 재개 버튼을 누르세요", SIZE / 2, SIZE / 2 + 24);
  }
}

function render(time) {
  const t = running ? Math.min(acc / speed, 1) : 1;

  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }
  ctx.drawImage(bgCanvas, 0, 0, SIZE, SIZE);
  drawFood(time);
  drawSnake(t);
  drawEffects();
  ctx.restore();
}

/* ---------------- 메인 루프 ---------------- */

function loop(now) {
  const dt = Math.min(now - lastTime, 100);
  lastTime = now;

  if (running && !paused) {
    acc += dt;
    while (acc >= speed && running) {
      acc -= speed;
      step();
    }
  }

  // 일시정지 중에는 효과 애니메이션도 멈춤
  if (!paused) updateEffects(dt);
  render(now);
  requestAnimationFrame(loop);
}

/* ---------------- 입력 ---------------- */

document.addEventListener("keydown", (e) => {
  const dir = KEYS[e.key];

  if (dir) {
    e.preventDefault();
    if (!running || paused) return;
    // 빠른 연속 입력도 놓치지 않도록 최대 2개까지 예약
    const last = inputQueue.length ? inputQueue[inputQueue.length - 1] : direction;
    const isReverse = dir.x === -last.x && dir.y === -last.y;
    const isSame = dir.x === last.x && dir.y === last.y;
    if (!isReverse && !isSame && inputQueue.length < 2) {
      inputQueue.push(dir);
      Sound.turn();
    }
    return;
  }

  if ((e.key === "Enter" || e.key === " ") && !running) {
    e.preventDefault();
    startGame();
  } else if (e.key === "m" || e.key === "M") {
    toggleMute();
  } else if (e.key === "p" || e.key === "P" || e.key === "Escape") {
    togglePause();
  }
});

startBtn.addEventListener("click", startGame);
muteBtn.addEventListener("click", toggleMute);
pauseBtn.addEventListener("click", togglePause);
difficultyBtns.forEach((btn) =>
  btn.addEventListener("click", () => {
    setDifficulty(btn.dataset.level);
    btn.blur();
  })
);

// 창을 벗어나면 자동 일시정지
window.addEventListener("blur", () => {
  if (running && !paused) togglePause();
});

updateMuteBtn();
setDifficulty(difficulty);
updateControls();
reset();
requestAnimationFrame((now) => {
  lastTime = now;
  loop(now);
});
