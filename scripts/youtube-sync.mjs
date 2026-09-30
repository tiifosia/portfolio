/**
 * 유튜브 채널 AI영상팀(@AI영상팀)의 영상을 Works 카드로 관리한다.
 * .github/workflows/youtube-sync.yml 이 한 시간마다 실행한다(로컬에서 직접 돌려도 된다).
 *
 * index.html 의 <!-- works:auto --> ~ <!-- /works:auto --> (DAY 2~) 와
 * <!-- details:auto --> ~ <!-- /details:auto --> 는 이 스크립트가 매번 다시 쓴다.
 * DAY 1 은 손으로 쓴 카드 · 상세라 영역 밖에 있고 건드리지 않는다.
 *
 * 새 카드
 * - 채널 주인 계정으로 인증해 업로드 목록을 읽는다. 일부 공개 영상은 주인만 목록에서 볼 수 있다.
 *   인증한 채널이 CHANNEL_ID 가 아니면 아무것도 바꾸지 않고 멈춘다.
 * - START_AFTER(DAY 2) 뒤에 올라온 영상만 본다 — 채널의 옛 영상은 건드리지 않는다.
 * - 일부 공개 · 공개이고 처리가 끝난 영상만 넣는다. 비공개는 방문자가 재생할 수 없어 건너뛰고,
 *   나중에 일부 공개로 바꾸면 그다음 실행 때 들어간다.
 * - 제목은 지금 있는 가장 큰 DAY 번호 + 1, 아래 정보는 올린 날짜와 상관없이 늘 YEAR(2026).
 *
 * Details — 영상 설명이 있으면 붙고, 없으면 붙지 않는다. 설명을 고치거나 지우면 다음 실행 때 따라간다.
 * 설명은 줄 맨 앞의 머리말로 나눈다(대소문자 무관, 콜론은 : 또는 ：).
 *     사용 모델: wan        → 상단 표   (모델: 도 됨)
 *     길이: 8초             → 상단 표
 *     Prompt:              → 다음 머리말까지 Prompt            (프롬프트: 도 됨)
 *     Negative prompt:     → 다음 머리말까지 Negative prompt   (네거티브 프롬프트: 도 됨)
 *     Remarks:             → 다음 머리말까지 Remarks           (비고: 도 됨)
 * 머리말은 콜론이 없거나([Prompt], 📌 Prompt, Positive prompt 등) 조금 달라도 알아듣는다.
 * Prompt 머리말 없이 쓴 본문은, 설명이 형식을 쓰고 있으면(사용 모델 · 길이 · Negative prompt 가 있음) Prompt 로 본다.
 * 형식 없이 쓴 설명이면 전체가 Remarks. #해시태그만 있는 줄은 늘 Remarks.
 * 그 밖에 남길 말은 Remarks: 머리말 아래에 쓴다.
 *
 * 바뀐 것이 있으면 GITHUB_OUTPUT 의 summary 로 알린다(커밋 메시지용).
 * 필요한 환경 변수(저장소 비밀값): YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const CHANNEL_ID = 'UCP9TZil5EtUoU3-BJULSpdg';   /* AI영상팀 */
const START_AFTER = 'epA7yq1SJAA';                /* DAY 2 */
const YEAR = '2026';
const PAGE = new URL('../index.html', import.meta.url);

const { YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN, GITHUB_OUTPUT } = process.env;

/* 비밀값을 넣기 전에는 조용히 건너뛴다(매시간 실패 메일이 가지 않게) */
if (!YT_CLIENT_ID || !YT_CLIENT_SECRET || !YT_REFRESH_TOKEN) {
  console.log('::notice::YouTube 비밀값(YT_CLIENT_ID · YT_CLIENT_SECRET · YT_REFRESH_TOKEN)이 아직 없어 건너뜁니다.');
  process.exit(0);
}

const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({
    client_id: YT_CLIENT_ID,
    client_secret: YT_CLIENT_SECRET,
    refresh_token: YT_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  })
});
if (!res.ok) throw new Error(`Google 인증 실패 ${res.status}: ${await res.text()} — 리프레시 토큰이 만료·취소됐는지 확인`);
const { access_token: token } = await res.json();

const api = async (path, params) => {
  const url = new URL('https://www.googleapis.com/youtube/v3/' + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error(`YouTube ${path} ${r.status}: ${await r.text()}`);
  return r.json();
};

const me = (await api('channels', { part: 'contentDetails,snippet', mine: 'true' })).items?.[0];
if (!me) throw new Error('인증한 계정에 YouTube 채널이 없습니다 — 토큰을 받을 때 AI영상팀 채널을 골랐는지 확인');
if (me.id !== CHANNEL_ID) {
  throw new Error(`인증한 채널이 AI영상팀이 아닙니다(${me.snippet.title}, ${me.id}) — 토큰을 받을 때 AI영상팀 채널을 골라 다시 받으세요`);
}
const uploads = me.contentDetails.relatedPlaylists.uploads;
console.log('채널:', me.snippet.title, me.id);

/* 업로드 목록은 최신순 — 기준 영상을 만날 때까지 넘기며 그보다 새 영상을 모은다 */
const newer = [];
let pageToken = '', found = false;
do {
  const page = await api('playlistItems', {
    part: 'contentDetails', playlistId: uploads, maxResults: '50', ...(pageToken && { pageToken })
  });
  for (const item of page.items) {
    if (item.contentDetails.videoId === START_AFTER) { found = true; break; }
    newer.push(item.contentDetails.videoId);
  }
  pageToken = page.nextPageToken;
} while (!found && pageToken);
if (!found) throw new Error(`기준 영상(${START_AFTER})이 이 채널 업로드에 없습니다 — 다른 채널로 인증했는지 확인`);

/* ---------- index.html 의 관리 영역 ---------- */
const html = readFileSync(PAGE, 'utf8');
const area = name => {
  const a = html.indexOf(`<!-- ${name}:auto -->`), b = html.indexOf(`<!-- /${name}:auto -->`);
  if (a < 0 || b < a) throw new Error(`index.html 에 <!-- ${name}:auto --> ~ <!-- /${name}:auto --> 표시가 없습니다`);
  const from = html.indexOf('\n', a) + 1, to = html.lastIndexOf('\n', b) + 1;
  return { pad: html.slice(html.lastIndexOf('\n', a) + 1, a), from, to, body: html.slice(from, to) };
};
const works = area('works'), details = area('details');
if (works.to > details.from) throw new Error('works:auto 가 details:auto 보다 앞에 있어야 합니다');

const cards = [...works.body.matchAll(/<li\b[\s\S]*?<\/li>/g)].map(([li]) => ({
  id: li.match(/data-video-id="([\w-]{11})"/)?.[1],
  day: +li.match(/class="work__title">DAY (\d+)</)?.[1],
  meta: li.match(/class="work__meta">([^<]*)</)?.[1] ?? YEAR
}));
if (cards.some(c => !c.id || !c.day)) throw new Error('works:auto 안의 카드를 읽지 못했습니다');
const oldTpl = {};
for (const m of details.body.matchAll(/^[ \t]*<template id="detail-yt-([\w-]{11})">[\s\S]*?<\/template>\n/gm)) oldTpl[m[1]] = m[0];

const onPage = new Set([...html.matchAll(/data-video-id="([\w-]{11})"/g)].map(m => m[1]));
const fresh = newer.reverse().filter(id => !onPage.has(id));   /* 오래된 것부터 */

const info = {};
const ids = [...cards.map(c => c.id), ...fresh];
for (let i = 0; i < ids.length; i += 50) {
  const page = await api('videos', { part: 'status,snippet', id: ids.slice(i, i + 50).join(',') });
  for (const v of page.items) info[v.id] = v;
}

/* ---------- 새 카드 ---------- */
let day = Math.max(0, ...[...html.matchAll(/class="work__title">DAY (\d+)</g)].map(m => +m[1]));
const added = [];
for (const id of fresh) {
  const v = info[id];
  const why = !v ? '정보 없음'
    : !['public', 'unlisted'].includes(v.status.privacyStatus) ? v.status.privacyStatus + ' (비공개는 방문자가 재생할 수 없음)'
    : v.status.uploadStatus !== 'processed' ? '처리 중(' + v.status.uploadStatus + ')'
    : v.status.embeddable === false ? '퍼가기 허용이 꺼져 있음'
    : '';
  if (why) { console.log(`건너뜀 ${id}: ${why}`); continue; }
  day += 1;
  cards.push({ id, day, meta: YEAR });
  added.push(`DAY ${day}`);
  console.log(`추가 DAY ${day}: ${id} (${v.snippet.title})`);
}

/* ---------- 설명 → 상세 ---------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* 머리말은 느슨하게 알아듣는다 — 앞의 글머리표 · 괄호 · 이모지, 뒤의 (한글 풀이) · 닫는 괄호를 허용하고,
   콜론 대신 - 도 되며, 머리말만 있는 줄이면 콜론이 없어도 된다(예: 'Prompt', '[Prompt]', '📌 Prompt :').
   '#' 은 앞장식에서 뺀다 — '#prompt' 같은 해시태그 줄을 머리말로 읽지 않게 */
const DECO = '[\\s\\-–—•·*>\\[\\(【「<〈\\p{Extended_Pictographic}\\uFE0F]*';
const TAIL = '\\s*(?:[(\\[（【][^)\\]）】]*[)\\]）】])?\\s*[\\]\\)】」>〉]?\\s*';
const spec = words => new RegExp(`^${DECO}(?:${words})${TAIL}[:：\\-–—]\\s*(.+)$`, 'iu');
const head = words => new RegExp(`^${DECO}(?:${words})${TAIL}(?:[:：\\-–—]\\s*(.*))?$`, 'iu');
const SPECS = [
  ['사용 모델', spec('사용\\s*모델|모델|model')],
  ['길이', spec('길이|length|duration')]
];
const HEADS = [
  ['negative', head('negative(?:\\s*prompts?)?|네거티브\\s*프롬프트|부정\\s*프롬프트')],
  ['prompt', head('(?:positive\\s*)?prompts?|(?:긍정\\s*)?프롬프트')],
  ['remarks', head('remarks?|비고|메모')]
];

function parse(description) {
  const text = (description || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  const d = { specs: [], prompt: [], negative: [], remarks: [], loose: [] };
  const seen = new Set();
  let cur = 'loose';                                /* 머리말 밖(첫 머리말 앞)의 글 */
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const spec = SPECS.find(([name, re]) => re.test(line) && !d.specs.some(s => s[0] === name));
    if (spec) { d.specs.push([spec[0], line.match(spec[1])[1].trim()]); continue; }
    const head = HEADS.find(([, re]) => re.test(line));
    if (head) {
      cur = head[0];
      seen.add(cur);
      const rest = (line.match(head[1])[1] || '').trim();
      if (rest) d[cur].push(rest);
      continue;
    }
    if (/^(#[^\s#]+\s*)+$/.test(line)) {           /* 해시태그만 있는 줄 */
      if (d.remarks.length && d.remarks[d.remarks.length - 1] !== '') d.remarks.push('');
      d.remarks.push(line);
      continue;
    }
    d[cur].push(line);
  }
  /* 머리말 없는 본문 — 형식을 쓴 설명(사용 모델 · 길이 · Negative prompt 가 있음)에서 Prompt 머리말이
     없으면 그 본문이 곧 프롬프트다(DAY 1 을 적어 주신 방식). 형식 없이 쓴 설명이면 Remarks */
  if (!seen.has('prompt') && (d.specs.length || seen.has('negative'))) d.prompt = d.loose;
  else d.remarks = d.loose.concat(d.remarks.length && d.loose.length ? [''] : [], d.remarks);
  d.specs.sort((a, b) => SPECS.findIndex(s => s[0] === a[0]) - SPECS.findIndex(s => s[0] === b[0]));
  for (const k of ['prompt', 'negative', 'remarks']) d[k] = d[k].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return d;
}

const paragraphs = text => text.split(/\n\s*\n/).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`);

function detail(card, d) {
  const lines = [
    `<template id="detail-yt-${card.id}">`,
    `  <article class="detail">`,
    `    <h3 class="detail__title">DAY ${card.day}</h3>`
  ];
  if (d.specs.length) {
    lines.push(`    <dl class="detail__specs">`);
    for (const [k, v] of d.specs) lines.push(`      <div><dt>${k}</dt><dd>${esc(v)}</dd></div>`);
    lines.push(`    </dl>`);
  }
  for (const [label, text] of [['Prompt', d.prompt], ['Negative prompt', d.negative], ['Remarks', d.remarks]]) {
    if (!text) continue;
    lines.push(`    <h4 class="detail__label">${label}</h4>`, `    <div class="detail__text">`);
    for (const p of paragraphs(text)) lines.push(`      ${p}`);
    lines.push(`    </div>`);
  }
  lines.push(`  </article>`, `</template>`);
  return lines.map(l => details.pad + l + '\n').join('');
}

const tpl = {};
const changed = [];
for (const c of cards) {
  const v = info[c.id];
  if (!v) {                                        /* 정보를 못 받으면(삭제 등) 있던 상세를 그대로 둔다 */
    if (oldTpl[c.id]) tpl[c.id] = oldTpl[c.id];
    continue;
  }
  const d = parse(v.snippet.description);
  if (d) tpl[c.id] = detail(c, d);
  const was = oldTpl[c.id], now = tpl[c.id];
  if (!added.includes(`DAY ${c.day}`) && was !== now) {
    changed.push(`DAY ${c.day} Details ${!was ? '추가' : !now ? '삭제' : '수정'}`);
  }
}

const card = c => [
  `<li class="work" data-reveal>`,
  `  <button class="work__trigger" type="button"`,
  `          data-video-id="${c.id}"`,
  `          aria-label="DAY ${c.day} 영상 재생">`,
  `    <figure class="work__thumb">`,
  `      <img src="https://img.youtube.com/vi/${c.id}/maxresdefault.jpg"`,
  `           data-fallback="https://img.youtube.com/vi/${c.id}/hqdefault.jpg"`,
  `           alt="" loading="lazy">`,
  `    </figure>`,
  `  </button>`,
  `  <div class="work__info">`,
  `    <h3 class="work__title">DAY ${c.day}</h3>`,
  `    <p class="work__meta">${c.meta}</p>`,
  ...(tpl[c.id] ? [`    <button class="work__more" type="button" data-detail="detail-yt-${c.id}">Details</button>`] : []),
  `  </div>`,
  `</li>`
].map(l => works.pad + l + '\n').join('');

/* 원본을 잘라 두 영역만 새로 끼운다 */
const out = html.slice(0, works.from) + cards.map(card).join('') + html.slice(works.to, details.from)
  + cards.map(c => tpl[c.id] || '').join('') + html.slice(details.to);

if (out === html) {
  console.log('바뀐 것 없음');
  process.exit(0);
}
writeFileSync(PAGE, out);
const summary = [added.length && `${added.join(', ')} 자동 추가`, ...changed].filter(Boolean).join(', ');
changed.forEach(s => console.log(s));
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `summary=${summary}\n`);
