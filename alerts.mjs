import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const queue = new URL('./pending-alerts.js', import.meta.url);
const prefix = 'export default ';
async function readQueue() {
  try { return JSON.parse((await readFile(queue, 'utf8')).trim().slice(prefix.length, -1)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function save(events) {
  await writeFile(queue, prefix + JSON.stringify(events, null, 2) + ';\n');
}
export function transitions(previous, snapshot) {
  return Object.entries(snapshot.services).flatMap(([service, { state }]) => {
    const before = previous.services?.[service]?.state;
    if (before === state || (!before && state === 'up')) return [];
    return [{ service, state, at: snapshot.checkedAt }];
  });
}
export async function enqueue(previous, snapshot) {
  const changes = transitions(previous, snapshot);
  if (changes.length) await save([...(await readQueue()), ...changes]);
}
export function send(events, transport = spawnSync) {
  const { GMAIL_USER: from, GMAIL_APP_PASSWORD: password, ALERT_EMAIL_TO: to } = process.env;
  const mailbox = /^[^\s<>@:]+@[^\s<>@:]+\.[^\s<>@:]+$/;
  if (!password || !mailbox.test(from ?? '') || !mailbox.test(to ?? '')) throw Error('Confira os secrets de e-mail.');
  const names = { landing: 'Site', health: 'API e banco de dados' };
  const statusUrl = 'https://pelegriinoo.github.io/peledex-status/';
  const changes = events.map(({ service, state, at }) => ({
    name: names[service] ?? 'Serviço monitorado',
    recovered: state === 'up',
    time: new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
    }).format(new Date(at)),
  }));
  const first = changes[0];
  const title = changes.length === 1
    ? first.name + (first.recovered ? ' voltou a responder' : ' indisponível')
    : changes.length + ' mudanças nos serviços do PeleDex';
  const rows = changes.map(({ name, recovered, time }) => {
    const state = recovered ? 'Operacional' : 'Indisponível';
    const color = recovered ? '#6ee7b7' : '#fda4af';
    return '<tr><td style="padding:16px;background:#27272a;border-radius:10px">' +
      '<strong style="color:' + color + '">' + state + '</strong><br>' +
      '<b style="color:#fafafa">' + name + '</b><br>' +
      '<span style="color:#d4d4d8">Detectado em ' + time + ' (Brasília)</span></td></tr>';
  });
  const explanation = changes.length === 1 && !first.recovered
    ? 'Você receberá outro aviso quando o monitor detectar a recuperação.'
    : 'O histórico de cada serviço está disponível na página de status.';
  const plain = [title, ...changes.map(c => c.name + ' — ' + (c.recovered ? 'operacional' : 'indisponível') + ', ' + c.time + ' (Brasília).'), explanation, statusUrl].join('\n\n');
  const html = '<!doctype html><html lang="pt-BR"><body style="margin:0;font:15px/1.5 Arial,sans-serif">' +
    '<div style="max-width:520px;margin:auto;padding:24px;background:#18181b;color:#fafafa;border-radius:14px">' +
    '<b>PeleDex</b><h1 style="font-size:23px;line-height:1.25">' + title + '</h1>' +
    '<table role="presentation" width="100%" cellspacing="4" cellpadding="0">' + rows.join('') + '</table>' +
    '<p style="color:#d4d4d8">' + explanation + '</p><a href="' + statusUrl +
    '" style="display:inline-block;padding:10px 16px;background:#fafafa;color:#18181b;border-radius:8px;text-decoration:none;font-weight:bold">Ver status dos serviços</a></div></body></html>';
  const boundary = 'peledex-alternative';
  function part(type, content) {
    const encoded = Buffer.from(content).toString('base64').match(/.{1,76}/g).join('\r\n');
    return ['--' + boundary, 'Content-Type: ' + type + '; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encoded].join('\r\n');
  }
  const subject = Buffer.from(title).toString('base64');
  const input = ['From: PeleDex Status <' + from + '>', 'To: ' + to, 'Subject: [PeleDex] =?UTF-8?B?' + subject + '?=', 'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' + boundary + '"', '', part('text/plain', plain), part('text/html', html), '--' + boundary + '--', ''].join('\r\n');
  const result = transport('curl', ['--silent','--max-time','30','--url','smtps://smtp.gmail.com:465','--user',from + ':' + password.replace(/ /g,''),'--mail-from',from,'--mail-rcpt',to,'--upload-file','-'], { input, stdio: ['pipe','ignore','ignore'] });
  if (result.status !== 0) throw Error('Falha no envio pelo Gmail. Alertas pendentes para a próxima execução.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const events = await readQueue();
  if (events.length) { send(events); await save([]); }
}
