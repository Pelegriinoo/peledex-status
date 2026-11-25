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
  const lines = events.map(({ service, state, at }) => {
    const time = new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return names[service] + (state === 'up' ? ' voltou a responder' : ' ficou indisponível') + ' em ' + time + ' (Brasília).';
  });
  const subject = events.every(e => e.state === 'down') ? 'Queda' : events.every(e => e.state === 'up') ? 'Recuperacao' : 'Mudancas de status';
  const input = ['From: PeleDex <' + from + '>', 'To: ' + to, 'Subject: [PeleDex] ' + subject, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(lines.join('\n')).toString('base64').match(/.{1,76}/g).join('\r\n'), ''].join('\r\n');
  const result = transport('curl', ['--silent','--max-time','30','--url','smtps://smtp.gmail.com:465','--user',from + ':' + password.replace(/ /g,''),'--mail-from',from,'--mail-rcpt',to,'--upload-file','-'], { input, stdio: ['pipe','ignore','ignore'] });
  if (result.status !== 0) throw Error('Falha no envio pelo Gmail. Alertas pendentes para a próxima execução.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const events = await readQueue();
  if (events.length) { send(events); await save([]); }
}
