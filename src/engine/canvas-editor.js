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
    this.borderColor = opts.borderColor || null; // CSS color or null (no border)
    this.borderWidth = opts.borderWidth || 0; // fraction of radius (0..0.5), circle only
    this.padding = opts.padding || 0; // transparent margin around the shape, fraction of half-size (0..0.4)
    this.rotation = opts.rotation || 0; // straighten/rotate the image, degrees (-180..180)
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
    this.rotation = 0;
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
  setBorder(color, width) {
    this.borderColor = color || null;
    if (width != null) this.borderWidth = Math.max(0, Math.min(0.5, width));
    this.render();
    return this;
  }
  setPadding(p) { this.padding = Math.max(0, Math.min(0.4, p || 0)); this.render(); return this; }
  setRotation(deg) { this.rotation = Math.max(-180, Math.min(180, deg || 0)); this.render(); return this; }

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
    // Transparent margin around the shape: shrink the usable box on every side
    // by `pad` (a fraction of the half-size) so the circle/ring isn't flush to the edge.
    const half = Math.min(cw, ch) / 2;
    const pad = half * this.padding;
    // Resolution-independent border thickness (fraction of the circle radius).
    const drawBorder = this.shape === 'circle' && this.borderColor && this.borderWidth > 0;
    const outerR = Math.max(0, half - pad);
    const stroke = drawBorder ? outerR * this.borderWidth : 0;
    const inset = pad + stroke; // image is clipped inside the ring (and inside the margin)
    const innerR = Math.max(0, half - inset);
    // Background fill: for a circle, fill only the (inner) disc so the corners
    // stay transparent; for a rect, fill the padded box (margin stays transparent).
    if (this.background) {
      ctx.save();
      ctx.fillStyle = this.background;
      if (this.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(cw / 2, ch / 2, innerR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(pad, pad, Math.max(0, cw - 2 * pad), Math.max(0, ch - 2 * pad));
      }
      ctx.restore();
    }
    if (!this.img) return;
    ctx.save();
    if (this.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(cw / 2, ch / 2, innerR, 0, Math.PI * 2);
      ctx.clip();
    }
    const ibox = inset; // shrink the image box by the inset on each side
    const boxW = Math.max(1, cw - 2 * ibox);
    const boxH = Math.max(1, ch - 2 * ibox);
    const rad = (this.rotation || 0) * Math.PI / 180;
    if (rad) {
      // Rotate the image around the box center. A rotated cover-image would leave
      // transparent corners, so oversize the cover scale by the diagonal factor of
      // the box so the rotated image still fully covers it at any angle.
      const cx = ibox + boxW / 2, cy = ibox + boxH / 2;
      const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
      const grow = (boxW * cos + boxH * sin) / boxW; // >=1; bounding box of rotated frame
      const grow2 = (boxW * sin + boxH * cos) / boxH;
      const cover = Math.max(grow, grow2);
      ctx.translate(cx, cy);
      ctx.rotate(rad);
      ctx.translate(-cx, -cy);
      const p = placement(
        this.img.width, this.img.height, boxW, boxH,
        this.zoom * cover, this.panNX, this.panNY
      );
      ctx.drawImage(this.img, ibox + p.offX, ibox + p.offY, p.dw, p.dh);
    } else {
      const p = placement(
        this.img.width, this.img.height, boxW, boxH,
        this.zoom, this.panNX, this.panNY
      );
      ctx.drawImage(this.img, ibox + p.offX, ibox + p.offY, p.dw, p.dh);
    }
    ctx.restore();
    if (drawBorder) {
      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = stroke;
      ctx.strokeStyle = this.borderColor;
      // stroke is centered on the path; place it at outerR - stroke/2 to stay inside the margin
      ctx.arc(cw / 2, ch / 2, Math.max(0, outerR - stroke / 2), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
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
