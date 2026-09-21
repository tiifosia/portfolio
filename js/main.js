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

/**
 * 썸네일 폴백
 * 고화질 썸네일(maxresdefault)이 없는 영상은 hqdefault 로 교체한다.
 */
(function () {
  'use strict';

  var imgs = document.querySelectorAll('.work__thumb img[data-fallback]');

  for (var i = 0; i < imgs.length; i++) {
    imgs[i].addEventListener('error', function () {
      if (this.src === this.dataset.fallback) return;
      this.src = this.dataset.fallback;
    });
  }
})();

/**
 * 유튜브 임베드 모달
 * 썸네일 클릭 시 iframe 을 생성하고, 닫을 때 제거해 재생을 완전히 멈춘다.
 */
(function () {
  'use strict';

  var modal = document.getElementById('modal');
  var frame = document.getElementById('modal-frame');
  if (!modal || !frame) return;

  var closeBtn = modal.querySelector('.modal__close');
  var lastTrigger = null;

  /* 모달이 열린 동안 배경 스크롤을 막고, 스크롤바 폭만큼 보정해 화면 밀림을 없앤다 */
  function lockScroll(on) {
    var gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = on ? 'hidden' : '';
    document.body.style.paddingRight = on && gap > 0 ? gap + 'px' : '';
  }

  function open(videoId, trigger) {
    lastTrigger = trigger;
    frame.innerHTML =
      '<iframe src="https://www.youtube-nocookie.com/embed/' + videoId +
      '?autoplay=1&rel=0&playsinline=1" title="포트폴리오 영상"' +
      ' allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
    lockScroll(true);
    modal.classList.add('is-open');
    /* visibility 가 반영되기 전에는 포커스가 들어가지 않으므로 스타일 계산을 강제한다 */
    void modal.offsetHeight;
    closeBtn.focus();
  }

  function close() {
    if (!modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    frame.innerHTML = '';
    lockScroll(false);
    if (lastTrigger) lastTrigger.focus();
  }

  document.addEventListener('click', function (e) {
    var trigger = e.target.closest('[data-video-id]');
    if (trigger) {
      open(trigger.dataset.videoId, trigger);
      return;
    }
    if (e.target.closest('[data-close]')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();

/**
 * 스크롤 인터랙션 (GSAP + ScrollTrigger)
 * 절제된 페이드인 · 슬라이드업과 썸네일의 완만한 패럴랙스만 적용한다.
 */
(function () {
  'use strict';

  var items = document.querySelectorAll('[data-reveal]');
  if (!items.length) return;

  /* GSAP 로드 실패나 모션 최소화 설정에서는 애니메이션 없이 즉시 노출한다 */
  if (!window.gsap || !window.ScrollTrigger ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (var i = 0; i < items.length; i++) items[i].removeAttribute('data-reveal');
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  var EASE = 'power2.out';

  /* 히어로 — 진입 시 한 번 */
  var hero = document.querySelector('.hero [data-reveal]');
  if (hero) {
    gsap.fromTo(hero,
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 1.1, ease: EASE, delay: 0.15 });
  }

  /* 각 섹션 — 화면에 들어올 때 순차 노출 */
  gsap.utils.toArray('.section').forEach(function (section) {
    var targets = section.querySelectorAll('[data-reveal]');
    if (!targets.length) return;

    gsap.fromTo(targets,
      { opacity: 0, y: 24 },
      {
        opacity: 1, y: 0, duration: 0.9, ease: EASE, stagger: 0.1,
        scrollTrigger: { trigger: section, start: 'top 85%' }
      });
  });

  /* 썸네일 — 프레임 안에서 이미지만 천천히 흐른다 */
  gsap.utils.toArray('.work__thumb img').forEach(function (img) {
    gsap.fromTo(img,
      { yPercent: -4, scale: 1.1 },
      {
        yPercent: 4, scale: 1.1, ease: 'none',
        scrollTrigger: {
          trigger: img.closest('.work'),
          start: 'top bottom',
          end: 'bottom top',
          scrub: 0.6
        }
      });
  });
})();
