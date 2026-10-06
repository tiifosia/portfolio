#!/usr/bin/env bash
# 공개 사이트에 메인의 맨 위 커밋이 실제로 보이는지 확인하고, 안 보이면 스스로 다시 배포한다.
# .github/workflows/youtube-sync.yml 이 5분마다 실행한다.
#
# - 배포 성공 기록만 믿지 않고, 실제 사이트 HTML 에 index.html 의 모든 영상(data-video-id)이 있는지까지 본다.
#   (10/6 DAY 9: 배포가 GitHub 에서 'waiting' 으로 멈춰 사이트에 11시간 안 보였는데 아무도 몰랐다)
# - 커밋 후 10분이 넘도록 안 보이고 진행 중인 배포도 없으면 → 걸린 배포를 취소하고 새로 요청한다.
# - 1시간이 넘도록 안 보이면 → 실패로 끝내 GitHub 이 메일로 알리게 한다(LOUD=true 인 실행만 — 매시 02분 · 수동).
# 필요한 환경 변수: GH_TOKEN, GITHUB_REPOSITORY, SITE_BRANCH, LOUD
set -euo pipefail

R="repos/$GITHUB_REPOSITORY"
SITE="https://tiifosia.github.io/portfolio/"
ids() { { grep -o 'data-video-id="[A-Za-z0-9_-]\{11\}"' || true; } | sort -u; }
count() { grep -c . || true; }

HEAD=$(gh api "$R/commits/$SITE_BRANCH" --jq .sha)
AGE=$(( $(date +%s) - $(date -d "$(gh api "$R/commits/$HEAD" --jq .commit.committer.date)" +%s) ))
WANT=$(gh api "$R/contents/index.html?ref=$HEAD" -H 'Accept: application/vnd.github.raw' | ids)

DEPLOYED=no
for D in $(gh api "$R/deployments?sha=$HEAD&environment=github-pages" --jq '.[].id'); do
  if [ "$(gh api "$R/deployments/$D/statuses?per_page=1" --jq '.[0].state')" = success ]; then DEPLOYED=yes; fi
done

# 주소 끝에 매번 다른 값을 붙여 캐시가 아닌 지금 사이트를 받는다. 사이트를 못 열면 배포 기록만으로 판단
if HTML=$(curl -fsSL --max-time 20 "$SITE?check=$(date +%s)"); then
  MISSING=$(comm -23 <(echo "$WANT") <(echo "$HTML" | ids) | count)
else
  echo "::warning::공개 사이트를 열지 못해 배포 기록만으로 판단합니다"
  MISSING=0
fi

if [ "$DEPLOYED" = yes ] && [ "$MISSING" = 0 ]; then
  echo "사이트 정상: ${HEAD:0:7} 배포됨, 영상 $(echo "$WANT" | count)개 모두 보임"
  exit 0
fi
echo "확인 필요: ${HEAD:0:7} (커밋 $((AGE / 60))분 전) — 배포 기록 ${DEPLOYED}, 사이트에 안 보이는 영상 ${MISSING}개"
if [ "$AGE" -lt 600 ]; then echo "배포를 기다리는 중"; exit 0; fi

PAGES='.workflow_runs[] | select(.name == "pages build and deployment" and .status != "completed")'
if [ "$(gh api "$R/actions/runs?event=dynamic&per_page=30" --jq "[$PAGES | select(now - (.created_at | fromdateiso8601) < 600)] | length")" != 0 ]; then
  echo "새 배포가 진행 중 — 다음 실행에서 다시 확인"
else
  for ID in $(gh api "$R/actions/runs?event=dynamic&per_page=30" --jq "$PAGES | .id"); do
    echo "멈춘 배포 취소: $ID"
    gh api -X POST "$R/actions/runs/$ID/cancel" > /dev/null || gh api -X POST "$R/actions/runs/$ID/force-cancel" > /dev/null || true
  done
  echo "::warning::${HEAD:0:7} 이 $((AGE / 60))분째 사이트에 보이지 않아 다시 배포를 요청합니다"
  gh api -X POST "$R/pages/builds" > /dev/null
fi

if [ "$AGE" -ge 3600 ]; then
  echo "::error::공개 사이트가 $((AGE / 60))분째 최신이 아닙니다(${HEAD:0:7}). 자동으로 다시 배포를 요청하고 있지만 풀리지 않으면 Actions 탭을 확인해 주세요"
  if [ "$LOUD" = true ]; then exit 1; fi
fi
