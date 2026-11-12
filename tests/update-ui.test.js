'use strict';
// «Обновить ПО»: на нажатие должна быть видимая реакция (слова директора 2026-11-12: «что-то происходит, но этого не видно, будто зависло»).
// Здесь — экран «Настройки → Обновить ПО» в состояниях «проверяю», «устанавливаю», «загружаю фото»: крутилка и подпись вместо немой кнопки.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

function screen(extra = {}) {
  const a = load();
  a.setMe(a.S.people.find(p => p.role === 'director').id);
  Object.assign(a.up, { info: { current: null, supervised: true, git: false, repo: 'MezentsevPavel/CRM', branch: 'master' }, ph: { total: 5, matched: 5, withPhoto: 0, available: 5 } }, extra);
  return a;
}

test('экран обновления: пока идёт проверка, установка или загрузка фото, на кнопке крутилка и подпись, кнопка недоступна', () => {
  const idle = screen().vUpdate();
  assert.doesNotMatch(idle, /class="spin"/, 'в покое крутилки быть не должно');
  assert.match(idle, /Проверить обновления/);

  const check = screen({ busy: true, check: null }).vUpdate();
  assert.match(check, /class="spin"[^>]*><\/span>Проверяю…/);
  assert.match(check, /data-act="upd-check" disabled/);

  const install = screen({ busy: true, check: { latest: { sha: 'a'.repeat(40), title: 'новая', at: null }, news: [], upToDate: false, current: null } }).vUpdate();
  assert.match(install, /class="spin"[^>]*><\/span>Устанавливаю…/);
  assert.match(install, /data-act="upd-apply" disabled/);

  const photos = screen({ phBusy: true }).vUpdate();
  assert.match(photos, /class="spin"[^>]*><\/span>Загружаю…/);
  assert.match(photos, /data-act="photos-bundled" disabled/);
});

test('экран ожидания перезапуска и секунды: есть в странице; прошедшее время считается от начала', () => {
  const a = screen();
  assert.equal(a.upSecs(Date.now() - 12400), 12);
  assert.equal(a.upSecs(Date.now() + 5000), 0, 'время не уходит в минус');
  assert.equal(typeof a.upOverlay, 'function');
  assert.equal(typeof a.upWaitRestart, 'function');
});
