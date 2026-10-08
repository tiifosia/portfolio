/**
 * 유튜브 채널 AI영상팀(@AI영상팀)의 영상을 Works 카드로 관리한다.
 * .github/workflows/youtube-sync.yml 이 5분마다 실행한다(로컬에서 직접 돌려도 된다).
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
 * - 썸네일은 유튜브가 실제로 만든 것 중 가장 큰 것(고화질 → 640 → 480). 480p 로 올린 영상은 고화질이 없다.
 *
 * Details — 영상 설명이 있으면 붙고, 없으면 붙지 않는다. 설명을 고치거나 지우면 다음 실행 때 따라간다.
 * 설명은 줄 맨 앞의 머리말로 나눈다(대소문자 무관, 콜론은 : 또는 ：).
 *     사용 모델: wan        → 상단 표   (모델: 도 됨)
 *     길이: 8초             → 상단 표   ('사용 모델: wan, 길이: 8초' 처럼 한 줄에 적어도 됨)
 *     Prompt:              → 다음 머리말까지 Prompt            (프롬프트: 도 됨)
 *     Negative prompt:     → 다음 머리말까지 Negative prompt   (네거티브 프롬프트: 도 됨)
 *     Remarks:             → 다음 머리말까지 Remarks           (비고: 도 됨)
 * 머리말은 콜론이 없거나([Prompt], 📌 Prompt, Positive prompt, [6일차 프롬프트], [영상 프롬프트] 등) 조금 달라도 알아듣고,
 * 'Prompt 본문…' · 'Negative Prompt 본문…' 처럼 콜론 없이 바로 이어 써도 된다.
 * 이름표 없이 쓴 첫 줄('시댄스2 길이8초')에서도 모델 · 길이를 뽑는다. 장소: · 화면 비율: 도 상단 표로.
 * Prompt 머리말 없이 쓴 본문은, 설명이 형식을 쓰고 있으면(사용 모델 · 길이 · Negative prompt 가 있음) Prompt 로 본다.
 * 형식 없이 쓴 설명이면 전체가 Remarks. #해시태그만 있는 줄은 늘 Remarks.
 * 그 밖에 남길 말은 Remarks: 머리말 아래에 쓴다.
 *
 * 바뀐 것이 있으면 GITHUB_OUTPUT 의 summary 로 알린다(커밋 메시지용).
 * 올린 지 1시간이 넘도록 건너뛰는 영상(비공개 · 처리 멈춤 · 퍼가기 꺼짐)이 있으면 alert 로 알린다(올린 뒤 하루 동안).
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
  meta: li.match(/class="work__meta">([^<]*)</)?.[1] ?? YEAR,
  thumb: li.match(/src="https:\/\/img\.youtube\.com\/vi\/[\w-]{11}\/(\w+)\.jpg"/)?.[1] ?? 'maxresdefault'
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

/* 썸네일 — 유튜브가 실제로 만든 것 중 가장 큰 것. 없는 크기의 주소는 회색 기본 이미지를 돌려준다
   (DAY 9: 480p 로 올라가 고화질이 없었는데 그 주소를 써서 사이트에 회색 썸네일이 떴다) */
const THUMBS = [['maxres', 'maxresdefault'], ['standard', 'sddefault'], ['high', 'hqdefault']];
const bestThumb = v => THUMBS.find(([k]) => v.snippet.thumbnails?.[k])?.[1];

/* ---------- 새 카드 ---------- */
let day = Math.max(0, ...[...html.matchAll(/class="work__title">DAY (\d+)</g)].map(m => +m[1]));
const added = [];
const alerts = [];
for (const id of fresh) {
  const v = info[id];
  const why = !v ? '정보 없음'
    : !['public', 'unlisted'].includes(v.status.privacyStatus) ? v.status.privacyStatus + ' (비공개는 방문자가 재생할 수 없음)'
    : v.status.uploadStatus !== 'processed' ? '처리 중(' + v.status.uploadStatus + ')'
    : v.status.embeddable === false ? '퍼가기 허용이 꺼져 있음'
    : '';
  if (why) {
    console.log(`건너뜀 ${id}: ${why}`);
    /* 조용히 계속 건너뛰면 아무도 모른다 — 실수로 비공개로 올렸거나 처리가 멈춘 경우 */
    const mins = v ? (Date.now() - Date.parse(v.snippet.publishedAt)) / 60000 : 0;
    if (mins > 60 && mins < 1440) alerts.push(`'${v.snippet.title}' 를 ${Math.floor(mins / 60)}시간째 올리지 못함 — ${why}`);
    continue;
  }
  day += 1;
  cards.push({ id, day, meta: YEAR, thumb: bestThumb(v) || 'hqdefault' });
  added.push(`DAY ${day}`);
  console.log(`추가 DAY ${day}: ${id} (${v.snippet.title})`);
}

if (alerts.length) {
  console.log('::warning::' + alerts.join(' / '));
  if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `alert=${alerts.join(' / ')}\n`);
}

/* ---------- 설명 → 상세 ---------- */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/* 머리말은 느슨하게 알아듣는다 — 앞의 글머리표 · 괄호 · 이모지, 뒤의 (한글 풀이) · 닫는 괄호를 허용하고,
   콜론 대신 - 도 되며, 머리말만 있는 줄이면 콜론이 없어도 된다(예: 'Prompt', '[Prompt]', '📌 Prompt :').
   '#' 은 앞장식에서 뺀다 — '#prompt' 같은 해시태그 줄을 머리말로 읽지 않게.
   앞에 'N일차' · 'DAY N' 을 붙인 머리말도 같다(예: '[6일차 프롬프트]' — DAY 4 · 6 에서 본문에 섞여 들어갔다) */
const DECO = '[\\s\\-–—•·*>\\[\\(【「<〈\\p{Extended_Pictographic}\\uFE0F]*';
const PRE = '(?:(?:day\\s*\\d+|\\d+\\s*일\\s*차)\\s*)?';
const TAIL = '\\s*(?:[(\\[（【][^)\\]）】]*[)\\]）】])?\\s*[\\]\\)】」>〉]?\\s*';
const spec = words => new RegExp(`^${DECO}${PRE}(?:${words})${TAIL}[:：\\-–—]\\s*(.+)$`, 'iu');
const head = words => new RegExp(`^${DECO}${PRE}(?:${words})${TAIL}(?:[:：\\-–—]\\s*(.*))?$`, 'iu');
const SPEC_WORDS = [
  ['사용 모델', '사용\\s*모델|모델|model'],
  ['길이', '길이|length|duration'],
  ['장소', '장소|location'],
  ['화면 비율', '화면\\s*비율|aspect\\s*ratio']
];
const SPECS = SPEC_WORDS.map(([name, words]) => [name, spec(words)]);
/* '사용 모델: 시댄스2, 길이: 8초' 처럼 한 줄에 둘을 적으면 나눈다(DAY 2 · 5 에서 길이가 모델 칸에 붙었다) */
const SPEC_SPLIT = new RegExp(`\\s*[,，/|·]\\s*(?=(?:${SPEC_WORDS.map(w => w[1]).join('|')})\\s*[:：])`, 'iu');
const HEAD_WORDS = [
  ['negative', 'negative(?:\\s*prompts?)?|네거티브(?:\\s*프롬프트)?|부정\\s*프롬프트'],
  ['prompt', '(?:positive\\s*)?prompts?|(?:긍정\\s*)?프롬프트'],
  ['remarks', 'remarks?|비고|메모']
];
const HEADS = HEAD_WORDS.map(([kind, words]) => [kind, head(words)]);
/* 콜론 없이 머리말 뒤에 바로 본문을 이어 쓴 줄 — 'Prompt A strictly…', 'Negative Prompt CGI, …' (DAY 11).
   그 머리말이 아직 안 나왔고, 설명에 다른 형식 단서(모델 · 길이 · 다른 머리말)가 더 있을 때만 머리말로 본다
   ('Prompt:' 아래 'Prompt engineering…' 같은 본문이나, 형식 없이 'Prompt engineering…' 으로 시작한 자유 글은 그대로) */
const INLINE = HEAD_WORDS.map(([kind, words]) => [kind, new RegExp(`^${DECO}${PRE}(?:${words})\\s+(\\S.*)$`, 'iu')]);
/* 괄호로 감싼 머리말 줄 — 안에 무엇을 붙여도 된다: '[영상 프롬프트]', '【6일차 네거티브】' (DAY 10) */
const boxed = line => {
  const m = line.match(/^[\[【(<〈「]\s*([^\]】)>〉」]{1,30})\s*[\]】)>〉」]\s*[:：]?$/u);
  if (!m) return null;
  const kind = HEAD_WORDS.find(([, words]) => new RegExp(`(?:${words})`, 'iu').test(m[1]));
  return kind ? kind[0] : null;
};
/* 이름표 없이 쓴 첫 줄 — '시댄스2 길이8초', 'Seedance 2.0 / 8s' (DAY 11). 본문이 시작되기 전의 짧은 줄만 본다 */
const MODEL = /^(?:시댄스|seedance|kling|클링|wan|veo|sora|소라|runway|런웨이|hailuo|하이루오|minimax|미니맥스|pika|피카|luma|루마|hunyuan|vidu|midjourney)[\s\-]*[\w.\- ]{0,15}$/iu;
const DUR = '\\d+(?:\\.\\d+)?\\s*(?:초|seconds?|secs?|s)';
function bareSpecs(line) {
  if (line.length > 40) return null;
  let rest = line, len = null;
  const labeled = rest.match(new RegExp(`(?:길이|length|duration)\\s*[:：]?\\s*(${DUR})`, 'iu'));
  const trailing = !labeled && rest.match(new RegExp(`[\\s,，/|·]+(${DUR})\\s*$`, 'iu'));
  if (labeled || trailing) { len = (labeled || trailing)[1].replace(/\s+/g, ''); rest = rest.replace((labeled || trailing)[0], ' '); }
  rest = rest.replace(/^[\s,，/|·]+|[\s,，/|·]+$/g, '');
  const tag = rest.match(/^(?:사용\s*모델|모델|model)\s*[:：]?\s*(.+)$/iu);
  const model = tag ? tag[1].trim() : MODEL.test(rest) ? rest : '';
  if (rest && !model) return null;                  /* 모델 이름으로 안 보이는 말이 섞이면 줄 전체를 본문으로 */
  const out = [];
  if (model) out.push(['사용 모델', model]);
  if (len) out.push(['길이', len]);
  return out.length ? out : null;
}

function parse(description) {
  const text = (description || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  const d = { specs: [], prompt: [], negative: [], remarks: [], loose: [] };
  const seen = new Set();
  let cur = 'loose';                                /* 머리말 밖(첫 머리말 앞)의 글 */
  const lines = text.split('\n').map(l => l.trim());
  const cues = lines.filter((l, i) => SPECS.some(([, re]) => re.test(l)) || HEADS.some(([, re]) => re.test(l))
    || INLINE.some(([, re]) => re.test(l)) || boxed(l) || (i === 0 && bareSpecs(l))).length;
  for (const raw of lines) {
    const line = raw.trim();
    const freeSpec = l => SPECS.find(([name, re]) => re.test(l) && !d.specs.some(s => s[0] === name));
    const parts = line.split(SPEC_SPLIT).map(p => [p, freeSpec(p)]);
    if (parts.length > 1 && parts.every(([, s]) => s) && new Set(parts.map(([, s]) => s[0])).size === parts.length) {
      for (const [p, [name, re]] of parts) d.specs.push([name, p.match(re)[1].trim()]);
      continue;
    }
    const spec = freeSpec(line);
    if (spec) { d.specs.push([spec[0], line.match(spec[1])[1].trim()]); continue; }
    const bare = cur === 'loose' && !seen.size && !d.loose.some(Boolean) && bareSpecs(line);
    if (bare && bare.every(([name]) => !d.specs.some(s => s[0] === name))) { d.specs.push(...bare); continue; }
    const box = boxed(line);
    if (box) { cur = box; seen.add(cur); continue; }
    const head = HEADS.find(([, re]) => re.test(line));
    if (head) {
      cur = head[0];
      seen.add(cur);
      const rest = (line.match(head[1])[1] || '').trim();
      if (rest) d[cur].push(rest);
      continue;
    }
    const inline = cues >= 2 && INLINE.find(([kind, re]) => !seen.has(kind) && re.test(line));
    if (inline) {
      cur = inline[0];
      seen.add(cur);
      d[cur].push(line.match(inline[1])[1].trim());
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
const withDetails = new Set();                     /* 새 카드 중 Details 까지 붙은 것 — 커밋 메시지에 보이게 */
for (const c of cards) {
  const v = info[c.id];
  if (!v) {                                        /* 정보를 못 받으면(삭제 등) 있던 상세를 그대로 둔다 */
    if (oldTpl[c.id]) tpl[c.id] = oldTpl[c.id];
    continue;
  }
  const thumb = bestThumb(v);                      /* 처리 중이라 아직 없으면 있던 것 그대로 */
  if (thumb && thumb !== c.thumb) {
    if (!added.includes(`DAY ${c.day}`)) changed.push(`DAY ${c.day} 썸네일 수정`);
    c.thumb = thumb;
  }
  const d = parse(v.snippet.description);
  if (d) tpl[c.id] = detail(c, d);
  const was = oldTpl[c.id], now = tpl[c.id];
  if (added.includes(`DAY ${c.day}`) && now) withDetails.add(`DAY ${c.day}`);
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
  `      <img src="https://img.youtube.com/vi/${c.id}/${c.thumb}.jpg"`,
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
const addedText = added.map(a => withDetails.has(a) ? `${a}(Details 포함)` : a).join(', ');
const summary = [added.length && `${addedText} 자동 추가`, ...changed].filter(Boolean).join(', ');
console.log('반영:', summary);
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `summary=${summary}\n`);
