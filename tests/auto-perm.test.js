'use strict';
// Слова директора 2026-11-07: «Дай разрешение всем менять шаблон сообщения клиентам. И сообщение клиентам пусть они сами
// меняют». Право «Настраивать авто-сообщения» (auto) — у каждой встроенной роли; рабочая база получает его шагом миграции 19.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { load } = require('./load.js');
const kit = require('./server-kit.js');

test('право менять шаблон сообщения клиентам есть у каждой встроенной роли и у каждого сотрудника демо', () => {
  const app = load(), { S, Perms } = app;
  for (const r of S.roles.filter(x => x.builtin)) assert.equal(r.perms.auto, true, `у роли «${r.name}» нет права auto`);
  for (const p of S.people) assert.equal(Perms.can(S, p.id, 'auto'), true, `${p.name} не может менять шаблон`);
});

test('шаблон сообщения: менеджер B2B и кладовщик видят раздел «Сообщения клиентам» без пометки «менять может директор»', () => {
  const app = load();
  for (const role of ['managerB2b', 'warehouse']) {
    app.setMe(app.S.people.find(p => p.role === role).id);
    app.S.view = 'messages'; app.render();
    const html = app.document.getElementById('view').innerHTML;
    assert.ok(!html.includes('менять может директор'), `для роли ${role} правила помечены «менять может директор»`);
    assert.ok(html.includes('data-on="tpl"'), `для роли ${role} поле шаблона недоступно`);
  }
});

test('сервер: база ревизии 18 доводится до текущей (шаг 19) — всем ролям, и своим тоже, ставится право auto', async () => {
  const srv = await kit.start();
  const dir = srv.dir;
  await kit.director(srv);
  await srv.stop(true);
  const file = path.join(dir, 'crm.db');
  const d = new DatabaseSync(file);
  const rows = d.prepare("SELECT id, data FROM docs WHERE key = 'roles'").all();
  assert.ok(rows.length > 1, 'в базе нет ролей');
  for (const r of rows) {
    const role = JSON.parse(r.data);
    if (role.all) continue;
    role.perms.auto = false;
    d.prepare("UPDATE docs SET data = ? WHERE key = 'roles' AND id = ?").run(JSON.stringify(role), r.id);
  }
  d.prepare("UPDATE meta SET v = '18' WHERE k = 'rev'").run();
  d.close();
  const again = await kit.start({ dataDir: dir });
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT v FROM meta WHERE k = 'rev'").get().v, String(load().Store.REV));
      for (const r of db.prepare("SELECT id, data FROM docs WHERE key = 'roles'").all()) assert.equal(JSON.parse(r.data).perms.auto, true, `у роли ${r.id} право auto не поставлено`);
    } finally { db.close(); }
  } finally { await again.stop(); }
});
