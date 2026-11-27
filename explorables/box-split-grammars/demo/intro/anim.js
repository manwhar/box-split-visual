/**
 * anim.js
 * Pure math/easing curves and token-guarded rAF runner.
 */

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const lerp = (a, b, t) => (t <= 0 ? a : t >= 1 ? b : a + (b - a) * t);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export const easeOutBack = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/**
 * Manages cancelable frame loops across step resets and slide visibility changes.
 */
export function createAnimator() {
  let runToken = 0;

  const isCurrent = (token) => token === runToken;

  function nextToken() {
    runToken += 1;
    return runToken;
  }

  function animate(durationMs, token, fn) {
    return new Promise((resolve) => {
      const start = performance.now();
      function frame(now) {
        if (token !== runToken) {
          resolve(false);
          return;
        }
        const t = clamp((now - start) / durationMs, 0, 1);
        fn(t);
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve(true);
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function wait(ms, token) {
    return animate(ms, token, () => {});
  }

  return { nextToken, isCurrent, animate, wait };
}
