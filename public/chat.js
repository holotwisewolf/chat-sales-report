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
const cellValue = (column, value) => value == null ? '' : moneyish(column) ? money(Number(value)) : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

function chatCard(html) {
  const card = document.createElement('div');
  card.className = 'chatCard';
  card.innerHTML = html;
  chatLog.appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

$chat('#chatForm').onsubmit = async event => {
  event.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;
  chatInput.value = '';
  chatCard(`<div class="chatQuestion">${escapeHtml(question)}</div>`);
  const pending = chatCard('<div class="chatPending"><div class="spinner"></div> Thinking about the data&hellip;</div>');
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
    const body = await response.json().catch(() => ({}));
    pending.remove();
    if (!response.ok) return chatCard(`<div class="chatError">${escapeHtml(body.error || 'Something went wrong. Try rephrasing the question.')}</div>`);
    const table = body.rows.length
      ? `<div class="tableWrap"><table><thead><tr>${body.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${body.rows.map(row => `<tr>${body.columns.map(c => `<td>${escapeHtml(String(cellValue(c, row[c])))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      : '<p class="hint">The query ran but returned no rows for these filters.</p>';
    chatCard(`<p class="chatAnswer">${escapeHtml(body.explanation)}</p>${table}
      ${body.truncated ? '<p class="hint">Showing the first 200 rows.</p>' : ''}
      <details><summary>The query used</summary><code>${escapeHtml(body.sql)}</code></details>`);
  } catch {
    pending.remove();
    chatCard('<div class="chatError">The answer service is unreachable. Check that the app is running, then try again.</div>');
  }
};
