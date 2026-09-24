#!/usr/bin/env bash
set -uo pipefail

usage="usage: record.sh <host-id> <act> <from> <to> <frames-dir-name> [session-id]"
HOST="${1:?$usage}"
ACT="${2:?$usage}"
FROM="${3:?$usage}"
TO="${4:?$usage}"
NAME="${5:?$usage}"
SID="${6:-}"
THREAD="${BB_THREAD_ID:-${THREAD:-}}"
if [ -z "$THREAD" ]; then echo "Set THREAD to the owning bb thread ID" >&2; exit 1; fi
CITY="${CITY:-nyc}"
PORT="${PORT:-5177}"
FORMAT="${FORMAT:-landscape}"
case "$FORMAT" in vertical) VW=1080; VH=1920;; portrait) VW=1080; VH=1350;; *) VW=1920; VH=1080;; esac
CHUNK_FROM="$FROM"
next="$FROM"

open_session() {
  "${BB_CLI:-bb}" browser-automation open --backend local --headless --machine "$HOST" --thread "$THREAD" --json | jq -r .id
}

start_page() {
  echo "$(date +%T) start $NAME frames $next..$TO on $HOST ($SID)"
  "${BB_CLI:-bb}" browser-automation run "$SID" --thread "$THREAD" --timeout 60s --json --script "
    const p = await browser.getPage('main');
    await p.setViewport({width:$VW,height:$VH,deviceScaleFactor:1});
    await p.goto('http://localhost:$PORT/?city=$CITY&act=$ACT&format=$FORMAT&record=1&session=$NAME&from=$next&to=$TO&chunkFrom=$CHUNK_FROM', {waitUntil:'domcontentloaded', timeout: 50000});
    'started'" >/dev/null
}

poll() {
  "${BB_CLI:-bb}" browser-automation run "$SID" --thread "$THREAD" --timeout 20s --json --script "
    const p = await browser.getPage('main');
    await p.evaluate(() => JSON.stringify({prog: window.__recordProgress ?? null, res: window.__recordResult ?? null}))" 2>/dev/null |
    jq -r '.text // empty' 2>/dev/null
}

if [ -z "$SID" ]; then
  SID=$(open_session)
fi
start_page
failures=0
while true; do
  sleep 40
  state=$(poll)
  echo "$(date +%T) $state"
  if echo "$state" | grep -q '"out"'; then
    echo "DONE $state"
    break
  fi
  frame=$(echo "$state" | jq -r '.prog.frame // empty' 2>/dev/null)
  [ -n "$frame" ] && next="$frame"
  if [ -z "$state" ] || echo "$state" | grep -q '"error"\|"prog":null'; then
    failures=$((failures + 1))
    if [ "$failures" -ge 2 ]; then
      "${BB_CLI:-bb}" browser-automation close "$SID" --thread "$THREAD" --json >/dev/null 2>&1
      SID=$(open_session)
      start_page
      failures=0
    fi
  else
    failures=0
  fi
done
"${BB_CLI:-bb}" browser-automation close "$SID" --thread "$THREAD" --json >/dev/null 2>&1
