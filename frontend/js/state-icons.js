/* ═══════════════════════════════════════════════════════════════════
   Kit alignment pass 11 — Animated state-icon helpers.
   Source-of-truth: .design-fetch-v3/phantom-sec-ui-kit/project/
                    PhantomSec Animated Icons.html
   Exposes window.StateIcons with four icon constructors + a play helper
   for the once-only .anim-verified beat. No imports; no exports.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var VALID_SIZES = [16, 24, 40, 80];

  function normalizeSize(size) {
    var n = Number(size);
    if (!isFinite(n) || n <= 0) return 24;
    // Snap to nearest valid size for kit fidelity, but allow custom.
    for (var i = 0; i < VALID_SIZES.length; i++) {
      if (n === VALID_SIZES[i]) return n;
    }
    return Math.round(n);
  }

  function loading(size) {
    var s = normalizeSize(size || 24);
    return ''
      + '<svg class="ico anim-loading" width="' + s + '" height="' + s + '" viewBox="0 0 64 64" aria-hidden="true">'
      +   '<polygon class="ld-tile ld-tile-c" points="32,34 50.78,44.83 32,55.66 13.22,44.83"/>'
      +   '<polygon class="ld-tile ld-tile-b" points="32,24 50.78,34.83 32,45.66 13.22,34.83"/>'
      +   '<polygon class="ld-tile ld-tile-a" points="32,14 50.78,24.83 32,35.66 13.22,24.83"/>'
      + '</svg>';
  }

  function scanning(size) {
    var s = normalizeSize(size || 24);
    // Anchored emitter cube above the iso plane + rotating cyan cone;
    // nodes grouped into 3 angular columns the beam crosses in sequence.
    return ''
      + '<svg class="ico anim-scanning" width="' + s + '" height="' + s + '" viewBox="0 0 64 64" aria-hidden="true">'
      +   '<polygon class="sc-plane" points="32,22 53.78,34 32,46 10.22,34"/>'
      +   '<polyline class="sc-bracket" points="8,32 8,18 22,18"/>'
      +   '<polyline class="sc-bracket" points="56,40 56,54 42,54"/>'
      +   '<polygon class="sc-emitter-top" points="32,4 35.46,6 32,8 28.54,6"/>'
      +   '<polygon class="sc-emitter-l" points="32,8 28.54,6 28.54,10 32,12"/>'
      +   '<polygon class="sc-emitter-r" points="32,8 35.46,6 35.46,10 32,12"/>'
      +   '<polygon class="sc-beam" points="32,12 29,42 35,42"/>'
      +   '<circle class="sc-node sc-col-l" cx="25.07" cy="32" r="1.6"/>'
      +   '<circle class="sc-node sc-col-l" cx="18.14" cy="36" r="1.6"/>'
      +   '<circle class="sc-node sc-col-l" cx="25.07" cy="40" r="1.6"/>'
      +   '<circle class="sc-node sc-col-c" cx="32" cy="28" r="1.6"/>'
      +   '<circle class="sc-node sc-col-c" cx="32" cy="36" r="1.6"/>'
      +   '<circle class="sc-node sc-col-c" cx="32" cy="44" r="1.6"/>'
      +   '<circle class="sc-node sc-col-r" cx="38.93" cy="32" r="1.6"/>'
      +   '<circle class="sc-node sc-col-r" cx="45.86" cy="36" r="1.6"/>'
      +   '<circle class="sc-node sc-col-r" cx="38.93" cy="40" r="1.6"/>'
      + '</svg>';
  }

  function engaging(size) {
    var s = normalizeSize(size || 24);
    // Policy frame + corner brackets, host cube with internal tumblers,
    // 3 packets traveling through governance, inspect dot, impact pulse,
    // hit-face stroke flash, cube-top cyan flash.
    return ''
      + '<svg class="ico anim-engaging" width="' + s + '" height="' + s + '" viewBox="0 0 64 64" aria-hidden="true">'
      +   '<rect class="en-policy" x="10" y="10" width="44" height="44"/>'
      +   '<polyline class="en-corner" points="10,18 10,10 18,10"/>'
      +   '<polyline class="en-corner" points="46,10 54,10 54,18"/>'
      +   '<polyline class="en-corner" points="54,46 54,54 46,54"/>'
      +   '<polyline class="en-corner" points="18,54 10,54 10,46"/>'
      +   '<polygon class="en-cube-top" points="34,21 43.526,26.5 34,32 24.474,26.5"/>'
      +   '<polygon class="en-cube-l" points="34,32 24.474,26.5 24.474,37.5 34,43"/>'
      +   '<polygon class="en-cube-r" points="34,32 43.526,26.5 43.526,37.5 34,43"/>'
      +   '<polygon class="en-bar en-bar-1" points="35.516,35.125 36.815,34.375 36.815,37.375 35.516,38.125"/>'
      +   '<polygon class="en-bar en-bar-2" points="38.114,33.625 39.413,32.875 39.413,35.875 38.114,36.625"/>'
      +   '<polygon class="en-bar en-bar-3" points="40.711,32.125 42.011,31.375 42.011,34.375 40.711,35.125"/>'
      +   '<polygon class="en-topflash" points="34,21 43.526,26.5 34,32 24.474,26.5"/>'
      +   '<polygon class="en-hitface" points="34,32 24.474,26.5 24.474,37.5 34,43"/>'
      +   '<circle class="en-inspect" cx="10" cy="24.5" r="1.4"/>'
      +   '<circle class="en-impact" cx="29.24" cy="34.75" r="2.2"/>'
      +   '<polygon class="en-packet p1" points="10,22.6 12.6,24.5 10,26.4 7.4,24.5"/>'
      +   '<polygon class="en-packet p2" points="10,22.6 12.6,24.5 10,26.4 7.4,24.5"/>'
      +   '<polygon class="en-packet p3" points="10,22.6 12.6,24.5 10,26.4 7.4,24.5"/>'
      + '</svg>';
  }

  function verified(size) {
    var s = normalizeSize(size || 24);
    // Cube faces wrapped in <g class="vf-cube"> so the snap transform
    // applies to the cube as a unit. No `.play` class on initial markup
    // — caller invokes StateIcons.play() to trigger the once-only beat.
    return ''
      + '<svg class="ico anim-verified" width="' + s + '" height="' + s + '" viewBox="0 0 64 64" aria-hidden="true">'
      +   '<g class="vf-cube">'
      +     '<polygon class="vf-cube-top" points="32,24 40.66,29 32,34 23.34,29"/>'
      +     '<polygon class="vf-cube-l" points="32,34 23.34,29 23.34,39 32,44"/>'
      +     '<polygon class="vf-cube-r" points="32,34 40.66,29 40.66,39 32,44"/>'
      +   '</g>'
      +   '<circle class="vf-ring" cx="32" cy="32" r="14"/>'
      +   '<path class="vf-check" d="M 22 33 L 30 41 L 44 23"/>'
      + '</svg>';
  }

  /**
   * Toggle the `.play` class on an .anim-verified SVG element so the
   * check-draw + ring-burst + cube-snap animations fire. Removes the
   * class after 1100 ms so the icon can be re-played (matches the 1.1s
   * vf-draw forwards duration).
   * @param {Element|null} svgEl
   */
  function play(svgEl) {
    if (!svgEl || !svgEl.classList) return;
    svgEl.classList.remove('play');
    // Force a reflow so the keyframes restart cleanly on re-entry.
    void svgEl.getBoundingClientRect();
    svgEl.classList.add('play');
    setTimeout(function () {
      if (svgEl && svgEl.classList) svgEl.classList.remove('play');
    }, 1100);
  }

  window.StateIcons = {
    loading: loading,
    scanning: scanning,
    engaging: engaging,
    verified: verified,
    play: play,
  };
})();
