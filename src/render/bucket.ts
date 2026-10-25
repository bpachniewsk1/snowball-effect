// A little pixel-art bucket of lava that boils harder as `heat` goes 0 → 1, and erupts on demand.

const W = 48;
const H = 48;

interface Bit {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

export class LavaBucketView {
  private ctx: CanvasRenderingContext2D;
  private heat = 0;
  private t = 0;
  private last = 0;
  private bubbles: Bit[] = [];
  private steam: Bit[] = [];
  private blast: Bit[] = [];
  private smoke = 0;
  private raf = 0;
  private alive = true;

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    const loop = (now: number) => {
      if (!this.alive || !canvas.isConnected) return;
      const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
      this.last = now;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  setHeat(h: number): void {
    this.heat = Math.max(0, Math.min(1, h));
  }

  /** Big splash of lava; the bucket smokes for a moment afterwards. */
  erupt(): void {
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.6;
      const v = 30 + Math.random() * 70;
      this.blast.push({
        x: 24,
        y: 17,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 1.2 + Math.random() * 0.6,
        color: ['#ffef3a', '#ff9b29', '#ff4d1a', '#c4001a'][Math.floor(Math.random() * 4)],
        size: Math.random() < 0.3 ? 2 : 1,
      });
    }
    this.smoke = 2;
    this.heat = 0;
  }

  destroy(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
  }

  private update(dt: number): void {
    this.t += dt;
    this.smoke = Math.max(0, this.smoke - dt);
    const h = this.heat;

    // Bubbles pop more often as it heats up.
    if (Math.random() < (0.5 + h * 9) * dt) {
      this.bubbles.push({ x: 13 + Math.random() * 22, y: 19, vx: 0, vy: 0, life: 0.25 + Math.random() * 0.35, color: '', size: 1 + Math.floor(Math.random() * (1 + h * 2)) });
    }
    // Steam after half-way, smoke after an eruption.
    if (Math.random() < (Math.max(0, h - 0.4) * 14 + this.smoke * 10) * dt) {
      this.steam.push({ x: 14 + Math.random() * 20, y: 15, vx: (Math.random() - 0.5) * 6, vy: -10 - Math.random() * 10, life: 1, color: this.smoke > 0 ? '#555' : '#e8f3fa', size: 1 + (Math.random() < 0.4 ? 1 : 0) });
    }
    for (const list of [this.bubbles, this.steam, this.blast]) {
      for (const b of list) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (list === this.blast) b.vy += 90 * dt;
      }
    }
    this.bubbles = this.bubbles.filter((b) => b.life > 0);
    this.steam = this.steam.filter((b) => b.life > 0);
    this.blast = this.blast.filter((b) => b.life > 0);
  }

  private draw(): void {
    const { ctx } = this;
    const h = this.heat;
    ctx.clearRect(0, 0, W, H);
    const shake = h > 0.8 ? Math.round((Math.random() - 0.5) * 2 * (h - 0.8) * 10) : 0;
    ctx.save();
    ctx.translate(shake, 0);

    // Glow behind the bucket.
    if (h > 0.2) {
      const g = ctx.createRadialGradient(24, 22, 2, 24, 22, 26);
      g.addColorStop(0, `rgba(255,120,30,${0.15 + h * 0.45})`);
      g.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Handle.
    ctx.fillStyle = '#3a3f4a';
    for (let x = 10; x <= 38; x++) {
      const y = Math.round(16 - Math.sqrt(Math.max(0, 196 - (x - 24) ** 2)) * 0.75);
      ctx.fillRect(x, y, 1, 1);
    }

    // Bucket body: a trapezoid with outline, shading and a highlight stripe.
    const flash = h > 0.85 && Math.floor(this.t * 12) % 2 === 0;
    for (let y = 17; y <= 43; y++) {
      const k = (y - 17) / 26;
      const half = Math.round(15 - k * 3);
      ctx.fillStyle = flash ? '#c4001a' : '#2a2e36';
      ctx.fillRect(24 - half - 1, y, half * 2 + 2, 1);
      ctx.fillStyle = '#8a96a8';
      ctx.fillRect(24 - half, y, half * 2, 1);
      ctx.fillStyle = '#c5d0dc';
      ctx.fillRect(24 - half + 3, y, 2, 1);
      ctx.fillStyle = '#5f6b7d';
      ctx.fillRect(24 + half - 4, y, 3, 1);
    }
    ctx.fillStyle = '#2a2e36';
    ctx.fillRect(12, 44, 25, 1);
    // Metal bands.
    ctx.fillStyle = '#5f6b7d';
    ctx.fillRect(10, 22, 29, 1);
    ctx.fillRect(12, 38, 25, 1);

    // Lava surface (wobbles more when hot).
    const lava = ['#ff9b29', '#ff7a1a', '#ff4d1a'];
    for (let x = 10; x <= 38; x++) {
      const wob = Math.round(Math.sin(x * 0.7 + this.t * (2 + h * 10)) * (0.5 + h * 1.2));
      ctx.fillStyle = lava[(x + Math.floor(this.t * (3 + h * 8))) % 3];
      ctx.fillRect(x, 16 + wob, 1, 4 - wob);
    }
    ctx.fillStyle = '#ffef3a';
    for (let i = 0; i < 4; i++) ctx.fillRect(13 + ((i * 7 + Math.floor(this.t * 5)) % 22), 17 + (i % 2), 2, 1);

    // Bubbles.
    for (const b of this.bubbles) {
      ctx.fillStyle = b.life < 0.1 ? '#ffef3a' : '#ff4d1a';
      ctx.fillRect(Math.round(b.x), Math.round(b.y - b.size * 2), b.size, b.size);
    }
    ctx.restore();

    // Steam / smoke.
    for (const s of this.steam) {
      ctx.globalAlpha = Math.max(0, s.life * 0.8);
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
    }
    // Eruption blobs.
    for (const b of this.blast) {
      ctx.globalAlpha = Math.max(0, Math.min(1, b.life));
      ctx.fillStyle = b.color;
      ctx.fillRect(Math.round(b.x), Math.round(b.y), b.size, b.size);
    }
    ctx.globalAlpha = 1;
  }
}
