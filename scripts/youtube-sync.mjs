/**
 * 유튜브 채널 AI영상팀(@AI영상팀)에 새로 올린 영상을 Works 에 'DAY N' 카드로 붙인다.
 * .github/workflows/youtube-sync.yml 이 한 시간마다 실행한다(로컬에서 직접 돌려도 된다).
 *
 * - 채널 주인 계정으로 인증해 업로드 목록을 읽는다. 일부 공개 영상은 주인만 목록에서 볼 수 있다.
 *   인증한 채널이 CHANNEL_ID 가 아니면 아무것도 붙이지 않고 멈춘다.
 * - START_AFTER(손으로 넣은 마지막 영상) 뒤에 올라온 영상만 본다 — 채널의 옛 영상은 건드리지 않는다.
 * - 일부 공개 · 공개이고 처리가 끝난 영상만 넣는다. 비공개는 방문자가 재생할 수 없어 건너뛰고,
 *   나중에 일부 공개로 바꾸면 그다음 실행 때 들어간다.
 * - 제목은 지금 있는 가장 큰 DAY 번호 + 1, 아래 정보는 올린 날짜와 상관없이 늘 YEAR(2026).
 *   Details 버튼은 넣지 않는다 — 상세 정보는 따로 요청이 있을 때 손으로 넣는다.
 * - 넣은 카드는 GITHUB_OUTPUT 의 added 로 알린다(커밋 메시지용).
 *
 * 필요한 환경 변수(저장소 비밀값): YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const CHANNEL_ID = 'UCP9TZil5EtUoU3-BJULSpdg';   /* AI영상팀 */
const START_AFTER = 'epA7yq1SJAA';                /* DAY 2 */
const YEAR = '2026';
const PAGE = new URL('../index.html', import.meta.url);
const MARK = /^([ \t]*)<!-- works:auto\b.*$/m;

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

let html = readFileSync(PAGE, 'utf8');
const mark = html.match(MARK);
if (!mark) throw new Error('index.html 에 <!-- works:auto --> 표시가 없습니다');
const onPage = new Set([...html.matchAll(/data-video-id="([\w-]{11})"/g)].map(m => m[1]));
const ids = newer.reverse().filter(id => !onPage.has(id));   /* 오래된 것부터 */
if (!ids.length) {
  console.log('새 영상 없음');
  process.exit(0);
}

const info = {};
for (let i = 0; i < ids.length; i += 50) {
  const page = await api('videos', { part: 'status,snippet', id: ids.slice(i, i + 50).join(',') });
  for (const v of page.items) info[v.id] = v;
}

let day = Math.max(0, ...[...html.matchAll(/class="work__title">DAY (\d+)</g)].map(m => +m[1]));
const pad = mark[1];
const added = [];
for (const id of ids) {
  const v = info[id];
  const why = !v ? '정보 없음'
    : !['public', 'unlisted'].includes(v.status.privacyStatus) ? v.status.privacyStatus + ' (비공개는 방문자가 재생할 수 없음)'
    : v.status.uploadStatus !== 'processed' ? '처리 중(' + v.status.uploadStatus + ')'
    : v.status.embeddable === false ? '퍼가기 허용이 꺼져 있음'
    : '';
  if (why) { console.log(`건너뜀 ${id}: ${why}`); continue; }
  day += 1;
  const card = [
    `<li class="work" data-reveal>`,
    `  <button class="work__trigger" type="button"`,
    `          data-video-id="${id}"`,
    `          aria-label="DAY ${day} 영상 재생">`,
    `    <figure class="work__thumb">`,
    `      <img src="https://img.youtube.com/vi/${id}/maxresdefault.jpg"`,
    `           data-fallback="https://img.youtube.com/vi/${id}/hqdefault.jpg"`,
    `           alt="" loading="lazy">`,
    `    </figure>`,
    `  </button>`,
    `  <div class="work__info">`,
    `    <h3 class="work__title">DAY ${day}</h3>`,
    `    <p class="work__meta">${YEAR}</p>`,
    `  </div>`,
    `</li>`
  ].map(line => pad + line + '\n').join('');
  html = html.replace(MARK, m => card + m);
  added.push(`DAY ${day}`);
  console.log(`추가 DAY ${day}: ${id} (${v.snippet.title})`);
}

if (!added.length) process.exit(0);
writeFileSync(PAGE, html);
if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `added=${added.join(', ')}\n`);
