// Chat with the sales data: question in, explanation + result table out, SQL behind a disclosure.
const $chat = selector => document.querySelector(selector);
const chatDialog = $chat('#chatDialog');
const chatLog = $chat('#chatLog');
const chatInput = $chat('#chatInput');
const SUGGESTIONS = ['Top counters by sales', 'School shoes vs other shoes', 'Sales by retailer this month', 'Units sold each month'];

$chat('#showChat').onclick = () => chatDialog.showModal();
$chat('#closeChat').onclick = () => chatDialog.close();
$chat('#chatChips').innerHTML = SUGGESTIONS.map(s => `<button type="button" class="secondary" data-ask="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
$chat('#chatChips').onclick = event => { const ask = event.target.dataset?.ask; if (ask) { chatInput.value = ask; $chat('#chatForm').requestSubmit(); } };

const moneyish = column => /sales|rm|cost|profit|price|total/i.test(column);
// Strings pass through untouched (a year label, a store name); only actual numbers get formatted.
const cellValue = (column, value) => {
  if (value == null) return '';
  if (moneyish(column)) return money(Number(value));
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(value);
};

function chatCard(html) {
  const card = document.createElement('div');
  card.className = 'chatCard';
  card.innerHTML = html;
  chatLog.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

let chatAbort = null;
const chatSend = $chat('#chatSend');

// While a question is in flight the send button becomes Stop: it aborts the request.
chatSend.onclick = event => {
  if (chatAbort) { event.preventDefault(); chatAbort.abort(); }
};

$chat('#chatForm').onsubmit = async event => {
  event.preventDefault();
  const question = chatInput.value.trim();
  if (!question || chatAbort) return;
  chatInput.value = '';
  chatCard(`<div class="chatQuestion">${escapeHtml(question)}</div>`);
  const pending = chatCard('<div class="chatPending"><div class="spinner"></div> Thinking about the data&hellip;</div>');
  chatAbort = new AbortController();
  chatSend.textContent = 'Stop';
  const done = () => { chatAbort = null; chatSend.textContent = 'Ask'; };
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }), signal: chatAbort.signal });
    const body = await response.json().catch(() => ({}));
    pending.remove();
    done();
    if (!response.ok) return chatCard(`<div class="chatError">${escapeHtml(body.error || 'Something went wrong. Try rephrasing the question.')}</div>`);
    const table = body.rows?.length
      ? `<div class="tableWrap"><table><thead><tr>${body.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body.rows.map(row => `<tr>${body.columns.map(c => `<td>${escapeHtml(String(cellValue(c, row[c])))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">There is no data for that yet.</p>';
    chatCard(`<p class="chatAnswer">${escapeHtml(body.answer || '')}</p>${table}
      <details><summary>Where these numbers come from</summary><code>${escapeHtml(body.tool || '')} ${escapeHtml(JSON.stringify(body.args || {}, null, 1))}</code></details>`);
  } catch (error) {
    pending.remove();
    done();
    if (error.name === 'AbortError') return chatCard('<div class="chatError">Stopped.</div>');
    chatCard('<div class="chatError">The answer service is unreachable. Check that the app is running, then try again.</div>');
  }
};
