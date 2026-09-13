/*
 * The order going to the kitchen, drawn.
 *
 * Owner: "as soon order finished i want very cool animation or video or
 * canvas or gif sending order to kitchen. and they got it preparing."
 *
 * Three beats, because there are three things a customer wants to know and
 * they arrive in this order: it left, somebody has it, somebody is cooking
 * it. A docket flies across to the kitchen hatch, the bell above the pass
 * rings, and the scene settles into a pan with a flame under it and steam
 * coming off.
 *
 * DRAWN RATHER THAN FILMED. A video or a gif would be somebody else's
 * kitchen, a download on a phone that is about to be put away, and a fixed
 * palette that fights the page in dark mode. This is a few hundred lines of
 * canvas that takes its colours from the stylesheet, weighs nothing, and is
 * as sharp on a cheap phone as an expensive one.
 *
 * NOBODY IS MADE TO WATCH IT. It runs once, holds on the last beat, and the
 * Done button is there from the first frame. Where the phone asks for less
 * motion it draws the last beat and stops.
 */
(function () {
  "use strict";

  /* When each beat begins, in milliseconds from the start. */
  var BEATS = [
    { at: 0, name: "sending" },
    { at: 1500, name: "landed" },
    { at: 2900, name: "cooking" },
  ];

  /* The palette, taken from the page so the scene is the page's own colour
     in both themes rather than a set of hexes that fight it. */
  function palette(canvas) {
    var read = function (name, fallback) {
      try {
        var value = getComputedStyle(canvas).getPropertyValue(name);
        return (value && value.trim()) || fallback;
      } catch (e) {
        return fallback;
      }
    };
    return {
      ink: read("--ink", "#111827"),
      soft: read("--ink-soft", "#6b7280"),
      line: read("--line", "#e5e7eb"),
      surface: read("--surface", "#ffffff"),
      accent: read("--accent", "#111827"),
    };
  }

  function ease(t) {
    /* Out-cubic: quick away, gentle arrival. */
    return 1 - Math.pow(1 - t, 3);
  }

  function clamp01(value) {
    return value < 0 ? 0 : value > 1 ? 1 : value;
  }

  /* A rounded rectangle, because a docket and a hatch are both one. */
  function box(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /* The kitchen hatch: a counter with a rail over it, on the right. */
  function drawHatch(ctx, c, W, H, glow) {
    var x = W * 0.58;
    var y = H * 0.22;
    var w = W * 0.34;
    var h = H * 0.5;

    if (glow > 0) {
      ctx.save();
      ctx.globalAlpha = 0.18 * glow;
      ctx.fillStyle = c.accent;
      box(ctx, x - 8 * glow, y - 8 * glow, w + 16 * glow, h + 16 * glow, 16);
      ctx.fill();
      ctx.restore();
    }

    ctx.fillStyle = c.surface;
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 2;
    box(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();

    /* The rail dockets are clipped to. */
    ctx.strokeStyle = c.soft;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 14);
    ctx.lineTo(x + w - 8, y + 14);
    ctx.stroke();

    /* The counter it all sits on. */
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 6, y + h);
    ctx.lineTo(x + w + 6, y + h);
    ctx.stroke();
  }

  /* The bell above the pass; it swings when the kitchen takes the order. */
  function drawBell(ctx, c, W, H, swing) {
    var x = W * 0.75;
    var y = H * 0.14;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(swing);
    ctx.strokeStyle = c.ink;
    ctx.fillStyle = c.surface;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-7, 4);
    ctx.quadraticCurveTo(-7, -7, 0, -7);
    ctx.quadraticCurveTo(7, -7, 7, 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-9, 4);
    ctx.lineTo(9, 4);
    ctx.stroke();
    ctx.restore();
  }

  /* The docket, with a couple of lines of "writing" on it. */
  function drawDocket(ctx, c, x, y, angle, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(scale, scale);
    ctx.fillStyle = c.surface;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 2;
    box(ctx, -16, -20, 32, 40, 4);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = c.soft;
    ctx.lineWidth = 2;
    [-10, -3, 4, 11].forEach(function (dy, i) {
      ctx.beginPath();
      ctx.moveTo(-10, dy);
      ctx.lineTo(i % 2 ? 6 : 10, dy);
      ctx.stroke();
    });
    ctx.restore();
  }

  /* The pan, with a flame under it that breathes. */
  function drawPan(ctx, c, W, H, t, alpha) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    var cx = W * 0.5;
    var cy = H * 0.66;

    /* Flame: two lobes that rise and fall out of step. */
    for (var f = 0; f < 2; f++) {
      var wobble = Math.sin(t / (f ? 190 : 240) + f) * 0.5 + 0.5;
      var fh = 10 + wobble * 9;
      ctx.beginPath();
      ctx.moveTo(cx - 12 + f * 24, cy + 26);
      ctx.quadraticCurveTo(cx - 18 + f * 24, cy + 26 - fh, cx - 6 + f * 24, cy + 26 - fh * 1.5);
      ctx.quadraticCurveTo(cx - 2 + f * 24, cy + 26 - fh * 0.5, cx - 12 + f * 24, cy + 26);
      ctx.closePath();
      ctx.fillStyle = c.accent;
      ctx.globalAlpha = alpha * (0.25 + wobble * 0.3);
      ctx.fill();
    }
    ctx.globalAlpha = alpha;

    /* The pan itself. */
    ctx.strokeStyle = c.ink;
    ctx.fillStyle = c.surface;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 34, cy);
    ctx.lineTo(cx + 34, cy);
    ctx.quadraticCurveTo(cx + 30, cy + 24, cx, cy + 24);
    ctx.quadraticCurveTo(cx - 30, cy + 24, cx - 34, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + 34, cy - 1);
    ctx.lineTo(cx + 56, cy - 7);
    ctx.stroke();
    ctx.restore();
  }

  /* Steam: three columns of puffs, each rising and fading on its own clock. */
  function drawSteam(ctx, c, W, H, t, alpha) {
    if (alpha <= 0) return;
    var cx = W * 0.5;
    var cy = H * 0.66;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = c.soft;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (var i = 0; i < 3; i++) {
      var phase = ((t / 1700 + i / 3) % 1);
      var rise = phase * 46;
      var fade = Math.sin(phase * Math.PI);
      if (fade <= 0.02) continue;
      ctx.globalAlpha = alpha * fade * 0.65;
      var x = cx - 18 + i * 18;
      var sway = Math.sin(phase * Math.PI * 2 + i) * 5;
      ctx.beginPath();
      ctx.moveTo(x, cy - 6 - rise);
      ctx.quadraticCurveTo(x + sway, cy - 14 - rise, x, cy - 22 - rise);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* Where the docket is at time t, and how the scene is composed. */
  function frame(ctx, c, W, H, t, still) {
    ctx.clearRect(0, 0, W, H);

    var sending = clamp01(t / BEATS[1].at);
    var landedAt = t - BEATS[1].at;
    var cookingAt = t - BEATS[2].at;
    var cooking = clamp01(cookingAt / 500);
    var kitchen = 1 - cooking;

    if (still) {
      drawPan(ctx, c, W, H, 0, 1);
      drawSteam(ctx, c, W, H, 600, 1);
      return;
    }

    if (kitchen > 0) {
      ctx.save();
      ctx.globalAlpha = kitchen;
      /* The hatch lights up as the docket lands and settles again. */
      var glow = landedAt > 0 ? Math.max(0, 1 - landedAt / 700) : 0;
      drawHatch(ctx, c, W, H, glow);
      var swing = landedAt > 0 && landedAt < 700 ? Math.sin(landedAt / 45) * 0.35 * (1 - landedAt / 700) : 0;
      drawBell(ctx, c, W, H, swing);

      if (t < BEATS[1].at) {
        /* In flight: a bezier from the customer's side to the rail. */
        var p = ease(sending);
        var x0 = W * 0.12;
        var y0 = H * 0.72;
        var x1 = W * 0.72;
        var y1 = H * 0.3;
        var cxp = W * 0.4;
        var cyp = H * 0.08;
        var x = (1 - p) * (1 - p) * x0 + 2 * (1 - p) * p * cxp + p * p * x1;
        var y = (1 - p) * (1 - p) * y0 + 2 * (1 - p) * p * cyp + p * p * y1;
        drawDocket(ctx, c, x, y, -0.5 + p * 0.6, 0.8 + p * 0.2);
      } else {
        /* Clipped to the rail, with a small settle. */
        var settle = Math.max(0, 1 - landedAt / 400);
        drawDocket(ctx, c, W * 0.72, H * 0.3 + settle * -3, 0.06, 1);
      }
      ctx.restore();
    }

    if (cooking > 0) {
      drawPan(ctx, c, W, H, cookingAt, cooking);
      drawSteam(ctx, c, W, H, cookingAt, cooking);
    }
  }

  function sizeTo(canvas) {
    var rect = canvas.getBoundingClientRect();
    var W = Math.max(1, Math.round(rect.width || canvas.width || 280));
    var H = Math.max(1, Math.round(rect.height || canvas.height || 170));
    var ratio = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    var ctx = canvas.getContext("2d");
    if (ctx) ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx: ctx, W: W, H: H };
  }

  function wantsStill() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  /*
   * Play the scene on `canvas`, calling back as each beat begins so the
   * caption underneath can keep up. Returns a stop function; a page that
   * leaves, or a second order, must not leave a loop running.
   */
  /*
   * The story without the drawing: the captions still arrive, on the same
   * clock. Nothing a customer is told depends on a canvas being available.
   */
  function captionsOnly(onBeat) {
    var timers = BEATS.slice(1).map(function (beat) {
      return setTimeout(function () {
        onBeat(beat.name);
      }, beat.at);
    });
    onBeat(BEATS[0].name);
    return function () {
      timers.forEach(clearTimeout);
    };
  }

  function play(canvas, options) {
    var settings = options || {};
    var onBeat = typeof settings.onBeat === "function" ? settings.onBeat : function () {};
    if (!canvas || typeof canvas.getContext !== "function") return captionsOnly(onBeat);

    var sized = sizeTo(canvas);
    /* A canvas can exist and still hand back nothing to draw with: an old
       browser, a hardened one, a page rendered headless. */
    if (!sized.ctx) return captionsOnly(onBeat);
    var c = palette(canvas);
    var still = settings.still === true || wantsStill();
    var started = 0;
    var raf = 0;
    var beat = -1;
    var running = true;

    if (still) {
      frame(sized.ctx, c, sized.W, sized.H, BEATS[2].at + 600, true);
      /* The words still walk through the three beats: a customer who asked
         for less motion still wants to be told what happened. */
      var quiet = BEATS.map(function (b) {
        return setTimeout(function () {
          onBeat(b.name);
        }, b.at);
      });
      return function () {
        quiet.forEach(clearTimeout);
      };
    }

    var step = function (now) {
      if (!running) return;
      if (!started) started = now;
      var t = now - started;
      for (var i = BEATS.length - 1; i >= 0; i--) {
        if (t >= BEATS[i].at && beat < i) {
          beat = i;
          onBeat(BEATS[i].name);
          break;
        }
      }
      frame(sized.ctx, c, sized.W, sized.H, t, false);
      raf = window.requestAnimationFrame(step);
    };
    raf = window.requestAnimationFrame(step);

    return function () {
      running = false;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }

  window.KitchenScene = { play: play, BEATS: BEATS, frame: frame, wantsStill: wantsStill };
})();
