/* ============================================================================
   APP.JS — read-only, polling leaderboard for a big-screen display.
   Never writes to `scores`; only SELECT, refreshed on a fixed interval.
============================================================================ */

const CFG = window.LEADERBOARD_CONFIG || {};
const SUPABASE_URL = CFG.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = CFG.SUPABASE_ANON_KEY || '';
const TOP_N = CFG.TOP_N || 10;
const POLL_INTERVAL_MS = CFG.POLL_INTERVAL_MS || 7000; // 5000-10000 recommended
const PAGE_RELOAD_INTERVAL_MS = CFG.PAGE_RELOAD_INTERVAL_MS || 6 * 60 * 60 * 1000;

const boardEl = document.getElementById('board');
const liveDot = document.getElementById('liveDot');
const liveLabel = document.getElementById('liveLabel');
const updatedAtEl = document.getElementById('updatedAt');

let client = null;
let currentList = []; // sorted desc, length <= TOP_N, mirrors what's on screen
let isFetching = false;

function rowKey(row) {
  return `${row.player_name}|${row.score}`;
}

function medalClass(rank) {
  if (rank === 1) return 'row--top1';
  if (rank === 2) return 'row--top2';
  if (rank === 3) return 'row--top3';
  return '';
}

// Positional diff: a slot is "changed" if the row occupying it is different
// from what was there before (new entrant, dropped rank, or a value change —
// rowKey includes score, so a re-submit with a new score also counts).
// Used to only flash the rows that actually moved, not the whole board.
function diffChangedKeys(oldList, newList) {
  const changed = new Set();
  const len = Math.max(oldList.length, newList.length);
  for (let i = 0; i < len; i++) {
    const before = oldList[i] ? rowKey(oldList[i]) : null;
    const after = newList[i] ? rowKey(newList[i]) : null;
    if (after && before !== after) changed.add(after);
  }
  return changed;
}

function render(highlightKeys) {
  if (!currentList.length) {
    boardEl.innerHTML = '<div class="board__empty">No scores yet — be the first!</div>';
    return;
  }

  boardEl.innerHTML = currentList.map((row, i) => {
    const rank = i + 1;
    const cls = ['row', medalClass(rank)];
    const key = rowKey(row);
    if (highlightKeys && highlightKeys.has(key)) cls.push('row--new');
    return `
      <div class="${cls.filter(Boolean).join(' ')}" data-key="${key}">
        <div class="row__rank">#${rank}</div>
        <div class="row__name">${escapeHtml(row.player_name || 'Anonymous')}</div>
        <div class="row__score">${formatScore(row.score)}</div>
      </div>`;
  }).join('');

  // Strip the highlight class once its animation has finished, so the next
  // poll tick doesn't replay it for rows that didn't actually change.
  if (highlightKeys && highlightKeys.size) {
    setTimeout(() => {
      boardEl.querySelectorAll('.row--new').forEach((el) => el.classList.remove('row--new'));
    }, 1700);
  }

  fitBoard();
}

// Last-resort safety net: the CSS sizing is tuned to fit TOP_N=10 on a
// 1920x1080-ish display, but an unusually short viewport or a larger TOP_N
// could still overflow. Rather than let that clip rows or spill into the
// header, uniformly scale the board down until it fits.
function fitBoard() {
  boardEl.style.transform = '';
  boardEl.style.transformOrigin = 'top center';
  const overflow = boardEl.scrollHeight - boardEl.clientHeight;
  if (overflow > 1) {
    const scale = Math.max(0.5, boardEl.clientHeight / boardEl.scrollHeight);
    boardEl.style.transform = `scale(${scale})`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatScore(score) {
  const n = Number(score);
  return Number.isFinite(n) ? n.toLocaleString() : String(score);
}

function setStatus(state) {
  liveDot.classList.remove('is-live', 'is-down');
  if (state === 'live') {
    liveDot.classList.add('is-live');
    liveLabel.textContent = 'live';
  } else if (state === 'down') {
    liveDot.classList.add('is-down');
    liveLabel.textContent = 'retrying…';
  } else {
    liveLabel.textContent = 'connecting…';
  }
}

function stampUpdated() {
  const now = new Date();
  updatedAtEl.textContent = `updated ${now.toLocaleTimeString()}`;
}

async function fetchLeaderboard() {
  if (!client || isFetching) return; // overlap guard: skip if a poll is still in flight
  isFetching = true;
  try {
    const { data, error } = await client
      .from('scores')
      .select('player_name, score')
      .order('score', { ascending: false })
      .limit(TOP_N);

    if (error) {
      // A single failed poll shouldn't disrupt the display — keep showing
      // the last successfully fetched list and just log it.
      console.warn('[Leaderboard] poll failed:', error.message);
      setStatus('down');
      return;
    }

    const newList = data || [];
    const changedKeys = diffChangedKeys(currentList, newList);
    currentList = newList;
    render(changedKeys);
    stampUpdated();
    setStatus('live');
  } catch (err) {
    console.warn('[Leaderboard] poll failed:', err);
    setStatus('down');
  } finally {
    isFetching = false;
  }
}

let pollHandle = null;

function startPolling() {
  if (pollHandle) return;
  fetchLeaderboard(); // immediate first fetch so the board isn't empty
  pollHandle = setInterval(fetchLeaderboard, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (!pollHandle) return;
  clearInterval(pollHandle);
  pollHandle = null;
}

function init() {
  if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL_HERE') {
    boardEl.innerHTML = '<div class="board__empty">Missing Supabase config — copy config.example.js to config.js and fill in your project values.</div>';
    setStatus('down');
    return;
  }

  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // This is the always-on big-screen display, not a UI panel that gets
  // opened/closed, so polling just runs for the lifetime of the page.
  startPolling();

  // Safety net: reload the whole tab periodically to guard against
  // long-running memory/state drift on an unattended display.
  setTimeout(() => window.location.reload(), PAGE_RELOAD_INTERVAL_MS);
}

init();
