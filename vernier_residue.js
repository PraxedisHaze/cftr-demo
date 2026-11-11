/**
 * ResidueVernier — horizontal fisheye / vernier scrubber for residue sliders.
 *
 * Fisheye math ported from the Lenny vernier_scrubber appling
 * (Lenny/applings/vernier_scrubber.html and vernier_scrubber_appling.js):
 *   M(d) = 1 + (M_max - 1) * cos²(π d / (2 R))
 *   render = focus + dist * (1 + (M_max - 1) * 0.45 * envelope)
 *
 * As the pointer hovers or drags, the region around it magnifies so a single
 * residue is easy to hit. Mouse and touch. Optional snap residue (508) stays
 * marked and is magnetically easy to land on.
 */
(function (root) {
  'use strict';

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function cosineSqEnvelope(absDist, radius) {
    if (radius <= 0 || absDist >= radius) return 0;
    var c = Math.cos((Math.PI * (absDist / radius)) / 2);
    return c * c;
  }

  function defaultResToSlider(r, min, max, sliderMax) {
    return ((clamp(r, min, max) - min) / (max - min)) * sliderMax;
  }

  function defaultSliderToRes(s, min, max, sliderMax) {
    return min + (clamp(s, 0, sliderMax) / sliderMax) * (max - min);
  }

  function ResidueVernier(opts) {
    opts = opts || {};
    this.host = typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host;
    if (!this.host) throw new Error('ResidueVernier: host not found');

    this.min = opts.min != null ? opts.min : 1;
    this.max = opts.max != null ? opts.max : 1480;
    this.value = opts.value != null ? opts.value : 508;
    this.snapRes = opts.snapRes != null ? opts.snapRes : 508;
    this.mag = opts.mag != null ? opts.mag : 10;
    this.radius = opts.radius != null ? opts.radius : 72;
    this.pxPerRes = opts.pxPerRes != null ? opts.pxPerRes : 8;
    this.snapPx = opts.snapPx != null ? opts.snapPx : 14;
    this.sliderMax = opts.sliderMax != null ? opts.sliderMax : 1000;
    this.color = opts.color || '#ff5733';
    this.onInput = opts.onInput || function () {};
    this.onChange = opts.onChange || function () {};

    var self = this;
    this._resToSlider = opts.resToSlider
      ? function (r) { return opts.resToSlider(r); }
      : function (r) { return defaultResToSlider(r, self.min, self.max, self.sliderMax); };
    this._sliderToRes = opts.sliderToRes
      ? function (s) { return opts.sliderToRes(s); }
      : function (s) { return defaultSliderToRes(s, self.min, self.max, self.sliderMax); };

    this.focusX = null;
    this.dragging = false;
    this.anchorX = 0;
    this.anchorR = this.value;
    this._pointerId = null;

    this.host.classList.add('residue-vernier');
    this.host.setAttribute('role', 'slider');
    this.host.setAttribute('tabindex', '0');
    this.host.setAttribute('aria-label', opts.ariaLabel || 'Residue number');
    this.host.setAttribute('aria-valuemin', String(this.min));
    this.host.setAttribute('aria-valuemax', String(this.max));
    this.host.style.touchAction = 'none';
    this.host.style.position = this.host.style.position || 'relative';
    if (!this.host.style.height) this.host.style.height = '44px';
    if (!this.host.style.cursor) this.host.style.cursor = 'ew-resize';

    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.pointerEvents = 'none';
    this.host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this._onPtrDown = this._onPtrDown.bind(this);
    this._onPtrMove = this._onPtrMove.bind(this);
    this._onPtrUp = this._onPtrUp.bind(this);
    this._onLeave = this._onLeave.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onResize = this._onResize.bind(this);

    this.host.addEventListener('pointerdown', this._onPtrDown);
    this.host.addEventListener('pointermove', this._onPtrMove);
    this.host.addEventListener('pointerup', this._onPtrUp);
    this.host.addEventListener('pointercancel', this._onPtrUp);
    this.host.addEventListener('pointerleave', this._onLeave);
    this.host.addEventListener('wheel', this._onWheel, { passive: false });
    this.host.addEventListener('keydown', this._onKey);
    this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(this._onResize) : null;
    if (this._ro) this._ro.observe(this.host);
    else window.addEventListener('resize', this._onResize);

    this._syncAria();
    this._onResize();
  }

  ResidueVernier.prototype.setValue = function (r, silent) {
    var next = Math.round(clamp(r, this.min, this.max));
    var changed = next !== this.value;
    this.value = next;
    this._syncAria();
    this.redraw();
    if (!silent && changed) this.onInput(this.value);
  };

  ResidueVernier.prototype.getValue = function () { return this.value; };

  ResidueVernier.prototype.setRange = function (min, max) {
    this.min = min;
    this.max = max;
    this.value = Math.round(clamp(this.value, this.min, this.max));
    this.host.setAttribute('aria-valuemin', String(this.min));
    this.host.setAttribute('aria-valuemax', String(this.max));
    this._syncAria();
    this.redraw();
  };

  ResidueVernier.prototype._syncAria = function () {
    this.host.setAttribute('aria-valuenow', String(this.value));
    this.host.setAttribute('data-residue', String(this.value));
    this.host.title = 'Residue ' + this.value + (this.value === this.snapRes ? ' (Phe508)' : '') + '. Drag or hover to magnify.';
  };

  ResidueVernier.prototype._width = function () {
    return this.host.clientWidth || this.canvas.clientWidth || 300;
  };

  ResidueVernier.prototype._height = function () {
    return this.host.clientHeight || 44;
  };

  ResidueVernier.prototype.baseX = function (r, w) {
    w = w == null ? this._width() : w;
    return (this._resToSlider(r) / this.sliderMax) * w;
  };

  ResidueVernier.prototype.resFromBaseX = function (x, w) {
    w = w == null ? this._width() : w;
    var s = (clamp(x, 0, w) / w) * this.sliderMax;
    return Math.round(clamp(this._sliderToRes(s), this.min, this.max));
  };

  ResidueVernier.prototype.renderX = function (r, focusX, w) {
    w = w == null ? this._width() : w;
    var bx = this.baseX(r, w);
    if (focusX == null) return bx;
    var dist = bx - focusX;
    var abs = Math.abs(dist);
    if (abs >= this.radius) return bx;
    var env = cosineSqEnvelope(abs, this.radius);
    return focusX + dist * (1 + (this.mag - 1) * 0.45 * env);
  };

  ResidueVernier.prototype._localX = function (e) {
    var rect = this.host.getBoundingClientRect();
    return clamp(e.clientX - rect.left, 0, rect.width || this._width());
  };

  ResidueVernier.prototype._pick = function (x) {
    var w = this._width();
    var dx, r;
    if (this.dragging) {
      dx = x - this.anchorX;
      if (Math.abs(dx) <= this.radius) {
        r = this.anchorR + dx / this.pxPerRes;
      } else {
        var fine = this.radius / this.pxPerRes;
        var edgeX = this.anchorX + (dx < 0 ? -this.radius : this.radius);
        var edgeR = this.anchorR + (dx < 0 ? -fine : fine);
        r = edgeR + (this.resFromBaseX(x, w) - this.resFromBaseX(edgeX, w));
      }
    } else {
      r = this.resFromBaseX(x, w);
    }
    r = Math.round(clamp(r, this.min, this.max));
    var x508 = this.renderX(this.snapRes, x, w);
    if (Math.abs(x508 - x) <= this.snapPx) r = this.snapRes;
    return r;
  };

  ResidueVernier.prototype._onPtrDown = function (e) {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    this.host.setPointerCapture(e.pointerId);
    this._pointerId = e.pointerId;
    this.dragging = true;
    var x = this._localX(e);
    this.focusX = x;
    var w = this._width();
    var r = this.resFromBaseX(x, w);
    if (Math.abs(x - this.baseX(this.snapRes, w)) <= this.snapPx) r = this.snapRes;
    this.anchorX = x;
    this.anchorR = r;
    this.setValue(r, false);
    this.host.classList.add('active-lens');
  };

  ResidueVernier.prototype._onPtrMove = function (e) {
    if (this._pointerId != null && e.pointerId !== this._pointerId) return;
    var x = this._localX(e);
    this.focusX = x;
    this.host.classList.add('active-lens');
    if (this.dragging) {
      if (e.cancelable) e.preventDefault();
      this.setValue(this._pick(x), false);
    } else {
      this.redraw();
    }
  };

  ResidueVernier.prototype._onPtrUp = function (e) {
    if (this._pointerId != null && e.pointerId !== this._pointerId) return;
    var wasDragging = this.dragging;
    this.dragging = false;
    this._pointerId = null;
    try { this.host.releasePointerCapture(e.pointerId); } catch (err) {}
    if (wasDragging) this.onChange(this.value);
    if (!this.host.matches(':hover')) {
      this.focusX = null;
      this.host.classList.remove('active-lens');
    }
    this.redraw();
  };

  ResidueVernier.prototype._onLeave = function () {
    if (this.dragging) return;
    this.focusX = null;
    this.host.classList.remove('active-lens');
    this.redraw();
  };

  ResidueVernier.prototype._onWheel = function (e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.deltaY < 0) this.mag = Math.min(this.mag + 0.35, 16);
    else this.mag = Math.max(this.mag - 0.35, 4);
    if (this.focusX != null && this.dragging) this.setValue(this._pick(this.focusX), false);
    else this.redraw();
  };

  ResidueVernier.prototype._onKey = function (e) {
    var step = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') step = -1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') step = 1;
    else if (e.key === 'PageDown') step = -10;
    else if (e.key === 'PageUp') step = 10;
    else if (e.key === 'Home') { this.setValue(this.min, false); this.onChange(this.value); e.preventDefault(); return; }
    else if (e.key === 'End') { this.setValue(this.max, false); this.onChange(this.value); e.preventDefault(); return; }
    else if (e.key === 'Enter' || e.key === ' ') { this.setValue(this.snapRes, false); this.onChange(this.value); e.preventDefault(); return; }
    if (!step) return;
    e.preventDefault();
    this.setValue(this.value + step, false);
    this.onChange(this.value);
  };

  ResidueVernier.prototype._onResize = function () {
    var dpr = window.devicePixelRatio || 1;
    var w = this._width();
    var h = this._height();
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  };

  ResidueVernier.prototype.redraw = function () {
    var ctx = this.ctx;
    if (!ctx) return;
    var w = this._width();
    var h = this._height();
    var focus = this.focusX;
    ctx.clearRect(0, 0, w, h);

    // Track
    var ty = Math.round(h * 0.52);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(8, ty);
    ctx.lineTo(w - 8, ty);
    ctx.stroke();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(8, ty);
    ctx.lineTo(w - 8, ty);
    ctx.stroke();

    // 508 marker (always)
    var x508 = this.renderX(this.snapRes, focus, w);
    ctx.save();
    ctx.strokeStyle = this.color;
    ctx.shadowColor = this.color;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x508, ty - 14);
    ctx.lineTo(x508, ty + 14);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = this.color;
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('508', x508, ty - 15);

    // Context ticks (every 100)
    ctx.fillStyle = '#94a3b8';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    var startHundred = Math.ceil(this.min / 100) * 100;
    for (var t = startHundred; t <= this.max; t += 100) {
      if (t === this.snapRes) continue;
      var tx = this.renderX(t, focus, w);
      ctx.beginPath();
      ctx.moveTo(tx, ty - 6);
      ctx.lineTo(tx, ty + 6);
      ctx.stroke();
      if (focus == null || Math.abs(tx - (focus || 0)) > 28) {
        ctx.textAlign = 'center';
        ctx.fillText(String(t), tx, ty + 8);
      }
    }

    // Lens residue ticks
    if (focus != null) {
      var rMin = this.min, rMax = this.max;
      // Only walk a generous window around the pointer's base residue
      var mid = this.resFromBaseX(focus, w);
      var windowRes = Math.ceil((this.radius * 2) / Math.max(1.5, this.pxPerRes / 2)) + 40;
      rMin = Math.max(this.min, mid - windowRes);
      rMax = Math.min(this.max, mid + windowRes);
      // Also include current value and snap if nearby
      for (var r = rMin; r <= rMax; r++) {
        var rx = this.renderX(r, focus, w);
        if (rx < -10 || rx > w + 10) continue;
        var env = cosineSqEnvelope(Math.abs(this.baseX(r, w) - focus), this.radius);
        if (env <= 0 && r !== this.value && r !== this.snapRes) continue;
        var inLens = env > 0;
        ctx.strokeStyle = r === this.snapRes ? this.color : (r === this.value ? '#e2e8f0' : '#94a3b8');
        ctx.lineWidth = r === this.snapRes || r === this.value ? 2 : 1;
        var half = inLens ? 5 + 7 * env : 5;
        ctx.beginPath();
        ctx.moveTo(rx, ty - half);
        ctx.lineTo(rx, ty + half);
        ctx.stroke();
        if (inLens && (r % 5 === 0 || r === this.value || r === this.snapRes)) {
          ctx.fillStyle = r === this.snapRes ? this.color : '#e2e8f0';
          ctx.font = (r === this.value || r === this.snapRes ? 'bold ' : '') + '10px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(String(r), rx, ty - half - 2);
        }
      }
      // Hairline
      ctx.strokeStyle = 'rgba(226,232,240,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(focus, 4);
      ctx.lineTo(focus, h - 4);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Thumb at current value
    var xv = this.renderX(this.value, focus, w);
    ctx.save();
    ctx.fillStyle = this.color;
    ctx.shadowColor = 'rgba(255,87,51,0.55)';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(xv, ty, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#ffedd5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(xv, ty, 7, 0, Math.PI * 2);
    ctx.stroke();
  };

  root.ResidueVernier = {
    attach: function (opts) { return new ResidueVernier(opts); }
  };
})(typeof window !== 'undefined' ? window : this);
