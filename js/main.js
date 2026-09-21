/**
 * 헤더 스크롤 상태
 * 최상단을 벗어나면 헤더에 배경(블러)을 입힌다.
 */
(function () {
  'use strict';

  var header = document.getElementById('header');
  if (!header) return;

  var THRESHOLD = 40;
  var ticking = false;

  function update() {
    header.classList.toggle('is-scrolled', window.scrollY > THRESHOLD);
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  }, { passive: true });

  update();
})();
