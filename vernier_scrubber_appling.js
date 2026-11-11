/**
 * Vernier Scrubber Appling — v1.0.0
 * 
 * Standalone, zero-dependency fisheye minimap scrubber for long chat logs,
 * multi-agent council halls, and multi-turn conversations.
 * 
 * Capabilities:
 * - Cosine-squared fisheye turn spreading on hover.
 * - Dynamic mousewheel magnification zoom (1.5x - 6.0x).
 * - Live viewport indicator reflecting container scroll state.
 * - Floating preview popover with speaker badge, turn index (#X/Total), and text snippet.
 * - Click-to-jump with smooth scrolling and temporary card highlight pulse.
 * - MutationObserver-backed auto-reindexing as new messages arrive.
 * 
 * Usage (vertical chat minimap — unchanged):
 *   <script src="vernier_scrubber_appling.js"></script>
 *   VernierScrubber.attach({
 *       container: '#chat',
 *       turnSelector: '.message'
 *   });
 *
 * Usage (horizontal range slider):
 *   VernierScrubber.attachRange({
 *       container: '#host',
 *       input: '#residueSlider',
 *       min: 1, max: 1480, value: 508,
 *       markers: [{ value: 508, color: '#e33', label: '508' }],
 *       snap: [508],
 *       onChange: function (v) {}
 *   });
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.VernierScrubber = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var instances = [];

    function injectStyles() {
        if (document.getElementById('vernier-scrubber-appling-css')) return;
        var style = document.createElement('style');
        style.id = 'vernier-scrubber-appling-css';
        style.textContent = `
            .vernier-track {
                position: absolute;
                top: 0;
                bottom: 0;
                right: 0;
                width: 14px;
                z-index: 999;
                background: rgba(10, 18, 28, 0.7);
                border-left: 1px solid rgba(255, 255, 255, 0.12);
                backdrop-filter: blur(6px);
                transition: width 0.18s cubic-bezier(0.16, 1, 0.3, 1), background 0.18s ease;
                user-select: none;
                box-sizing: border-box;
                cursor: pointer;
            }
            .vernier-track:hover,
            .vernier-track.active-lens {
                width: 64px;
                background: rgba(8, 14, 25, 0.95);
                border-left-color: var(--vernier-accent, #fbbf24);
                box-shadow: -4px 0 18px rgba(0, 0, 0, 0.7);
            }
            .vernier-vp {
                position: absolute;
                left: 1px;
                right: 1px;
                top: 0;
                height: 36px;
                background: rgba(255, 255, 255, 0.12);
                border: 1px solid rgba(255, 255, 255, 0.3);
                border-radius: 4px;
                pointer-events: none;
                transition: top 0.05s linear, height 0.08s ease;
            }
            .vernier-tick {
                position: absolute;
                left: 2px;
                right: 2px;
                height: 3px;
                border-radius: 2px;
                pointer-events: none;
                transition: height 0.08s, left 0.08s, right 0.08s, opacity 0.08s;
                display: flex;
                align-items: center;
                justify-content: flex-start;
                padding: 0 4px;
                overflow: hidden;
            }
            .vernier-tick-label {
                display: none;
                font-size: 0.62rem;
                font-weight: 800;
                font-family: ui-monospace, monospace;
                color: #fff;
                white-space: nowrap;
                letter-spacing: -0.02em;
            }
            .vernier-track.active-lens .vernier-tick.in-lens {
                height: 18px;
                border-radius: 4px;
                opacity: 1;
                left: 4px;
                right: 4px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.8);
            }
            .vernier-track.active-lens .vernier-tick.in-lens .vernier-tick-label {
                display: block;
            }
            .vernier-popover {
                position: fixed;
                width: 290px;
                background: rgba(9, 14, 24, 0.98);
                border: 1.5px solid var(--vernier-accent, #fbbf24);
                border-radius: 8px;
                padding: 10px 14px;
                color: #f1f5f9;
                font: 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.85), 0 0 16px rgba(251, 191, 36, 0.25);
                pointer-events: none;
                opacity: 0;
                transform: translateX(-8px);
                transition: opacity 0.12s ease, transform 0.12s ease;
                z-index: 99999;
                backdrop-filter: blur(12px);
            }
            .vernier-popover.open {
                opacity: 1;
                transform: translateX(0);
            }
            .vernier-pop-hdr {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 5px;
                padding-bottom: 4px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .vernier-pop-speaker {
                font-weight: 700;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }
            .vernier-pop-meta {
                font-family: monospace;
                font-size: 10px;
                color: #94a3b8;
            }
            .vernier-pop-snippet {
                color: #cbd5e1;
                font-size: 11px;
                line-height: 1.35;
                word-break: break-word;
                max-height: 58px;
                overflow: hidden;
            }
            .vernier-highlight {
                outline: 3px solid var(--vernier-accent, #7bd7c6) !important;
                outline-offset: 4px !important;
                border-radius: 8px !important;
                box-shadow: 0 0 22px rgba(123, 215, 198, 0.6) !important;
                transition: outline 0.2s ease, box-shadow 0.2s ease !important;
            }
        `;
        document.head.appendChild(style);
    }

    function VernierInstance(options) {
        options = options || {};
        this.options = options;
        this.scrollEl = typeof options.container === 'string' ?
            document.querySelector(options.container) :
            (options.container || document.documentElement);

        if (!this.scrollEl) {
            console.warn('[VernierScrubber] Container not found:', options.container);
            return;
        }

        this.turnSelector = options.turnSelector || '.message, article, [data-message-author-role], div[class*="message"]';
        this.accent = options.accentColor || '#7bd7c6';
        this.mag = options.initialZoom || 3.0;
        this.radius = options.radius || 75;
        this.activeY = null;
        this.cachedTurns = [];

        this.init();
    }

    VernierInstance.prototype.init = function () {
        injectStyles();
        var self = this;

        // Container must be relatively positioned so absolute track snaps inside it
        var style = window.getComputedStyle(this.scrollEl);
        if (style.position === 'static' && this.scrollEl !== document.documentElement && this.scrollEl !== document.body) {
            this.scrollEl.style.position = 'relative';
        }

        // Create Track
        this.track = document.createElement('div');
        this.track.className = 'vernier-track';
        this.track.style.setProperty('--vernier-accent', this.accent);
        this.track.title = 'Vernier Fisheye Scrubber: Wheel to zoom turns, click to jump';

        // Viewport indicator
        this.vp = document.createElement('div');
        this.vp.className = 'vernier-vp';
        this.track.appendChild(this.vp);

        // Popover
        this.popover = document.createElement('div');
        this.popover.className = 'vernier-popover';
        this.popover.style.setProperty('--vernier-accent', this.accent);

        var hdr = document.createElement('div');
        hdr.className = 'vernier-pop-hdr';
        this.popSpeaker = document.createElement('span');
        this.popSpeaker.className = 'vernier-pop-speaker';
        this.popMeta = document.createElement('span');
        this.popMeta.className = 'vernier-pop-meta';
        hdr.appendChild(this.popSpeaker);
        hdr.appendChild(this.popMeta);

        this.popSnippet = document.createElement('div');
        this.popSnippet.className = 'vernier-pop-snippet';

        this.popover.appendChild(hdr);
        this.popover.appendChild(this.popSnippet);

        // Attach elements
        if (this.options && this.options.trackParent) {
            var tp = typeof this.options.trackParent === 'string' ? document.querySelector(this.options.trackParent) : this.options.trackParent;
            if (tp) {
                var tpStyle = window.getComputedStyle(tp);
                if (tpStyle.position === 'static' && tp !== document.documentElement && tp !== document.body) {
                    tp.style.position = 'relative';
                }
                tp.appendChild(this.track);
                if (this.options.topOffset) this.track.style.top = this.options.topOffset;
                if (this.options.bottomOffset) this.track.style.bottom = this.options.bottomOffset;
            } else {
                this.scrollEl.appendChild(this.track);
            }
        } else if (this.scrollEl === document.documentElement || this.scrollEl === document.body) {
            this.track.style.position = 'fixed';
            this.track.style.top = '56px';
            this.track.style.bottom = '40px';
            document.body.appendChild(this.track);
        } else {
            this.scrollEl.appendChild(this.track);
        }
        document.body.appendChild(this.popover);

        // Continuous Drag & Interactive Scrubbing
        var isDragging = false;
        function handleDrag(e) {
            if (!isDragging) return;
            var rect = self.track.getBoundingClientRect();
            var y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
            self.activeY = y;
            var sh = self.scrollEl.scrollHeight || 1;
            var ch = self.scrollEl.clientHeight || 1;
            var trackH = rect.height || 1;
            var scrollRatio = y / trackH;
            self.scrollEl.scrollTop = scrollRatio * Math.max(0, sh - ch);
            self.renderTicks();
        }

        this.track.addEventListener('mousedown', function (e) {
            isDragging = true;
            self.track.classList.add('active-lens');
            handleDrag(e);
            function onMove(ev) { handleDrag(ev); }
            function onUp() {
                isDragging = false;
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                if (!self.track.matches(':hover')) {
                    self.track.classList.remove('active-lens');
                    self.activeY = null;
                    self.popover.classList.remove('open');
                    self.renderTicks();
                }
            }
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });

        // Events
        this.track.addEventListener('mouseenter', function () {
            self.track.classList.add('active-lens');
            self.refresh();
        });

        this.track.addEventListener('mouseleave', function () {
            if (isDragging) return;
            self.track.classList.remove('active-lens');
            self.activeY = null;
            self.popover.classList.remove('open');
            self.renderTicks();
        });

        this.track.addEventListener('mousemove', function (e) {
            if (isDragging) return;
            var rect = self.track.getBoundingClientRect();
            self.activeY = e.clientY - rect.top;
            self.renderTicks();
        });

        this.track.addEventListener('wheel', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.deltaY < 0) {
                self.mag = Math.min(self.mag + 0.35, 6.0);
            } else {
                self.mag = Math.max(self.mag - 0.35, 1.5);
            }
            self.renderTicks();
        }, { passive: false });

        this.track.addEventListener('click', function (e) {
            var rect = self.track.getBoundingClientRect();
            var clickY = e.clientY - rect.top;
            self.jumpToY(clickY);
        });

        // Scroll listener
        this.scrollEl.addEventListener('scroll', function () {
            self.updateViewport();
        }, { passive: true });

        // MutationObserver to auto-update when new turns arrive
        this.observer = new MutationObserver(function () {
            self.refresh();
        });
        this.observer.observe(this.scrollEl, { childList: true, subtree: true });

        this.refresh();
    };

    VernierInstance.prototype.extractTurnData = function (node, index, total) {
        var speaker = 'Agent';
        var color = this.accent;

        var agentAttr = node.getAttribute('data-agent');
        var roleAttr = node.getAttribute('data-message-author-role');

        if (agentAttr) {
            speaker = agentAttr.toUpperCase();
            var computedAccent = window.getComputedStyle(node).getPropertyValue('--accent');
            if (computedAccent && computedAccent.trim()) color = computedAccent.trim();
        } else if (roleAttr) {
            speaker = roleAttr === 'user' ? 'User' : 'Assistant';
            color = roleAttr === 'user' ? '#f97316' : this.accent;
        } else {
            var badge = node.querySelector('.speaker-badge, [class*="speaker"], [class*="author"]');
            if (badge) {
                speaker = (badge.innerText || badge.textContent || '').trim();
            } else {
                speaker = (index % 2 === 0) ? 'User' : 'Assistant';
            }
        }

        var text = (node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ');
        return {
            node: node,
            index: index + 1,
            total: total,
            speaker: speaker,
            color: color,
            snippet: text.slice(0, 140) + (text.length > 140 ? '...' : '')
        };
    };

    VernierInstance.prototype.updateViewport = function () {
        if (!this.vp || !this.track) return;
        var sh = this.scrollEl.scrollHeight || 1;
        var ch = this.scrollEl.clientHeight || 1;
        var st = this.scrollEl.scrollTop || 0;

        var topPct = (st / sh) * 100;
        var hPct = Math.max((ch / sh) * 100, 3.5);
        this.vp.style.top = topPct + '%';
        this.vp.style.height = hPct + '%';
    };

    VernierInstance.prototype.renderTicks = function () {
        if (!this.track) return;
        var trackH = this.track.clientHeight;
        var sh = this.scrollEl.scrollHeight || 1;
        if (trackH <= 0 || sh <= 0) return;

        this.track.replaceChildren();
        if (this.vp) this.track.appendChild(this.vp);

        var frag = document.createDocumentFragment();
        var closest = null;
        var closestDist = Infinity;
        var st = this.scrollEl.scrollTop || 0;
        var scrollRect = this.scrollEl.getBoundingClientRect();

        for (var i = 0; i < this.cachedTurns.length; i++) {
            var item = this.cachedTurns[i];
            var nodeRect = item.node.getBoundingClientRect();
            var nodeTop = (nodeRect.top - scrollRect.top) + st;
            var baseY = (nodeTop / sh) * trackH;

            var renderY = baseY;
            var inLens = false;

            if (this.activeY !== null) {
                var dist = baseY - this.activeY;
                var absDist = Math.abs(dist);
                if (absDist < this.radius) {
                    inLens = true;
                    var norm = absDist / this.radius;
                    var envelope = Math.pow(Math.cos((Math.PI * norm) / 2), 2);
                    var displacement = dist * (1 + (this.mag - 1) * 0.45 * envelope);
                    renderY = this.activeY + displacement;

                    if (absDist < closestDist) {
                        closestDist = absDist;
                        closest = { item: item, renderY: renderY };
                    }
                }
            }

            var tick = document.createElement('div');
            tick.className = 'vernier-tick' + (inLens ? ' in-lens' : '');
            tick.style.setProperty('--tick-color', item.color);
            tick.style.background = item.color;
            tick.style.top = Math.max(2, Math.min(renderY, trackH - (inLens ? 20 : 5))) + 'px';

            var label = document.createElement('span');
            label.className = 'vernier-tick-label';
            label.textContent = item.speaker.slice(0, 5).toUpperCase() + ' #' + item.index;
            tick.appendChild(label);

            frag.appendChild(tick);
        }

        this.track.appendChild(frag);

        if (closest && this.activeY !== null) {
            this.popover.classList.add('open');
            var trackRect = this.track.getBoundingClientRect();
            var boundedY = Math.max(20, Math.min(trackRect.top + closest.renderY - 20, window.innerHeight - 130));
            this.popover.style.top = boundedY + 'px';

            var placement = (this.options && this.options.popoverPlacement) || 'right';
            if (placement === 'right') {
                this.popover.style.left = (trackRect.right + 14) + 'px';
                this.popover.style.right = 'auto';
            } else {
                this.popover.style.right = (window.innerWidth - trackRect.left + 14) + 'px';
                this.popover.style.left = 'auto';
            }
            this.popover.style.borderLeftColor = closest.item.color;

            this.popSpeaker.textContent = '● ' + closest.item.speaker;
            this.popSpeaker.style.color = closest.item.color;
            this.popMeta.textContent = '#' + closest.item.index + '/' + closest.item.total + ' (' + this.mag.toFixed(1) + 'x)';
            this.popSnippet.textContent = closest.item.snippet;
        } else {
            this.popover.classList.remove('open');
        }
    };

    VernierInstance.prototype.refresh = function () {
        var rawNodes = Array.from(this.scrollEl.querySelectorAll(this.turnSelector));
        var self = this;
        var visibleNodes = rawNodes.filter(function (n) {
            return (n.offsetWidth > 0 || n.offsetHeight > 0) && !n.classList.contains('vernier-track');
        });

        this.cachedTurns = visibleNodes.map(function (node, idx) {
            return self.extractTurnData(node, idx, visibleNodes.length);
        });

        this.updateViewport();
        this.renderTicks();
    };

    VernierInstance.prototype.jumpToY = function (clickY) {
        var trackH = this.track.clientHeight;
        var sh = this.scrollEl.scrollHeight || 1;
        if (trackH <= 0 || sh <= 0 || !this.cachedTurns.length) return;

        var closest = null;
        var closestDist = Infinity;
        var st = this.scrollEl.scrollTop || 0;
        var scrollRect = this.scrollEl.getBoundingClientRect();

        for (var i = 0; i < this.cachedTurns.length; i++) {
            var item = this.cachedTurns[i];
            var nodeRect = item.node.getBoundingClientRect();
            var nodeTop = (nodeRect.top - scrollRect.top) + st;
            var baseY = (nodeTop / sh) * trackH;
            var d = Math.abs(baseY - clickY);
            if (d < closestDist) {
                closestDist = d;
                closest = item;
            }
        }

        if (closest && closest.node) {
            closest.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            closest.node.classList.remove('vernier-highlight');
            void closest.node.offsetWidth;
            closest.node.classList.add('vernier-highlight');
            var self = this;
            window.setTimeout(function () {
                closest.node.classList.remove('vernier-highlight');
            }, 1800);
        }
    };


    function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

    function cosineSqEnvelope(absDist, radius) {
        if (radius <= 0 || absDist >= radius) return 0;
        var c = Math.cos((Math.PI * (absDist / radius)) / 2);
        return c * c;
    }

    function injectRangeStyles() {
        if (document.getElementById('vernier-range-appling-css')) return;
        var style = document.createElement('style');
        style.id = 'vernier-range-appling-css';
        style.textContent = [
            '.vernier-range-host { position: relative; width: 100%; height: 44px; touch-action: none; user-select: none; -webkit-user-select: none; cursor: ew-resize; box-sizing: border-box; }',
            '.vernier-range-host.active-lens { cursor: ew-resize; }',
            '.vernier-range-host canvas { display: block; width: 100%; height: 100%; pointer-events: none; }',
            'input.vernier-range-native { position: absolute; width: 1px; height: 1px; padding: 0; margin: 0; overflow: hidden; clip: rect(0,0,0,0); border: 0; opacity: 0; pointer-events: none; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    /**
     * Horizontal fisheye range slider.
     * Same cosine-squared lens as the chat scrubber, but the handle and
     * numeric readout stay pinned to the pointer while ticks/markers warp
     * underneath the lens bubble.
     *
     * VernierScrubber.attachRange({
     *   input: '#resiSlider',          // optional existing <input type=range>
     *   container: '#host',            // element or selector to paint into
     *   min, max, value,
     *   markers: [{ value: 508, color: '#e33', label: '508' }],
     *   snap: [508],
     *   snapPx: 14,
     *   onInput: fn, onChange: fn
     * });
     */
    function VernierRangeInstance(options) {
        options = options || {};
        this.options = options;
        this.min = options.min != null ? Number(options.min) : 0;
        this.max = options.max != null ? Number(options.max) : 100;
        this.value = options.value != null ? Number(options.value) : this.min;
        this.markers = Array.isArray(options.markers) ? options.markers.slice() : [];
        this.snap = Array.isArray(options.snap) ? options.snap.slice() : [];
        this.snapPx = options.snapPx != null ? Number(options.snapPx) : 14;
        this.mag = options.initialZoom != null ? Number(options.initialZoom) : 10;
        this.radius = options.radius != null ? Number(options.radius) : 72;
        this.accent = options.accentColor || (this.markers[0] && this.markers[0].color) || '#ff5733';
        this.onInput = options.onInput || function () {};
        this.onChange = options.onChange || function () {};
        this.ariaLabel = options.ariaLabel || 'Value';

        this.input = null;
        if (options.input) {
            this.input = typeof options.input === 'string' ? document.querySelector(options.input) : options.input;
        }

        var hostOpt = options.container || options.host;
        if (hostOpt) {
            this.host = typeof hostOpt === 'string' ? document.querySelector(hostOpt) : hostOpt;
        } else if (this.input && this.input.parentNode) {
            this.host = document.createElement('div');
            this.input.parentNode.insertBefore(this.host, this.input);
        }
        if (!this.host) {
            console.warn('[VernierScrubber] attachRange: container/input not found');
            return;
        }

        this.focusX = null;
        this.dragging = false;
        this._pointerId = null;

        this.init();
    }

    VernierRangeInstance.prototype.init = function () {
        injectRangeStyles();
        var self = this;

        this.host.classList.add('vernier-range-host');
        this.host.setAttribute('role', 'slider');
        this.host.setAttribute('tabindex', '0');
        this.host.setAttribute('aria-label', this.ariaLabel);
        this.host.setAttribute('aria-valuemin', String(this.min));
        this.host.setAttribute('aria-valuemax', String(this.max));
        this.host.style.touchAction = 'none';
        if (window.getComputedStyle(this.host).position === 'static') {
            this.host.style.position = 'relative';
        }

        this.canvas = document.createElement('canvas');
        this.host.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        if (this.input) {
            this.input.classList.add('vernier-range-native');
            this.input.setAttribute('tabindex', '-1');
            this.input.setAttribute('aria-hidden', 'true');
            if (this.input.min === '' || this.input.min == null) this.input.min = this.min;
            if (this.input.max === '' || this.input.max == null) this.input.max = this.max;
            this.min = Number(this.input.min);
            this.max = Number(this.input.max);
            if (this.input.value !== '') this.value = Number(this.input.value);
        }

        this.value = Math.round(clamp(this.value, this.min, this.max));
        this._syncInput();
        this._syncAria();

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

        this._onResize();
    };

    VernierRangeInstance.prototype._width = function () {
        return this.host.clientWidth || (this.canvas && this.canvas.clientWidth) || 300;
    };

    VernierRangeInstance.prototype._height = function () {
        return this.host.clientHeight || 44;
    };

    VernierRangeInstance.prototype.baseX = function (v, w) {
        w = w == null ? this._width() : w;
        var span = this.max - this.min;
        if (span === 0) return 0;
        return ((clamp(v, this.min, this.max) - this.min) / span) * w;
    };

    VernierRangeInstance.prototype.valueFromBaseX = function (x, w) {
        w = w == null ? this._width() : w;
        var span = this.max - this.min;
        var t = w ? clamp(x, 0, w) / w : 0;
        return Math.round(clamp(this.min + t * span, this.min, this.max));
    };

    VernierRangeInstance.prototype.renderX = function (v, focusX, w) {
        w = w == null ? this._width() : w;
        var bx = this.baseX(v, w);
        if (focusX == null) return bx;
        var dist = bx - focusX;
        var abs = Math.abs(dist);
        if (abs >= this.radius) return bx;
        var env = cosineSqEnvelope(abs, this.radius);
        return focusX + dist * (1 + (this.mag - 1) * 0.45 * env);
    };

    VernierRangeInstance.prototype._localX = function (e) {
        var rect = this.host.getBoundingClientRect();
        return clamp(e.clientX - rect.left, 0, rect.width || this._width());
    };

    VernierRangeInstance.prototype._pick = function (x) {
        var w = this._width();
        var v = this.valueFromBaseX(x, w);
        var bestSnap = null;
        var bestDist = Infinity;
        for (var i = 0; i < this.snap.length; i++) {
            var s = this.snap[i];
            var d = Math.abs(this.renderX(s, x, w) - x);
            if (d <= this.snapPx && d < bestDist) {
                bestDist = d;
                bestSnap = s;
            }
        }
        return bestSnap != null ? bestSnap : v;
    };

    VernierRangeInstance.prototype._syncInput = function () {
        if (this.input) this.input.value = String(this.value);
    };

    VernierRangeInstance.prototype._syncAria = function () {
        this.host.setAttribute('aria-valuenow', String(this.value));
        this.host.setAttribute('data-value', String(this.value));
        this.host.setAttribute('data-residue', String(this.value));
        this.host.title = String(this.value);
    };

    VernierRangeInstance.prototype.setValue = function (v, silent) {
        var next = Math.round(clamp(v, this.min, this.max));
        var changed = next !== this.value;
        this.value = next;
        this._syncInput();
        this._syncAria();
        this.redraw();
        if (!silent && changed) this.onInput(this.value);
    };

    VernierRangeInstance.prototype.getValue = function () { return this.value; };

    VernierRangeInstance.prototype.setRange = function (min, max) {
        this.min = Number(min);
        this.max = Number(max);
        if (this.input) { this.input.min = this.min; this.input.max = this.max; }
        this.host.setAttribute('aria-valuemin', String(this.min));
        this.host.setAttribute('aria-valuemax', String(this.max));
        this.setValue(this.value, true);
    };

    VernierRangeInstance.prototype.getLayout = function () {
        var w = this._width();
        var focus = this.focusX;
        var pinX = (focus != null) ? focus : this.baseX(this.value, w);
        var marker = this.markers[0] ? this.markers[0].value : (this.snap[0] != null ? this.snap[0] : null);
        return {
            pointer: focus,
            thumb: pinX,
            label: pinX,
            marker508: marker != null ? this.renderX(marker, focus, w) : null,
            value: this.value,
            width: w
        };
    };

    VernierRangeInstance.prototype._onPtrDown = function (e) {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        this.host.setPointerCapture(e.pointerId);
        this._pointerId = e.pointerId;
        this.dragging = true;
        var x = this._localX(e);
        this.focusX = x;
        this.host.classList.add('active-lens');
        this.setValue(this._pick(x), false);
    };

    VernierRangeInstance.prototype._onPtrMove = function (e) {
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

    VernierRangeInstance.prototype._onPtrUp = function (e) {
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

    VernierRangeInstance.prototype._onLeave = function () {
        if (this.dragging) return;
        this.focusX = null;
        this.host.classList.remove('active-lens');
        this.redraw();
    };

    VernierRangeInstance.prototype._onWheel = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY < 0) this.mag = Math.min(this.mag + 0.35, 16);
        else this.mag = Math.max(this.mag - 0.35, 1.5);
        if (this.focusX != null && this.dragging) this.setValue(this._pick(this.focusX), false);
        else this.redraw();
    };

    VernierRangeInstance.prototype._onKey = function (e) {
        var step = 0;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') step = -1;
        else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') step = 1;
        else if (e.key === 'PageDown') step = -10;
        else if (e.key === 'PageUp') step = 10;
        else if (e.key === 'Home') { this.setValue(this.min, false); this.onChange(this.value); e.preventDefault(); return; }
        else if (e.key === 'End') { this.setValue(this.max, false); this.onChange(this.value); e.preventDefault(); return; }
        else if ((e.key === 'Enter' || e.key === ' ') && this.snap.length) {
            this.setValue(this.snap[0], false); this.onChange(this.value); e.preventDefault(); return;
        }
        if (!step) return;
        e.preventDefault();
        this.setValue(this.value + step, false);
        this.onChange(this.value);
    };

    VernierRangeInstance.prototype._onResize = function () {
        if (!this.ctx) return;
        var dpr = window.devicePixelRatio || 1;
        var w = this._width();
        var h = this._height();
        this.canvas.width = Math.max(1, Math.round(w * dpr));
        this.canvas.height = Math.max(1, Math.round(h * dpr));
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.redraw();
    };

    VernierRangeInstance.prototype.redraw = function () {
        var ctx = this.ctx;
        if (!ctx) return;
        var w = this._width();
        var h = this._height();
        var focus = this.focusX;
        var pinX = (focus != null) ? focus : this.baseX(this.value, w);
        var displayValue = (focus != null) ? (this.dragging ? this.value : this._pick(focus)) : this.value;
        ctx.clearRect(0, 0, w, h);

        var ty = Math.round(h * 0.58);
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

        // Context ticks
        var span = this.max - this.min;
        var step = span > 500 ? 100 : (span > 100 ? 10 : 1);
        var start = Math.ceil(this.min / step) * step;
        ctx.font = '10px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 1;
        for (var t = start; t <= this.max; t += step) {
            var tx = this.renderX(t, focus, w);
            ctx.beginPath();
            ctx.moveTo(tx, ty - 6);
            ctx.lineTo(tx, ty + 6);
            ctx.stroke();
            if (focus == null || Math.abs(tx - pinX) > 28) {
                ctx.fillText(String(t), tx, ty + 8);
            }
        }

        // Markers (e.g. 508) warp with the lens — the bubble slides under the pinned number
        for (var m = 0; m < this.markers.length; m++) {
            var mk = this.markers[m];
            var mv = mk.value;
            var mx = this.renderX(mv, focus, w);
            var col = mk.color || this.accent;
            ctx.save();
            ctx.strokeStyle = col;
            ctx.shadowColor = col;
            ctx.shadowBlur = 8;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(mx, ty - 14);
            ctx.lineTo(mx, ty + 14);
            ctx.stroke();
            ctx.restore();
            if (Math.abs(mx - pinX) > 18) {
                ctx.fillStyle = col;
                ctx.font = 'bold 10px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(mk.label != null ? String(mk.label) : String(mv), mx, ty - 15);
            }
        }

        // Lens ticks around the pointer (the bubble)
        if (focus != null) {
            var mid = this.valueFromBaseX(focus, w);
            var windowN = Math.ceil(this.radius * 2) + 20;
            var rMin = Math.max(this.min, mid - windowN);
            var rMax = Math.min(this.max, mid + windowN);
            for (var r = rMin; r <= rMax; r++) {
                var rx = this.renderX(r, focus, w);
                if (rx < -10 || rx > w + 10) continue;
                var env = cosineSqEnvelope(Math.abs(this.baseX(r, w) - focus), this.radius);
                if (env <= 0) continue;
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 1;
                var half = 5 + 7 * env;
                ctx.beginPath();
                ctx.moveTo(rx, ty - half);
                ctx.lineTo(rx, ty + half);
                ctx.stroke();
                if (r % 5 === 0 && Math.abs(rx - pinX) > 16) {
                    ctx.fillStyle = '#e2e8f0';
                    ctx.font = '10px system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'bottom';
                    ctx.fillText(String(r), rx, ty - half - 2);
                }
            }
        }

        // Handle + numeric readout PINNED to the pointer (or to the idle value)
        ctx.save();
        ctx.fillStyle = this.accent;
        ctx.shadowColor = this.accent;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(pinX, ty, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = '#ffedd5';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pinX, ty, 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = 'rgba(15,23,42,0.85)';
        ctx.lineWidth = 4;
        ctx.font = 'bold 13px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.lineJoin = 'round';
        ctx.strokeText(String(displayValue), pinX, ty - 12);
        ctx.fillText(String(displayValue), pinX, ty - 12);
    };


    // Public API
    return {
        attach: function (options) {
            var inst = new VernierInstance(options);
            instances.push(inst);
            return inst;
        },
        attachRange: function (options) {
            var inst = new VernierRangeInstance(options);
            instances.push(inst);
            return inst;
        },
        instances: instances
    };
}));
