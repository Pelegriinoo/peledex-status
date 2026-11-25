const daysShown = 90;
const compactDays = 30;
const staleAfterMs = 20 * 60 * 1000;
const snapshotAssignment = 'globalThis.peledexStatus = ';
let snapshot = globalThis.peledexStatus ?? {};
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
const displayDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' });
const displayCheckTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});
const displayPercent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 3 });
const states = {
  up: 'Operacional', partial: 'Falhas intermitentes', down: 'Indisponível', unknown: 'Sem dados',
};

const cards = [...document.querySelectorAll('[data-service]')];
const summary = document.querySelector('.summary');
const summaryTitle = document.querySelector('#summary-title');
const updated = document.querySelector('#updated');
const availability = document.querySelector('.availability');
const overall = document.querySelector('.overall');
overall.addEventListener('click', () => {
  const collapse = overall.getAttribute('aria-expanded') === 'true';
  overall.setAttribute('aria-expanded', String(!collapse));
  document.querySelector('#service-history').hidden = collapse;
});
const historyToggle = document.querySelector('#history-window');
const compactLayout = matchMedia('(max-width: 39rem)');
let expandedHistory = false;
let visibleDays = daysShown;

function renderCurrentStatus() {
  const checkedAt = Date.parse(snapshot.checkedAt);
  const stale = !Number.isFinite(checkedAt) || Date.now() - checkedAt > staleAfterMs;
  const serviceStates = cards.map((card) => {
    const badge = card.querySelector('.badge');
    const state = stale ? 'unknown' : snapshot.services?.[card.dataset.service]?.state ?? 'unknown';
    badge.dataset.state = state;
    badge.setAttribute('aria-label', states[state]);
    return state;
  });
  const downCount = serviceStates.filter((state) => state === 'down').length;
  let message;

  if (stale) {
    summary.dataset.state = 'unknown';
    message = Number.isFinite(checkedAt) ? 'Status sem atualização recente' : 'Aguardando dados de monitoramento';
  } else if (downCount > 0) {
    summary.dataset.state = 'down';
    message = downCount === 1 ? 'Um serviço indisponível' : 'Serviços indisponíveis';
  } else {
    summary.dataset.state = 'up';
    message = 'Todos os serviços operacionais';
  }

  overall.dataset.state = summary.dataset.state;
  document.querySelector('#overall-state').textContent = states[summary.dataset.state];
  if (summaryTitle.textContent !== message) summaryTitle.textContent = message;
  if (Number.isFinite(checkedAt)) {
    updated.textContent = `Última checagem em ${displayCheckTime.format(checkedAt)} (Brasília).`;
  }
}

function createDay(history) {
  const item = document.createElement('li');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'day';
  button.tabIndex = -1;
  button.setAttribute('aria-pressed', 'false');
  item.append(button);
  history.append(item);
  return button;
}

function selectDay(card, button) {
  const previous = card.querySelector('.day[aria-pressed="true"]');
  if (previous && previous !== button) {
    previous.setAttribute('aria-pressed', 'false');
    previous.tabIndex = -1;
  }
  button.setAttribute('aria-pressed', 'true');
  button.tabIndex = 0;
  const label = card.querySelector('.day-label');
  const count = card.querySelector('.day-count');
  if (label.textContent !== button.dataset.label) label.textContent = button.dataset.label;
  if (count.textContent !== button.dataset.count) count.textContent = button.dataset.count;
  card.querySelector('[data-shift="-1"]').setAttribute('aria-disabled', String(!dayInDirection(button, -1)));
  card.querySelector('[data-shift="1"]').setAttribute('aria-disabled', String(!dayInDirection(button, 1)));
}

function dayInDirection(button, direction) {
  const item = button.parentElement;
  if (direction < 0 && Number(button.dataset.offset) >= visibleDays - 1) return;
  return (direction < 0 ? item.previousElementSibling : item.nextElementSibling)?.firstElementChild;
}

for (const card of cards) {
  const history = card.querySelector('.history');
  history.addEventListener('click', (event) => {
    const button = event.target.closest('.day');
    if (!button) return;
    card.dataset.inspecting = '';
    selectDay(card, button);
  });
  history.addEventListener('keydown', (event) => {
    const current = event.target.closest('.day');
    if (!current) return;
    const target = {
      ArrowLeft: dayInDirection(current, -1),
      ArrowRight: dayInDirection(current, 1),
      Home: history.children[daysShown - visibleDays].firstElementChild,
      End: history.lastElementChild.firstElementChild,
    }[event.key];
    if (!target) return;
    event.preventDefault();
    card.dataset.inspecting = '';
    selectDay(card, target);
    target.focus();
  });
  for (const control of card.querySelectorAll('[data-shift]')) {
    control.addEventListener('click', () => {
      const current = history.querySelector('.day[aria-pressed="true"]');
      const target = dayInDirection(current, Number(control.dataset.shift));
      if (target) selectDay(card, target);
    });
  }
  card.querySelector('[data-close]').addEventListener('click', () => {
    delete card.dataset.inspecting;
    history.querySelector('.day[aria-pressed="true"]').focus();
  });
}

function renderHistory() {
  const today = Date.parse(`${dateKey.format(new Date())}T00:00:00Z`);
  for (const card of cards) {
    const history = card.querySelector('.history');
    const buttons = history.querySelectorAll('.day');
    const selectedDate = history.querySelector('.day[aria-pressed="true"]')?.dataset.date;
    const days = snapshot.services?.[card.dataset.service]?.days ?? {};
    let passing = 0;
    let total = 0;
    let selected;

    for (let offset = daysShown - 1; offset >= 0; offset--) {
      const day = new Date(today - offset * 86_400_000);
      const date = day.toISOString().slice(0, 10);
      const { up = 0, down = 0 } = days[date] ?? {};
      const checks = up + down;
      const state = checks === 0 ? 'unknown' : down === 0 ? 'up' : up === 0 ? 'down' : 'partial';
      if (offset < visibleDays) {
        passing += up;
        total += checks;
      }

      const button = buttons[daysShown - 1 - offset] ?? createDay(history);
      button.dataset.state = state;
      button.dataset.date = date;
      button.dataset.failures = down ? down + (down === 1 ? ' checagem com falha' : ' checagens com falha') : '';
      button.dataset.offset = offset;
      button.dataset.label = `${displayDate.format(day)} · ${states[state]}`;
      button.dataset.count = checks ? `${up} de ${checks} checagens bem-sucedidas` : 'Nenhuma checagem registrada';
      button.setAttribute('aria-label', `${button.dataset.label}. ${button.dataset.count}.`);
      if (date === selectedDate && offset < visibleDays) selected = button;
    }

    selectDay(card, selected ?? history.lastElementChild.firstElementChild);
    card.querySelector('.uptime').textContent = total > 0
      ? `${displayPercent.format(passing / total)} uptime`
      : '—';
  }
}

function renderHistoryWindow() {
  visibleDays = compactLayout.matches && !expandedHistory ? compactDays : daysShown;
  availability.dataset.window = visibleDays;
  for (const label of document.querySelectorAll('.range-start')) label.textContent = `Há ${visibleDays} dias`;
  historyToggle.hidden = !compactLayout.matches;
  historyToggle.textContent = expandedHistory ? `Ver ${compactDays} dias` : `Ver ${daysShown} dias`;
  renderHistory();
}

historyToggle.addEventListener('click', () => {
  expandedHistory = !expandedHistory;
  renderHistoryWindow();
});
compactLayout.addEventListener('change', renderHistoryWindow);

async function refresh() {
  try {
    const response = await fetch('status-data.js', { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (response.ok) {
      const source = (await response.text()).trimEnd();
      if (source.startsWith(snapshotAssignment) && source.endsWith(';')) {
        const next = JSON.parse(source.slice(snapshotAssignment.length, -1));
        if (Date.parse(next.checkedAt) > (Date.parse(snapshot.checkedAt) || 0)) {
          snapshot = next;
          renderHistory();
        }
      }
    }
  } catch {
    // Keep the last successful snapshot. Its timestamp still determines freshness.
  }
  renderCurrentStatus();
}

renderCurrentStatus();
renderHistoryWindow();
setInterval(refresh, 60_000);

const tooltip = document.createElement('div');
tooltip.className = 'day-tip';
tooltip.hidden = true;
tooltip.setAttribute('aria-hidden', 'true');
const tipStatus = document.createElement('strong');
const tipDate = document.createElement('small');
const tipFailures = document.createElement('small');
tooltip.append(tipStatus, tipDate, tipFailures);
document.body.append(tooltip);

function hideTooltip() {
  tooltip.hidden = true;
}

function showTooltip(button) {
  tooltip.dataset.state = button.dataset.state;
  tipStatus.textContent = states[button.dataset.state];
  tipDate.textContent = displayDate.format(new Date(button.dataset.date + 'T00:00:00Z'));
  tipFailures.textContent = button.dataset.failures;
  tooltip.hidden = false;
  const bar = button.getBoundingClientRect();
  const x = bar.left + (bar.width - tooltip.offsetWidth) / 2;
  tooltip.style.left = Math.max(8, Math.min(x, innerWidth - tooltip.offsetWidth - 8)) + 'px';
  const above = bar.top - tooltip.offsetHeight - 6;
  tooltip.style.top = (above >= 8 ? above : bar.bottom + 6) + 'px';
}

for (const history of document.querySelectorAll('.history')) {
  history.addEventListener('pointerover', event => {
    const day = event.target.closest('.day');
    if (day && event.pointerType !== 'touch') showTooltip(day);
  });
  history.addEventListener('focusin', event => {
    if (event.target.matches('.day:focus-visible')) showTooltip(event.target);
  });
  history.addEventListener('pointerleave', hideTooltip);
  history.addEventListener('focusout', hideTooltip);
  history.addEventListener('click', hideTooltip);
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') hideTooltip(); });
window.addEventListener('scroll', hideTooltip, { passive: true });
window.addEventListener('resize', hideTooltip);
