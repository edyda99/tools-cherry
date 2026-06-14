// canvas-editor.js — reusable client-side image editor (load / crop-frame / export).
// Shared by the image tools (circle-crop, passport photo, resize, convert).
// Transform is normalized (zoom>=1, panN in [0,1]) so preview and export match exactly.
import { placement, coverScale } from './canvas-math.js';

export class CanvasEditor {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.shape = opts.shape || 'rect'; // 'rect' | 'circle'
    this.background = opts.background || null; // CSS color or null (transparent)
    this.img = null;
    this.zoom = 1;
    this.panNX = 0.5;
    this.panNY = 0.5;
    this._listeners = {};
    if (opts.interactive !== false) this._attachPointer();
  }

  on(evt, cb) { (this._listeners[evt] ||= []).push(cb); return this; }
  _emit(evt) { (this._listeners[evt] || []).forEach((cb) => cb(this)); }

  hasImage() { return !!this.img; }

  loadImage(img) {
    this.img = img;
    this.zoom = 1;
    this.panNX = 0.5;
    this.panNY = 0.5;
    this.render();
    this._emit('change');
    return this;
  }

  loadFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Not an image file')); return; }
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); this.loadImage(im); resolve(this); };
      im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not decode image')); };
      im.src = url;
    });
  }

  setShape(shape) { this.shape = shape; this.render(); return this; }
  setBackground(bg) { this.background = bg; this.render(); return this; }

  setZoom(z) { this.zoom = Math.max(1, Math.min(8, z || 1)); this.render(); this._emit('change'); return this; }
  zoomBy(mult) { return this.setZoom(this.zoom * mult); }

  panByPixels(dx, dy) {
    if (!this.img) return this;
    const cw = this.canvas.width, ch = this.canvas.height;
    const p = placement(this.img.width, this.img.height, cw, ch, this.zoom, this.panNX, this.panNY);
    if (p.slackX > 0) this.panNX = Math.min(1, Math.max(0, this.panNX - dx / p.slackX));
    if (p.slackY > 0) this.panNY = Math.min(1, Math.max(0, this.panNY - dy / p.slackY));
    this.render();
    this._emit('change');
    return this;
  }

  // Draw image (and optional bg / circle clip) into an arbitrary 2d context sized cw×ch.
  _drawTo(ctx, cw, ch) {
    ctx.clearRect(0, 0, cw, ch);
    if (this.background) { ctx.fillStyle = this.background; ctx.fillRect(0, 0, cw, ch); }
    if (!this.img) return;
    ctx.save();
    if (this.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, Math.min(cw, ch) / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    const p = placement(this.img.width, this.img.height, cw, ch, this.zoom, this.panNX, this.panNY);
    ctx.drawImage(this.img, p.offX, p.offY, p.dw, p.dh);
    ctx.restore();
  }

  render() { this._drawTo(this.ctx, this.canvas.width, this.canvas.height); }

  // Export at an arbitrary output resolution, preserving the same framing.
  toBlob({ type = 'image/png', quality = 0.92, width, height } = {}) {
    const w = width || this.canvas.width;
    const h = height || this.canvas.height;
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    this._drawTo(off.getContext('2d'), w, h);
    return new Promise((resolve) => off.toBlob((b) => resolve(b), type, quality));
  }

  reset() { this.zoom = 1; this.panNX = 0.5; this.panNY = 0.5; this.render(); this._emit('change'); }

  _attachPointer() {
    const c = this.canvas;
    let dragging = false, lastX = 0, lastY = 0;
    const scaleFactor = () => c.width / c.getBoundingClientRect().width; // CSS px -> canvas px
    c.style.touchAction = 'none';
    c.style.cursor = 'grab';
    const down = (x, y) => { dragging = true; lastX = x; lastY = y; c.style.cursor = 'grabbing'; };
    const move = (x, y) => {
      if (!dragging) return;
      const f = scaleFactor();
      this.panByPixels((x - lastX) * f, (y - lastY) * f);
      lastX = x; lastY = y;
    };
    const up = () => { dragging = false; c.style.cursor = 'grab'; };
    c.addEventListener('pointerdown', (e) => { down(e.clientX, e.clientY); c.setPointerCapture(e.pointerId); });
    c.addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
  }
}
