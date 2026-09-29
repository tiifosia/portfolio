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
 * 부드러운 스크롤 — 휠 한 번(또는 키보드)마다 '서서히 출발 → 최고 속도 → 서서히 멈춤'.
 * 브라우저 기본 휠은 누르자마자 최고 속도로 움직이고 뚝 멈춰 어색하다.
 * 목표 위치를 부드럽게 따라가는 단계를 4번 겹쳤다(각 단계가 앞 단계를 지수적으로 따라감).
 * 한 번 굴리면 속도가 0 에서 서서히 올라 약 0.25초에 최고, 약 0.7초에 거의 멈춘다(95%).
 * 계속 굴려도 속도가 끊기지 않고, 목표를 지나쳤다 되돌아오는(튕김) 일이 원리상 없다.
 * 터치(휴대폰)는 기기 기본 관성을 그대로 쓰고, 모션 최소화 설정이면 켜지 않는다.
 * 헤더 링크는 여기서 다루지 않는다(스크롤 없이 바로 이동 — 아래 '헤더 이동').
 * 그쪽에서 쓰도록 멈춤(stop)·잠금(lock)만 window.pageScroll 로 내놓는다.
 */
(function () {
  'use strict';

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var TAU = 0.09;                            /* 한 단계의 시간 상수(초) — 4단계 합쳐 약 0.7초 */
  var N = 4;
  var root = document.documentElement;
  /* 매 프레임 위치를 직접 정하므로 CSS 의 smooth 는 끈다(겹치면 두 번 부드러워져 어긋난다) */
  root.style.scrollBehavior = 'auto';

  var stages = [], running = false, last = 0, lastSet = null, raf = 0, locked = false;
  var reset = function (y) { stages = []; for (var i = 0; i <= N; i++) stages.push(y); };
  reset(window.scrollY);

  var maxScroll = function () { return root.scrollHeight - window.innerHeight; };
  var clamp = function (y) { return Math.max(0, Math.min(maxScroll(), y)); };

  var tick = function (now) {
    /* 프레임이 느린 기기에서도 같은 시간에 도착하도록 실제 경과 시간을 쓴다(각 단계는 dt 가 커도 안정).
       다른 탭에 다녀온 뒤처럼 아주 긴 간격만 잘라 둔다 */
    var dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    var k = 1 - Math.exp(-dt / TAU);
    for (var i = 1; i <= N; i++) stages[i] += (stages[i - 1] - stages[i]) * k;
    var y = stages[N];
    var done = true;
    for (var j = 1; j <= N; j++) if (Math.abs(stages[j] - stages[0]) > 0.4) { done = false; break; }
    if (done) { reset(stages[0]); y = stages[0]; running = false; }
    lastSet = Math.round(y);
    window.scrollTo(0, y);
    if (running) raf = requestAnimationFrame(tick);
  };

  var go = function (to) {
    if (!running) reset(window.scrollY);
    stages[0] = clamp(to);
    if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(tick); }
  };

  var stop = function () {
    cancelAnimationFrame(raf);
    running = false; reset(window.scrollY);
  };
  window.pageScroll = {
    stop: stop,
    /* 헤더 이동의 암전 동안에는 휠·키보드를 먹어 둔다(밑에서 페이지가 움직이지 않게) */
    lock: function (on) { locked = on; if (on) stop(); }
  };

  /* 다른 방법(스크롤바 끌기, 터치, 새로고침 등)으로 움직였으면 그 자리에서 다시 시작 */
  window.addEventListener('scroll', function () {
    if (!running) { reset(window.scrollY); return; }
    if (lastSet !== null && Math.abs(window.scrollY - lastSet) > 2) { running = false; reset(window.scrollY); }
  }, { passive: true });

  /* 휠 · 트랙패드 */
  window.addEventListener('wheel', function (e) {
    if (e.ctrlKey || e.defaultPrevented) return;                   /* 확대/축소 */
    if (locked) { e.preventDefault(); return; }
    if (document.body.style.overflow === 'hidden') return;         /* 모달이 열려 있음 */
    if (e.target.closest && e.target.closest('.modal')) return;
    var unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    var dy = e.deltaY * unit;
    if (Math.abs(e.deltaX * unit) > Math.abs(dy)) return;          /* 가로 스크롤은 그대로 */
    e.preventDefault();
    go((running ? stages[0] : window.scrollY) + dy);
  }, { passive: false });

  /* 키보드 — 입력칸·버튼에 포커스가 있으면 그대로 둔다 */
  window.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.body.style.overflow === 'hidden') return;
    var el = e.target;
    if (locked && !(el.closest && el.closest('input, textarea, select, [contenteditable]'))) {
      if (/^(Arrow(Up|Down)|Page(Up|Down)| |Spacebar|Home|End)$/.test(e.key)) e.preventDefault();
      return;
    }
    if (el.closest && el.closest('input, textarea, select, button, [contenteditable], .modal')) return;
    var page = window.innerHeight * 0.85, d = null;
    switch (e.key) {
      case 'ArrowDown': d = 120; break;
      case 'ArrowUp': d = -120; break;
      case 'PageDown': d = page; break;
      case 'PageUp': d = -page; break;
      case ' ': case 'Spacebar': d = e.shiftKey ? -page : page; break;
      case 'Home': d = -Infinity; break;
      case 'End': d = Infinity; break;
    }
    if (d === null) return;
    e.preventDefault();
    go((running ? stages[0] : window.scrollY) + d);
  });
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
 * 모달 — 영상 재생과 작품 상세(글)를 같은 창으로 띄운다.
 * 영상은 iframe 을 만들고 닫을 때 제거해 재생을 완전히 멈춘다.
 * 상세는 <template> 내용을 넣고, 글이 긴 창 모양(is-text)으로 바꾼다.
 */
(function () {
  'use strict';

  var modal = document.getElementById('modal');
  var frame = document.getElementById('modal-frame');
  if (!modal || !frame) return;

  var dialog = modal.querySelector('.modal__dialog');
  var closeBtn = modal.querySelector('.modal__close');
  var lastTrigger = null;
  var cleanup = null;

  /* 모달이 열린 동안 배경 스크롤을 막고, 스크롤바 폭만큼 보정해 화면 밀림을 없앤다 */
  function lockScroll(on) {
    var gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = on ? 'hidden' : '';
    document.body.style.paddingRight = on && gap > 0 ? gap + 'px' : '';
  }

  function show(trigger, label, isText) {
    clearTimeout(cleanup);
    lastTrigger = trigger;
    dialog.setAttribute('aria-label', label);
    modal.classList.toggle('is-text', isText);
    frame.scrollTop = 0;
    lockScroll(true);
    modal.classList.add('is-open');
    /* visibility 가 반영되기 전에는 포커스가 들어가지 않으므로 스타일 계산을 강제한다 */
    void modal.offsetHeight;
    closeBtn.focus();
  }

  function openVideo(videoId, trigger) {
    frame.innerHTML =
      '<iframe src="https://www.youtube-nocookie.com/embed/' + videoId +
      '?autoplay=1&rel=0&playsinline=1" title="포트폴리오 영상"' +
      ' allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>';
    show(trigger, '영상 재생', false);
  }

  function openDetail(id, trigger) {
    var tpl = document.getElementById(id);
    if (!tpl) return;
    frame.innerHTML = '';
    frame.appendChild(tpl.content.cloneNode(true));
    var title = frame.querySelector('.detail__title');
    show(trigger, (title ? title.textContent + ' ' : '') + '상세 정보', true);
  }

  function close() {
    if (!modal.classList.contains('is-open')) return;
    modal.classList.remove('is-open');
    lockScroll(false);
    if (modal.classList.contains('is-text')) {
      /* 글은 사라지는 페이드가 끝난 뒤에 비운다 — 바로 비우면 빈 창이 잠깐 보인다 */
      cleanup = setTimeout(function () { frame.innerHTML = ''; modal.classList.remove('is-text'); }, 400);
    } else {
      /* 영상은 바로 지워 소리까지 즉시 멈춘다 */
      frame.innerHTML = '';
    }
    if (lastTrigger) lastTrigger.focus();
  }

  document.addEventListener('click', function (e) {
    var video = e.target.closest('[data-video-id]');
    if (video) { openVideo(video.dataset.videoId, video); return; }
    var detail = e.target.closest('[data-detail]');
    if (detail) { openDetail(detail.dataset.detail, detail); return; }
    if (e.target.closest('[data-close]')) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();

/**
 * 한글을 두벌식 자판으로 칠 때 한 타마다 화면에 보이는 글자열을 만든다.
 * '우리는' → ['ㅇ', '우', '울', '우리', '우린', '우리느', '우리는']
 * 받침이 될 수 있는 자음은 일단 앞 글자 받침으로 붙었다가, 모음이 오면 다음 글자로 넘어간다.
 */
function hangulSteps(text) {
  'use strict';

  var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  var JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
  var JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';
  var V2 = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
  var T2 = { 'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ',
             'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ' };
  var split = function (map, ch) {
    for (var k in map) if (map[k] === ch) return k.split('');
    return [ch];
  };

  /* 1. 자판 입력 순서로 풀기 */
  var keys = [];
  Array.from(text).forEach(function (ch) {
    var c = ch.charCodeAt(0) - 0xAC00;
    if (c < 0 || c > 11171) { keys.push(ch); return; }
    keys.push(CHO[Math.floor(c / 588)]);
    keys = keys.concat(split(V2, JUNG[Math.floor(c % 588 / 28)]));
    if (c % 28) keys = keys.concat(split(T2, JONG[c % 28]));
  });

  /* 2. 한 타씩 조합하며 화면을 기록 */
  var done = '', L = '', V = '', T = '';
  var block = function () {
    if (L && V) return String.fromCharCode(0xAC00 + (CHO.indexOf(L) * 21 + JUNG.indexOf(V)) * 28 + JONG.indexOf(T || ' '));
    return L || V;
  };
  var commit = function () { done += block(); L = V = T = ''; };
  var out = [];
  keys.forEach(function (k) {
    var isVowel = JUNG.indexOf(k) >= 0, isCons = CHO.indexOf(k) >= 0 || JONG.indexOf(k) > 0;
    if (isCons) {
      if (L && V && !T && JONG.indexOf(k) > 0) T = k;
      else if (T && T2[T + k]) T = T2[T + k];
      else { commit(); L = k; }
    } else if (isVowel) {
      if (T) {
        /* 받침이 다음 글자 첫소리로 넘어간다 (겹받침이면 뒤쪽 하나만) */
        var parts = split(T2, T), moved = parts.pop();
        T = parts.length ? parts[0] : '';
        commit(); L = moved; V = k;
      } else if (L && !V) V = k;
      else if (V && V2[V + k]) V = V2[V + k];
      else { commit(); V = k; }
    } else { commit(); done += k; }
    out.push(done + block());
  });
  return out;
}

/**
 * About · Project 스토리의 점 세계지도를 그린다 (데이터: js/world-dots.js)
 * 육지는 점들을 한 path 로 — 점 3천 개를 요소로 만들지 않아 가볍다.
 * 장소 100곳은 각자 circle 로 두고, 최종 판단(실제/AI/중립)을 정해 둔다.
 */
(function () {
  'use strict';

  var story = document.querySelector('.story');
  var data = window.WORLD_DOTS;
  if (!story || !data) return;

  var S = data.size;                            /* 격자 한 칸 (viewBox 단위) */
  var W = data.width, H = data.height;
  var NS = 'http://www.w3.org/2000/svg';
  var el = function (tag, attrs) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  };

  var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'presentation' });

  /* 1. 육지 — 왼쪽부터 쓸어 드러내도록 clip 을 건다 */
  var d = '';
  data.rows.forEach(function (hex, r) {
    for (var i = 0; i < hex.length; i++) {
      var v = parseInt(hex[i], 16);
      for (var b = 0; b < 4; b++) {
        if (!(v & (8 >> b))) continue;
        var x = (i * 4 + b) * S + S / 2 - 1.7, y = r * S + S / 2;
        d += 'M' + x + ' ' + y + 'a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0';
      }
    }
  });
  var clip = el('clipPath', { id: 'story-sweep' });
  clip.appendChild(el('rect', { x: 0, y: -S, width: W, height: H + 2 * S }));
  var defs = el('defs', {});
  defs.appendChild(clip);
  svg.appendChild(defs);
  var landG = el('g', { 'clip-path': 'url(#story-sweep)' });
  landG.appendChild(el('path', { class: 'story__land', d: d }));
  svg.appendChild(landG);

  /* 2. 장소 — 최종 판단은 고정된 난수로(새로고침해도 같은 지도). 실제 약 4 : AI 약 3.5 : 중립 나머지 */
  var seed = 7;
  var rand = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  var ptsG = el('g', { class: 'story__pts' });
  data.places.forEach(function (p, i) {
    var r = rand();
    var v = i === 0 ? 'ai' : r < 0.42 ? 'real' : r < 0.78 ? 'ai' : 'neutral';
    var c = el('circle', { class: 'story__pt' + (i === 0 ? ' is-pick' : ''), cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 4.4 });
    c.setAttribute('data-v', v);
    ptsG.appendChild(c);
    if (i === 0) {
      /* 선택되는 장소 — 퍼지는 고리 두 개, 카드가 여기 붙는다 */
      for (var k = 0; k < 2; k++) ptsG.insertBefore(el('circle', { class: 'story__ring', cx: p[0], cy: p[1], r: 4 }), c);
      var card = story.querySelector('.story__card');
      if (card) {
        card.style.setProperty('--px', (p[0] / W * 100) + '%');
        card.style.setProperty('--py', (p[1] / H * 100) + '%');
      }
    }
  });
  svg.appendChild(ptsG);

  /* 카드보다 앞에 — 카드는 지도 상자 안에서 % 로 자리를 잡는다 */
  var mapBox = story.querySelector('.story__map');
  mapBox.insertBefore(svg, mapBox.firstChild);

  /* 좁은 화면에서는 지도가 작아 점이 2px 도 안 된다 — 장소 점만 키운다 */
  var narrow = window.matchMedia('(max-width: 768px)');
  var sizePts = function () {
    var r = narrow.matches ? 8 : 4.4;
    ptsG.querySelectorAll('circle').forEach(function (c) { c.setAttribute('r', c.classList.contains('story__ring') ? r * 0.9 : r); });
  };
  sizePts();
  if (narrow.addEventListener) narrow.addEventListener('change', sizePts);
})();

/**
 * 스크롤 인터랙션 (GSAP + ScrollTrigger)
 * 절제된 페이드인 · 슬라이드업과 썸네일의 완만한 패럴랙스만 적용한다.
 */
(function () {
  'use strict';

  var items = document.querySelectorAll('[data-reveal]');
  if (!items.length) return;

  /* 헤더 이동(로고 · About · Works) — 스크롤로 사이 화면을 훑지 않고 그 섹션에서 바로 시작한다.
     주소에 #about 은 남기지 않는다(새로고침은 어차피 맨 위부터). */
  var onJump = function (fn) {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var id = a.getAttribute('href').slice(1);
      var el = id === 'top' ? null : document.getElementById(id);
      if (id !== 'top' && !el) return;
      e.preventDefault();
      fn(id, el);
    });
  };
  var jumpY = function (el) {
    if (!el) return 0;
    return el.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
  };

  /* GSAP 로드 실패나 모션 최소화 설정에서는 애니메이션 없이 즉시 노출한다 */
  if (!window.gsap || !window.ScrollTrigger ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    onJump(function (id, el) {
      if (window.pageScroll) window.pageScroll.stop();
      window.scrollTo({ top: jumpY(el), behavior: 'instant' });
    });
    for (var i = 0; i < items.length; i++) items[i].removeAttribute('data-reveal');
    /* Project 스토리는 문장 넷과 완성된 지도만 */
    var storyStill = document.querySelector('.story');
    if (storyStill) storyStill.classList.add('is-static');
    /* 질문은 타이핑 없이, 첫 화면 바로 다음에 제 화면을 하나 차지하게 둔다.
       히어로 안에 두면 제목 아래로 흘러 서명과 겹친다. */
    var still = document.querySelector('.hero__ask');
    if (still) {
      document.querySelector('.hero').after(still);
      still.hidden = false;
      still.classList.add('is-static');
    }
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  /* ScrollTrigger 는 불러올 때의 복원 설정(auto)을 기억했다가 레이아웃을 다시 잴 때마다
     되돌려 놓는다(실측 — 새로고침하면 보던 위치로 돌아갔다). manual 로 고정한다. */
  ScrollTrigger.clearScrollMemory('manual');

  var EASE = 'power2.out';

  /* 섹션마다 등장 연출을 담아 둔다 — 헤더로 이동하면 같은 연출을 다시 튼다 */
  var reveals = {};

  /* 히어로 — 진입 시 한 번 */
  var hero = document.querySelector('.hero [data-reveal]');
  if (hero) {
    reveals.top = gsap.fromTo(hero,
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

    /* 글자 자리마다 span 을 만들어 최종 글자를 넣어 둔다(투명). 자리를 미리 차지해
       쓰는 동안 줄바꿈이 흔들리지 않는다. 띄어쓰기는 그냥 텍스트로 둔다. */
    var question = ask.querySelector('.hero__question');
    var text = question.textContent.trim();
    var finals = Array.from(text);
    var slots = [];
    question.textContent = '';
    finals.forEach(function (ch) {
      if (ch === ' ') { question.appendChild(document.createTextNode(' ')); slots.push(null); return; }
      var span = document.createElement('span');
      span.className = 'hero__char';
      span.textContent = ch;
      question.appendChild(span);
      slots.push(span);
    });
    /* 마지막 물음표는 제목의 구두점처럼 포인트 컬러 */
    var lastSlot = slots[slots.length - 1];
    if (lastSlot && lastSlot.textContent === '?') lastSlot.classList.add('accent');

    /* 자판을 한 번 누를 때마다의 화면 — ㅇ → 우 → 울 → 우리 → 우린 → 우리느 → 우리는 … */
    var steps = hangulSteps(text);

    /* 커서는 글자와 떨어진 요소 하나 — 글자 위치를 재서 옮긴다 */
    var caret = document.createElement('span');
    caret.className = 'hero__caret';
    caret.setAttribute('aria-hidden', 'true');
    question.appendChild(caret);
    var caretSpan = null, caretBefore = false;
    var placeCaret = function () {
      if (!caretSpan) return;
      /* 글자 상자가 혹시 두 줄로 쪼개져도(브라우저 차이) 합친 상자 대신
         글자가 실제로 그려진 조각 하나만 쓴다 — 커서는 늘 한 줄 높이 */
      var parts = Array.prototype.filter.call(caretSpan.getClientRects(), function (b) { return b.width > 1; });
      if (!parts.length) return;
      var r = caretBefore ? parts[0] : parts[parts.length - 1];
      var q = question.getBoundingClientRect();
      var fs = parseFloat(getComputedStyle(question).fontSize);
      var x = caretBefore ? r.left - q.left - 0.1 * fs : r.right - q.left + 0.04 * fs;
      /* S-Core Dream Light 의 한글은 글자 상자 높이의 4.8%~83.9% 에 그려진다(실측).
         커서가 글자 위아래를 살짝 넘도록 3%~88% 로 */
      caret.style.height = r.height * 0.85 + 'px';
      caret.style.transform = 'translate(' + x + 'px,' + (r.top - q.top + r.height * 0.03) + 'px)';
    };

    var shown = -1;
    var type = function (k) {
      if (k === shown) return;
      shown = k;
      var now = k > 0 ? Array.from(steps[k - 1]) : [];
      var end = now.length - 1;
      for (var i = 0; i < slots.length; i++) {
        var span = slots[i];
        if (!span) continue;
        var on = i <= end;
        span.textContent = on ? now[i] : finals[i];
        span.classList.toggle('is-on', on);
      }
      /* 커서 자리 — 마지막 글자 오른쪽. 방금 친 게 띄어쓰기면(또는 아직 없으면) 다음 글자 왼쪽. */
      caretBefore = end < 0 || now[end] === ' ';
      caretSpan = slots[caretBefore ? end + 1 : end];
      placeCaret();
      /* 실제 입력창처럼 치는 동안에는 켜진 채로, 멈추면 깜박이게 — 깜박임을 처음부터 다시 */
      caret.style.animation = 'none';
      void caret.offsetWidth;
      caret.style.animation = '';
      /* 후광은 쓰인 만큼 짙어진다 */
      question.style.setProperty('--glow', steps.length ? k / steps.length : 1);
    };
    type(0);
    /* 화면 크기가 바뀌면 줄바꿈이 달라지므로 커서를 다시 잰다 */
    ScrollTrigger.addEventListener('refresh', placeCaret);

    /* 서명은 상자(.signature)가 아니라 영상 자체를 흐린다. 상자에 opacity 를 걸면
       그룹이 분리돼 screen 합성이 풀리고 영상의 검은 바탕이 사각형으로 드러난다(실측). */
    var sig = document.querySelector('.signature__video');
    var typing = { n: 0 };

    /* 타임라인의 시간 1 = 스크롤 화면 높이 1 (전체 3.2 → 고정 구간 320%) */
    var intro = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: {
        trigger: heroEl,
        start: 'top top',
        end: '+=320%',
        pin: true,
        scrub: 0.6,
        anticipatePin: 1
      }
    });

    intro
      /* 1. 제목과 서명이 위로 살짝 뜨며 물러난다 (화면 0.48) */
      .fromTo(lead, { opacity: 1, y: 0 },
        { opacity: 0, y: -40, duration: 0.48, ease: 'power1.in' }, 0);
    if (sig) intro.fromTo(sig, { opacity: 1 }, { opacity: 0, duration: 0.4 }, 0);
    intro
      /* 2. 빈 화면에 커서가 나타나고 (화면 0.12) */
      .fromTo(ask, { opacity: 0 }, { opacity: 1, duration: 0.12 }, 0.48)
      /* 3. 스크롤한 만큼 천천히 쓰인다 (화면 2.4 — 한 타에 약 1/22 화면) */
      .fromTo(typing, { n: 0 },
        { n: steps.length, duration: 2.4,
          onUpdate: function () { type(Math.round(typing.n)); } }, 0.6)
      /* 다 쓴 문장을 잠깐 보여준 뒤 고정을 푼다 (화면 0.2) */
      .to({}, { duration: 0.2 }, 3.0);
  }

  /* About 첫 문단 — 스크롤에 따라 단어가 차례로 밝아진다 */
  var lead = document.querySelector('.about__lead');
  if (lead) {
    var words = [];
    Array.prototype.slice.call(lead.childNodes).forEach(function (node) {
      if (node.nodeType === 1) { node.classList.add('about__word'); words.push(node); return; }
      node.nodeValue.split(/(\s+)/).forEach(function (part) {
        if (!part) return;
        if (/^\s+$/.test(part)) { lead.insertBefore(document.createTextNode(part), node); return; }
        var w = document.createElement('span');
        w.className = 'about__word';
        w.textContent = part;
        lead.insertBefore(w, node);
        words.push(w);
      });
      lead.removeChild(node);
    });
    gsap.fromTo(words, { opacity: 0.2 }, {
      opacity: 1, ease: 'none', stagger: 0.1,
      scrollTrigger: { trigger: lead, start: 'top 85%', end: 'bottom 45%', scrub: 0.6 }
    });
  }

  /* About · Project 스토리 — 고정한 채 네 단계. 시간 1 = 스크롤 화면 높이 1 */
  var storyEl = document.querySelector('.story');
  if (storyEl && storyEl.querySelector('.story__map svg')) {
    var q = function (s) { return storyEl.querySelector(s); };
    var qa = function (s) { return Array.prototype.slice.call(storyEl.querySelectorAll(s)); };
    var stepEls = qa('.story__step'), barEls = qa('.story__bar i');
    var num = q('.story__num'), sweep = q('#story-sweep rect');
    var pts = qa('.story__pt'), pick = q('.story__pt.is-pick');
    var others = pts.filter(function (p) { return p !== pick; });
    var card = q('.story__card'), chips = qa('.story__chip'), answerChip = q('.story__chip.is-answer');
    var progressBar = q('.story__progress'), timeEl = q('.story__time'), answer = q('.story__answer');
    var legend = q('.story__legend'), ptsG = q('.story__pts');
    var mapW = parseFloat(q('.story__map svg').getAttribute('viewBox').split(' ')[2]);
    var cx = function (p) { return parseFloat(p.getAttribute('cx')); };
    var COLOR = { real: '#F5F5F5', ai: '#C3BDFF', neutral: '#8D8D8D' };

    gsap.set(stepEls, { opacity: 0, y: 24 });
    /* SVG 는 기본 변형 기준이 상자 왼쪽 위라, 점이 제자리에서 커지도록 가운데로 */
    gsap.set(pts, { scale: 0, transformOrigin: '50% 50%' });

    /* 진행 막대 한 칸을 채우는 트윈 설정 (매번 새 객체) */
    var fill = function () { return { '--fill': '100%', duration: 1, ease: 'none' }; };
    var video = { t: 0 };
    var active = -1;

    /* 한 요소는 반드시 한 타임라인만 움직인다.
       들어오는 구간과 고정 구간을 따로 두었더니, 스크롤을 빠르게 왕복할 때
       늦게 따라오는 쪽(scrub)이 나중에 첫 문장을 다시 켜서 문장이 겹쳤다(실측).
       → 고정은 별도 트리거로, 연출은 들어오는 구간부터 끝까지 타임라인 하나로. */
    var PRE = 0.85;                     /* 화면 85% 지점 → 맨 위까지(화면 0.85) */
    ScrollTrigger.create({ trigger: storyEl, start: 'top top', end: '+=400%', pin: true, anticipatePin: 1 });

    var tl = gsap.timeline({
      defaults: { ease: 'none' },
      onUpdate: function () {
        var t = this.time() - PRE;
        var idx = Math.max(0, Math.min(3, Math.floor(t)));
        if (idx !== active) { active = idx; num.textContent = '0' + (idx + 1); }
        storyEl.classList.toggle('is-picking', t >= 1.05 && t < 3);
      },
      scrollTrigger: { trigger: storyEl, start: 'top 85%', end: '+=485%', scrub: 0.6 }
    });

    /* 들어오는 동안 — 육지를 왼쪽부터 쓸어 드러내고 첫 문장이 떠오른다 */
    tl.fromTo(sweep, { attr: { width: 0 } }, { attr: { width: mapW }, duration: PRE }, 0)
      .fromTo(stepEls[0], { opacity: 0, y: 24 },
        { opacity: 1, y: 0, duration: 0.34, ease: 'power1.out', immediateRender: false }, PRE * 0.5);

    /* 고정된 뒤의 네 단계 — 시간 1 = 스크롤 화면 높이 1, 전체 4 */
    var seq = gsap.timeline({ defaults: { ease: 'none' } });

    /* 단계 문장 바꾸기 — 같은 문장을 여러 트윈이 다루므로 만들 때 바로 그리지 않게(immediateRender) */
    var swap = function (from, to, at) {
      seq.fromTo(stepEls[from], { opacity: 1, y: 0 },
          { opacity: 0, y: -24, duration: 0.12, ease: 'power1.in', immediateRender: false }, at - 0.12)
        .fromTo(stepEls[to], { opacity: 0, y: 24 },
          { opacity: 1, y: 0, duration: 0.14, ease: 'power1.out', immediateRender: false }, at);
    };

    /* 1. 장소 100곳이 서쪽부터 하나씩 켜진다 (0 → 1) */
    var byLon = pts.slice().sort(function (a, b) { return cx(a) - cx(b); });
    seq.fromTo(byLon, { scale: 0 }, { scale: 1, duration: 0.1, ease: 'back.out(3)', stagger: 0.006 }, 0.05)
      .fromTo(barEls[0], { '--fill': '0%' }, fill(), 0);

    /* 2. 한 곳을 골라 짧은 영상 (1 → 2) */
    swap(0, 1, 1);
    seq.to(others, { opacity: 0.3, duration: 0.15 }, 1)
      .to(pick, { scale: 2.2, duration: 0.15, ease: 'power2.out' }, 1)
      .fromTo(card, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.15, ease: 'power2.out' }, 1.1)
      .fromTo(progressBar, { scaleX: 0 }, { scaleX: 1, duration: 0.7 }, 1.25)
      .fromTo(video, { t: 0 }, { t: 8, duration: 0.7, onUpdate: function () {
        timeEl.textContent = '00:0' + Math.min(8, Math.floor(video.t)) + ' / 00:08';
      } }, 1.25)
      .fromTo(barEls[1], { '--fill': '0%' }, fill(), 1);

    /* 3. 투표하고 정답 확인 (2 → 3) */
    swap(1, 2, 2);
    seq.fromTo(chips, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.1, stagger: 0.05 }, 2.05)
      .to(answerChip, { borderColor: '#C3BDFF', color: '#C3BDFF', duration: 0.06 }, 2.4)
      .to(answerChip, { backgroundColor: '#C3BDFF', color: '#111111', duration: 0.08 }, 2.65)
      .fromTo(answer, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.1 }, 2.68)
      .fromTo(barEls[2], { '--fill': '0%' }, fill(), 2);

    /* 4. 판단이 쌓이며 지도가 바뀐다 (3 → 4) — 서쪽에서 동쪽으로 물결처럼 */
    swap(2, 3, 3);
    seq.to(card, { opacity: 0, y: -10, duration: 0.12 }, 3)
      .to(others, { opacity: 1, duration: 0.12 }, 3.02)
      .to(pick, { scale: 1, duration: 0.12 }, 3.02);
    byLon.forEach(function (p, i) {
      var v = p.getAttribute('data-v');
      var at = 3.12 + i * 0.0065;
      if (v === 'neutral') return;
      seq.to(p, { fill: COLOR[v], duration: 0.06 }, at)
        .to(p, { keyframes: [{ scale: 1.7, duration: 0.03 }, { scale: 1, duration: 0.05 }] }, at);
    });
    seq.fromTo(ptsG, { filter: 'drop-shadow(0px 0px 4px rgba(195, 189, 255, 0))' },
        { filter: 'drop-shadow(0px 0px 4px rgba(195, 189, 255, 0.55))', duration: 0.3 }, 3.5)
      .fromTo(legend, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.15 }, 3.8)
      .fromTo(barEls[3], { '--fill': '0%' }, fill(), 3)
      .to({}, { duration: 0 }, 4);

    tl.add(seq, PRE);

    /* 영상 프레임의 지글거림 — 카드가 보일 때만 돌린다 */
    var noise = q('.story__noise'), ctx = noise.getContext('2d');
    var img = ctx.createImageData(noise.width, noise.height), last = 0, running = false;
    var grain = function (now) {
      if (!storyEl.classList.contains('is-picking')) { running = false; return; }
      if (now - last > 50) {
        last = now;
        for (var i = 0; i < img.data.length; i += 4) {
          var g = 20 + Math.random() * 120;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = g;
          img.data[i + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
      requestAnimationFrame(grain);
    };
    new MutationObserver(function () {
      if (storyEl.classList.contains('is-picking') && !running) { running = true; requestAnimationFrame(grain); }
    }).observe(storyEl, { attributes: true, attributeFilter: ['class'] });
  }

  /* 각 섹션 — 화면에 들어올 때 순차 노출 */
  gsap.utils.toArray('.section').forEach(function (section) {
    var targets = section.querySelectorAll('[data-reveal]');
    if (!targets.length) return;

    reveals[section.id] = gsap.fromTo(targets,
      { opacity: 0, y: 24 },
      {
        opacity: 1, y: 0, duration: 0.9, ease: EASE, stagger: 0.1,
        /* 인라인 transform 이 남으면 CSS :hover 의 scale 이 무시된다 */
        clearProps: 'transform,translate,rotate,scale',
        scrollTrigger: { trigger: section, start: 'top 85%' }
      });
  });

  /* 헤더 이동 — 배경색 막이 0.2초 덮는 사이 그 섹션으로 옮기고, 막이 걷히며 섹션 등장 연출.
     누를 때마다 같은 연출(이미 본 섹션도). 막은 헤더 바로 아래 층이라 헤더는 그대로 보인다. */
  var veil = document.createElement('div');
  veil.className = 'veil';
  veil.setAttribute('aria-hidden', 'true');
  document.body.appendChild(veil);
  var jumping = null;   /* 막이 덮이는 중이면 갈 곳 — 그새 다른 메뉴를 누르면 마지막 것으로 */
  onJump(function (id, el) {
    if (jumping) { jumping = { id: id, el: el }; return; }
    jumping = { id: id, el: el };
    if (window.pageScroll) window.pageScroll.lock(true);
    gsap.to(veil, {
      autoAlpha: 1, duration: 0.2, ease: 'power1.in', overwrite: true,
      onComplete: function () {
        var to = jumping;
        window.scrollTo({ top: jumpY(to.el), behavior: 'instant' });
        ScrollTrigger.update();
        /* 스크롤을 늦게 따라오는(scrub) 연출은 곧장 제자리로 — 막이 걷힐 때 타이핑·지도가
           거꾸로 감기거나 뒤따라오는 모습이 보이지 않게 */
        ScrollTrigger.getAll().forEach(function (st) {
          var tw = st.getTween();
          if (tw) tw.progress(1);
        });
        if (reveals[to.id]) reveals[to.id].restart(true);
        if (window.pageScroll) window.pageScroll.lock(false);
        jumping = null;
        gsap.to(veil, { autoAlpha: 0, duration: 0.45, ease: 'power1.out' });
      }
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
