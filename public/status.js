const daysShown = 30;
const staleAfterMs = 20 * 60 * 1000;
const snapshotAssignment = 'globalThis.peledexStatus = ';
let snapshot = globalThis.peledexStatus ?? {};
const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' });
const displayDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: 'UTC' });
const displayCheckTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});
const displayPercent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 2 });
const states = {
  up: 'Operacional', partial: 'Falhas intermitentes', down: 'Indisponível', unknown: 'Sem dados',
};

const cards = [...document.querySelectorAll('[data-service]')];
const summary = document.querySelector('.summary');
const summaryTitle = document.querySelector('#summary-title');
const updated = document.querySelector('#updated');
const detail = document.querySelector('#daily-detail');

function renderCurrentStatus() {
  const checkedAt = Date.parse(snapshot.checkedAt);
  const stale = !Number.isFinite(checkedAt) || Date.now() - checkedAt > staleAfterMs;
  const serviceStates = cards.map((card) => {
    const badge = card.querySelector('.badge');
    const state = stale ? 'unknown' : snapshot.services?.[card.dataset.service]?.state ?? 'unknown';
    badge.dataset.state = state;
    badge.textContent = states[state];
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
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => {
    document.querySelector('.day[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-pressed', 'true');
    detail.textContent = button.dataset.detail;
  });
  item.append(button);
  history.append(item);
  return button;
}

function renderHistory() {
  const today = Date.parse(`${dateKey.format(new Date())}T00:00:00Z`);
  for (const card of cards) {
    const history = card.querySelector('.history');
    const buttons = history.querySelectorAll('.day');
    const serviceName = card.querySelector('h3').textContent;
    const days = snapshot.services?.[card.dataset.service]?.days ?? {};
    let passing = 0;
    let total = 0;

    for (let offset = daysShown - 1; offset >= 0; offset--) {
      const day = new Date(today - offset * 86_400_000);
      const { up = 0, down = 0 } = days[day.toISOString().slice(0, 10)] ?? {};
      const checks = up + down;
      const state = checks === 0 ? 'unknown' : down === 0 ? 'up' : up === 0 ? 'down' : 'partial';
      const label = `${serviceName}, ${displayDate.format(day)}, ${states[state]}`;
      passing += up;
      total += checks;

      const button = buttons[daysShown - 1 - offset] ?? createDay(history);
      button.dataset.state = state;
      button.setAttribute('aria-label', label);
      const counts = checks ? ` ${up} checagens bem-sucedidas de ${checks}.` : '';
      button.dataset.detail = `${label}.${counts}`;
      if (button.getAttribute('aria-pressed') === 'true' && detail.textContent !== button.dataset.detail) {
        detail.textContent = button.dataset.detail;
      }
    }

    card.querySelector('.uptime').textContent = total > 0
      ? `${displayPercent.format(passing / total)} nas checagens`
      : 'Sem checagens';
  }
}

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
renderHistory();
setInterval(refresh, 60_000);
