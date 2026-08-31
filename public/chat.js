// Chat with the sales data: question in, explanation + result table out, SQL behind a disclosure.
const $chat = selector => document.querySelector(selector);
const chatDialog = $chat('#chatDialog');
const chatLog = $chat('#chatLog');
const chatInput = $chat('#chatInput');
const clearChatPrompt = $chat('#clearChatPrompt');
const chatSettingsBtn = $chat('#chatSettingsBtn');
const chatGooeyOverlay = $chat('#chatGooeyOverlay');
const recentChatsList = $chat('#recentChatsList');
const SUGGESTIONS = ['Top counters by sales', 'School shoes vs other shoes', 'Sales by retailer this month', 'Units sold each month'];

// Window helper
window.openChat = () => chatDialog.showModal();
$chat('#closeChat').onclick = () => chatDialog.close();

// Suggestions bar (single row horizontal scroll)
$chat('#chatChips').innerHTML = SUGGESTIONS.map(s => `<button type="button" class="secondary" data-ask="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
$chat('#chatChips').onclick = event => { const ask = event.target.dataset?.ask; if (ask) { chatInput.value = ask; updateClearPromptBtn(); $chat('#chatForm').requestSubmit(); } };

// Input clear prompt button logic
function updateClearPromptBtn() {
  if (clearChatPrompt) clearChatPrompt.hidden = !chatInput.value.length;
}
if (chatInput) {
  chatInput.addEventListener('input', updateClearPromptBtn);
}
if (clearChatPrompt) {
  clearChatPrompt.onclick = () => {
    chatInput.value = '';
    clearChatPrompt.hidden = true;
    chatInput.focus();
  };
}

const moneyish = column => /sales|rm|cost|profit|price|total/i.test(column);
const cellValue = (column, value) => {
  if (value == null) return '';
  if (moneyish(column)) return money(Number(value));
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return value;
};

function chatQuestionCard(text) {
  const q = document.createElement('div');
  q.className = 'chatQuestion';
  q.textContent = text;
  chatLog.appendChild(q);
  q.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return q;
}

function chatCard(html) {
  const card = document.createElement('div');
  card.className = 'chatCard';
  card.innerHTML = html;
  chatLog.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'end' });
  return card;
}

// Session-based chat history persistence (Archived after 1 hour)
const SESSIONS_KEY = 'chat_sessions_v1';
let currentSessionId = null;

function getSessions() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); } catch { return []; }
}

function saveSessions(sessions) {
  try { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, 30))); } catch {}
}

function getActiveOrCreateSession() {
  const sessions = getSessions();
  const ONE_HOUR = 3600000;
  let latest = sessions[0];
  if (!latest || (Date.now() - latest.timestamp > ONE_HOUR)) {
    latest = {
      id: 'session_' + Date.now(),
      timestamp: Date.now(),
      title: 'New Conversation',
      entries: []
    };
    sessions.unshift(latest);
    saveSessions(sessions);
  }
  currentSessionId = latest.id;
  return latest;
}

function saveSessionEntry(q, aHtml) {
  const sessions = getSessions();
  let session = sessions.find(s => s.id === currentSessionId);
  if (!session) {
    session = getActiveOrCreateSession();
  }
  if (session.entries.length === 0) {
    session.title = q.slice(0, 45);
  }
  session.timestamp = Date.now();
  session.entries.push({ q, a: aHtml });
  saveSessions(sessions);
}

function renderChatSession(session) {
  chatLog.innerHTML = '';
  const ONE_HOUR = 3600000;
  const isArchived = (Date.now() - session.timestamp > ONE_HOUR);

  if (session.entries && session.entries.length) {
    for (const entry of session.entries) {
      chatQuestionCard(entry.q);
      if (entry.a) chatCard(entry.a);
    }
  } else {
    chatLog.innerHTML = '<p class="hint">Ask anything about the imported reports &mdash; totals, comparisons, trends, or a specific counter.</p>';
  }

  if (isArchived) {
    chatInput.disabled = true;
    chatInput.value = '';
    chatInput.placeholder = 'Chat Archived (read only)';
  } else {
    chatInput.disabled = false;
    chatInput.placeholder = 'e.g. Which counter sold the most school shoes?';
  }
  updateClearPromptBtn();
}

// Initial restore
(function initChatSession() {
  const active = getActiveOrCreateSession();
  renderChatSession(active);
})();

// React Bits GooeyNav Particle Generator
function triggerGooeyParticles() {
  const container = $chat('#gooeyParticles');
  if (!container) return;
  container.innerHTML = '';
  const colors = ['var(--accent)', '#3b82f6', '#60a5fa', '#93c5fd'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('span');
    p.className = 'gooeyParticle';
    const dx = (Math.random() - 0.5) * 340;
    const dy = (Math.random() - 0.5) * 340;
    p.style.left = `${50 + (Math.random() - 0.5) * 20}%`;
    p.style.top = `${50 + (Math.random() - 0.5) * 20}%`;
    p.style.setProperty('--dx', `${dx}px`);
    p.style.setProperty('--dy', `${dy}px`);
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDelay = `${i * 15}ms`;
    container.appendChild(p);
  }
}

// Settings gear menu open/close
if (chatSettingsBtn && chatGooeyOverlay) {
  chatSettingsBtn.onclick = () => {
    triggerGooeyParticles();
    renderRecentChatsList();
    chatGooeyOverlay.hidden = false;
  };
}
if ($chat('#closeGooeyMenu')) {
  $chat('#closeGooeyMenu').onclick = () => { chatGooeyOverlay.hidden = true; };
}
if ($chat('#newChatSessionBtn')) {
  $chat('#newChatSessionBtn').onclick = () => {
    const sessions = getSessions();
    const newSess = {
      id: 'session_' + Date.now(),
      timestamp: Date.now(),
      title: 'New Conversation',
      entries: []
    };
    sessions.unshift(newSess);
    saveSessions(sessions);
    currentSessionId = newSess.id;
    renderChatSession(newSess);
    chatGooeyOverlay.hidden = true;
  };
}

function renderRecentChatsList() {
  const sessions = getSessions();
  const ONE_HOUR = 3600000;
  if (!sessions.length) {
    recentChatsList.innerHTML = '<p class="hint">No recent conversations yet.</p>';
    return;
  }
  recentChatsList.innerHTML = sessions.map(s => {
    const isArchived = (Date.now() - s.timestamp > ONE_HOUR);
    const isCurrent = s.id === currentSessionId;
    const timeStr = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = new Date(s.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `
      <div class="recentChatItem ${isCurrent ? 'active' : ''} ${isArchived ? 'archived' : ''}" data-sess-id="${s.id}">
        <div>
          <strong>${escapeHtml(s.title || 'Untitled Chat')}</strong>
          <small style="display:block;color:var(--ink2);margin-top:2px">${dateStr} ${timeStr} &middot; ${s.entries.length} messages</small>
        </div>
        <span class="recentChatBadge ${isArchived ? 'archived' : 'active'}">${isArchived ? 'Archived' : 'Active'}</span>
      </div>
    `;
  }).join('');

  recentChatsList.querySelectorAll('.recentChatItem').forEach(el => {
    el.onclick = () => {
      const id = el.dataset.sessId;
      const sess = sessions.find(x => x.id === id);
      if (sess) {
        currentSessionId = sess.id;
        renderChatSession(sess);
        chatGooeyOverlay.hidden = true;
      }
    };
  });
}

let chatAbort = null;
const chatSend = $chat('#chatSend');

chatSend.onclick = event => {
  if (chatAbort) { event.preventDefault(); chatAbort.abort(); }
};

$chat('#chatForm').onsubmit = async event => {
  event.preventDefault();
  const question = chatInput.value.trim();
  if (!question || chatAbort) return;
  chatInput.value = '';
  updateClearPromptBtn();
  chatQuestionCard(question);

  const pending = chatCard('<div class="chatPending"><div class="spinner"></div> <span class="chatTick">Thinking about the data&hellip;</span><br><small class="chatTickHint">this can take up to half a minute</small></div>');
  const started = Date.now();
  const ticker = setInterval(() => {
    const el = pending.querySelector('.chatTick');
    if (el) el.textContent = `Thinking about the data… ${Math.round((Date.now() - started) / 1000)}s`;
  }, 1000);

  chatAbort = new AbortController();
  chatSend.textContent = 'Stop';
  const done = () => { chatAbort = null; chatSend.textContent = 'Ask'; clearInterval(ticker); };

  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }), signal: chatAbort.signal });
    const body = await response.json().catch(() => ({}));
    pending.remove();
    done();

    if (!response.ok) {
      const errHtml = `<div class="chatError">${escapeHtml(body.error || 'Something went wrong. Try rephrasing the question.')}</div>`;
      chatCard(errHtml);
      return;
    }

    const table = body.rows?.length
      ? `<div class="tableWrap"><table><thead><tr>${body.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body.rows.map(row => `<tr>${body.columns.map(c => `<td>${escapeHtml(String(cellValue(c, row[c])))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">There is no data for that yet.</p>';
    const answerHtml = `<p class="chatAnswer">${escapeHtml(body.answer || '')}</p>${table}<details><summary>Where these numbers come from</summary><code>${escapeHtml(body.tool || '')} ${escapeHtml(JSON.stringify(body.args || {}, null, 1))}</code></details>`;
    chatCard(answerHtml);

    saveSessionEntry(question, answerHtml);
  } catch (error) {
    pending.remove();
    done();
    if (error.name === 'AbortError') return chatCard('<div class="chatError">Stopped.</div>');
    chatCard('<div class="chatError">The answer service is unreachable. Check that the app is running, then try again.</div>');
  }
};
