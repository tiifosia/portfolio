/**
 * 새로고침하면 항상 첫 화면 맨 위에서 시작한다.
 * 브라우저의 스크롤 위치 복원을 끄고, 주소의 #about 같은 앵커도 지운다
 * (남아 있으면 새로고침 때 그 섹션으로 뛰어간다).
 */
(function () {
  'use strict';

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (window.location.hash) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  window.scrollTo(0, 0);
})();

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
    /* 질문은 타이핑 없이 제목 아래에 그대로 둔다 */
    var still = document.querySelector('.hero__ask');
    if (still) { still.hidden = false; still.classList.add('is-static'); }
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ScrollTrigger 는 불러올 때의 복원 설정(auto)을 기억했다가 레이아웃을 다시 잴 때마다
     되돌려 놓는다(실측 — 새로고침하면 보던 위치로 돌아갔다). manual 로 고정한다. */
  ScrollTrigger.clearScrollMemory('manual');

  var EASE = 'power2.out';

  /* 히어로 — 진입 시 한 번 */
  var hero = document.querySelector('.hero [data-reveal]');
  if (hero) {
    gsap.fromTo(hero,
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, duration: 1.1, ease: EASE, delay: 0.15,
        clearProps: 'transform,translate,rotate,scale' });
  }

  /* 히어로 → 질문 — 히어로를 잠시 고정하고 스크롤한 만큼만 진행한다(되감기 가능).
     제목과 서명이 물러난 뒤, 빈 화면 가운데에 질문이 스크롤한 만큼 한 글자씩 쓰인다. */
  var heroEl = document.querySelector('.hero');
  var ask = document.querySelector('.hero__ask');
  var lead = document.querySelector('.hero__lead');
  if (heroEl && ask && lead) {
    ask.hidden = false;

    /* 글자마다 span 으로 나눈다. 띄어쓰기는 글자로 세지 않고 그대로 둔다. */
    var question = ask.querySelector('.hero__question');
    var chars = [];
    var text = question.textContent.trim();
    question.textContent = '';
    Array.from(text).forEach(function (ch) {
      if (ch === ' ') { question.appendChild(document.createTextNode(' ')); return; }
      var span = document.createElement('span');
      span.className = 'hero__char';
      span.textContent = ch;
      question.appendChild(span);
      chars.push(span);
    });
    /* 마지막 물음표는 제목의 구두점처럼 포인트 컬러 */
    var last = chars[chars.length - 1];
    if (last && last.textContent === '?') last.classList.add('accent');

    var shown = -1;
    var type = function (k) {
      if (k === shown) return;
      shown = k;
      for (var c = 0; c < chars.length; c++) {
        chars[c].classList.toggle('is-on', c < k);
        chars[c].classList.toggle('is-caret', c === k - 1);
        chars[c].classList.toggle('is-caret-start', k === 0 && c === 0);
      }
    };
    type(0);

    /* 서명은 상자(.signature)가 아니라 영상 자체를 흐린다. 상자에 opacity 를 걸면
       그룹이 분리돼 screen 합성이 풀리고 영상의 검은 바탕이 사각형으로 드러난다(실측). */
    var sig = document.querySelector('.signature__video');
    var typing = { n: 0 };

    var intro = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: heroEl,
        start: 'top top',
        end: '+=200%',
        pin: true,
        scrub: 0.6,
        anticipatePin: 1
      }
    });

    intro
      /* 1. 제목과 서명이 위로 살짝 뜨며 물러난다 */
      .fromTo(lead, { opacity: 1, y: 0 },
        { opacity: 0, y: -40, duration: 0.24, ease: 'power1.in' }, 0);
    if (sig) intro.fromTo(sig, { opacity: 1 }, { opacity: 0, duration: 0.2 }, 0);
    intro
      /* 2. 빈 화면에 커서가 나타나고 */
      .fromTo(ask, { opacity: 0 }, { opacity: 1, duration: 0.06 }, 0.24)
      /* 3. 스크롤한 만큼 쓰인다 */
      .fromTo(typing, { n: 0 },
        { n: chars.length, duration: 0.6,
          onUpdate: function () { type(Math.round(typing.n)); } }, 0.3)
      /* 다 쓴 문장을 잠깐 보여준 뒤 고정을 푼다 */
      .to({}, { duration: 0.1 }, 0.9);
  }

  /* 각 섹션 — 화면에 들어올 때 순차 노출 */
  gsap.utils.toArray('.section').forEach(function (section) {
    var targets = section.querySelectorAll('[data-reveal]');
    if (!targets.length) return;

    gsap.fromTo(targets,
      { opacity: 0, y: 24 },
      {
        opacity: 1, y: 0, duration: 0.9, ease: EASE, stagger: 0.1,
        /* 인라인 transform 이 남으면 CSS :hover 의 scale 이 무시된다 */
        clearProps: 'transform,translate,rotate,scale',
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

/* --------------------------------------------------------------------------
   서명 영상 — 한 번 쓰이고 나면 마지막 프레임 그대로 굳는다
   -------------------------------------------------------------------------- */
(function () {
  'use strict';

  var video = document.querySelector('.signature__video');
  if (!video) return;

  var frozen = false;

  /* 끝에서 아주 살짝 앞을 잡는다. 정확히 duration 으로 옮기면
     브라우저에 따라 빈 프레임이 잡힐 수 있다. */
  function freeze() {
    frozen = true;
    if (!video.paused) video.pause();
    var d = video.duration;
    if (!isFinite(d) || d <= 0) return;
    var last = Math.max(0, d - 0.01);
    if (Math.abs(video.currentTime - last) > 0.01) video.currentTime = last;
  }

  video.addEventListener('ended', freeze);

  /* 다 쓴 뒤에 되감기거나 다시 재생되려 하면 그때마다 도로 굳힌다.
     (탭 복귀, bfcache 복원, 브라우저의 자동 되감기 방어) */
  function keep() { if (frozen) freeze(); }
  video.addEventListener('play', keep);
  video.addEventListener('seeked', keep);
  video.addEventListener('emptied', keep);
  document.addEventListener('visibilitychange', keep);
  window.addEventListener('pageshow', keep);

  /* 모션을 줄이는 설정이면 쓰는 과정 없이 완성된 서명만 보여준다 */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (video.readyState >= 1) freeze();
    else video.addEventListener('loadedmetadata', freeze);
    return;
  }

  /* 자동재생이 막히면 검은 화면이 남는다. 그때는 완성본으로 건너뛴다. */
  var played = video.play();
  if (played && played.catch) {
    played.catch(function () {
      if (video.readyState >= 1) freeze();
      else video.addEventListener('loadedmetadata', freeze);
    });
  }
})();
