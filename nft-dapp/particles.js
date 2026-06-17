(function () {
  const canvas = document.getElementById("particleCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  let W, H, mouse = { x: -999, y: -999 };
  const COLORS = ["167,139,250", "236,72,153", "6,182,212", "124,58,237"];
  const COUNT  = window.innerWidth < 600 ? 40 : 70;
  const LINK   = 130;

  let particles = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  class Dot {
    constructor() { this.init(); }
    init() {
      this.x  = Math.random() * W;
      this.y  = Math.random() * H;
      this.vx = (Math.random() - 0.5) * 0.35;
      this.vy = (Math.random() - 0.5) * 0.35;
      this.r  = Math.random() * 1.4 + 0.4;
      this.c  = COLORS[Math.floor(Math.random() * COLORS.length)];
      this.a  = Math.random() * 0.45 + 0.15;
    }
    step() {
      this.x += this.vx;
      this.y += this.vy;
      if (this.x < 0 || this.x > W) this.vx *= -1;
      if (this.y < 0 || this.y > H) this.vy *= -1;
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.c},${this.a})`;
      ctx.fill();
    }
  }

  function link(a, b) {
    const dx   = a.x - b.x;
    const dy   = a.y - b.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > LINK) return;
    const alpha = 0.18 * (1 - dist / LINK);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `rgba(124,58,237,${alpha})`;
    ctx.lineWidth   = 0.6;
    ctx.stroke();
  }

  function frame() {
    ctx.clearRect(0, 0, W, H);
    for (let i = 0; i < particles.length; i++) {
      particles[i].step();
      particles[i].draw();
      for (let j = i + 1; j < particles.length; j++) {
        link(particles[i], particles[j]);
      }
    }
    requestAnimationFrame(frame);
  }

  function boot() {
    resize();
    particles = Array.from({ length: COUNT }, () => new Dot());
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", e => { mouse.x = e.clientX; mouse.y = e.clientY; });
    frame();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
