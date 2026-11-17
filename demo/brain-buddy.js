const trigger = document.querySelector(".buddy-art");
const poster = trigger.querySelector("img");
const canvas = trigger.querySelector("canvas");
const ctx = canvas.getContext("2d");
const announcement = document.querySelector("#buddy-announcement");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const atlas = new Image();
const size = 192;
const columns = 8;
const inset = (canvas.width - size) / 2;

// Authored frame orders and timing from the sandbox's rig-v3 (e14e81ddcbbe).
const clips = {
  blink: {offset: 1, fps: 24, order: [0,1,2,2,3,4,5,0]},
  wave: {offset: 7, fps: 24, still: 14, order: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,16,15,17,18,19,19,18,14,20,21,22,23,24,25,26,27,7,28,29,30,31,32,33,34,35,0]},
  celebrate: {offset: 43, fps: 16, still: 0, apex: 16, order: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,16,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,0]}
};

let action = "idle";
let frameRequest;
let idleTimer;
let queued;

function draw(index) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(atlas, index % columns * size, Math.floor(index / columns) * size,
    size, size, inset, inset, size, size);
}

// The sandbox emits gold sparkles at the jump's high point.
function sparkles(elapsed, still = false) {
  const progress = elapsed / 1150;
  if (progress < 0 || progress >= 1) return;
  const count = still ? 3 : 14;
  const expansion = still ? 0 : 1 - (1 - Math.min(elapsed / 280, 1)) ** 3;
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(.5, .5);
  ctx.globalAlpha = still ? 1 : Math.min(1, .75 + elapsed / 65) * (1 - progress) ** 1.3;
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count + .22;
    const radius = still ? 152 + i * 19 : 125 + i % 3 * 12 + 61 * expansion + 10 * progress;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius * .88 - 38;
    const r = 7 + i % 4 * 3;
    ctx.fillStyle = i % 3 === 0 ? "#a66d1b" : "#db9e2b";
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x + r * .18, y - r * .18, x + r * .72, y);
    ctx.quadraticCurveTo(x + r * .18, y + r * .18, x, y + r);
    ctx.quadraticCurveTo(x - r * .18, y + r * .18, x - r * .72, y);
    ctx.quadraticCurveTo(x - r * .18, y - r * .18, x, y - r);
    ctx.fill();
  }
  ctx.restore();
}

function stop() {
  cancelAnimationFrame(frameRequest);
  clearTimeout(idleTimer);
}

function settle() {
  stop();
  action = trigger.dataset.action = "idle";
  poster.hidden = false;
  canvas.hidden = true;
  if (!document.hidden && !reduced.matches && atlas.naturalWidth && ctx) {
    idleTimer = setTimeout(() => play("blink"), 3000 + Math.random() * 1800);
  }
}

function play(name) {
  // Let a successful save finish celebrating even if the user taps again.
  if (action === "celebrate" && name !== "celebrate") return;
  if (!ctx || document.hidden) return;
  if (!atlas.naturalWidth) {
    if (queued !== "celebrate") queued = name;
    return;
  }

  stop();
  const clip = clips[name];
  action = trigger.dataset.action = name;
  if (reduced.matches) {
    if (name === "blink") return settle();
    draw(clip.offset + clip.still);
    if (name === "celebrate") sparkles(0, true);
    canvas.hidden = false;
    poster.hidden = true;
    idleTimer = setTimeout(settle, 1600);
    return;
  }

  const start = performance.now();
  function next(now) {
    const elapsed = now - start;
    const frame = Math.floor(elapsed * clip.fps / 1000);
    if (frame >= clip.order.length) return settle();
    draw(clip.offset + clip.order[frame]);
    if (name === "celebrate") sparkles(elapsed - clip.apex * 1000 / clip.fps);
    canvas.hidden = false;
    poster.hidden = true;
    frameRequest = requestAnimationFrame(next);
  }
  frameRequest = requestAnimationFrame(next);
}

trigger.addEventListener("click", () => {
  if (action !== "celebrate" && announcement.textContent !== "Brain Buddy waved hello.") {
    announcement.textContent = "Brain Buddy waved hello.";
  }
  play("wave");
});
reduced.addEventListener("change", settle);
document.addEventListener("visibilitychange", settle);
atlas.addEventListener("load", () => {
  if (!queued) return settle();
  const next = queued;
  queued = undefined;
  play(next);
});
atlas.src = "/brain-buddy-actions-v1.webp";

export function celebrateBlueprint() {
  announcement.textContent = "Brain Buddy celebrated your saved Blueprint.";
  play("celebrate");
}
