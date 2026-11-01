'use strict';
// Файлы у задачи и поставки: ядро Attach (44-attach.js), вид 71-attach.js, общий предел Store.FILE_MAX и сохранение
// (Store.dump выкидывает файлы задач и поставок так же, как файлы заявок на отправку).
// Чтение файла с диска подменено FakeReader: он сразу отдаёт data-URL, записанный в поддельный файл.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const plain = x => JSON.parse(JSON.stringify(x));
const NOW = new Date(2026, 10, 1, 12, 0);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const PDF = 'data:application/pdf;base64,JVBERi0=';

class FakeReader { readAsDataURL(f) { this.result = f.dataUrl; if (f.broken) this.onerror(); else this.onload(); } }
const file = (name, type, size, dataUrl, more = {}) => ({ name, type, size, dataUrl, ...more });
const withReader = () => load({ globals: { FileReader: FakeReader } });
const toasts = app => { const list = []; app.document.getElementById('toasts').appendChild = el => list.push(el.innerHTML || ''); return list; };
const change = (app, dataset, files) => {
  const target = { dataset, files, value: 'C:\\fakepath\\x', tagName: 'INPUT' };
  app.document.dispatchEvent({ type: 'change', target });
  return target;
};
const drawer = app => app.document.getElementById('drawer-root').innerHTML;
const modal = app => app.document.getElementById('modal-root').innerHTML;

// ——— ядро ———
test('Attach.clean: без названия — выкинут, свой id остаётся, новые id не повторяются; by и at — только если были', () => {
  const { Attach } = load();
  const out = Attach.clean([
    { name: '  счёт.pdf ', type: 'application/pdf', size: 10, data: PDF },
    { name: '' }, null,
    { id: 'fl1', name: 'схема.png', size: '5', data: '', unsaved: true },
    { name: 'акт.pdf', data: PDF, by: 'p1', at: NOW },
  ], [{ id: 'fl2' }]);
  assert.equal(out.length, 3);
  assert.equal(out[0].name, 'счёт.pdf');
  assert.equal(new Set([...out.map(f => f.id), 'fl2']).size, 4, 'id повторился');
  assert.deepEqual(plain(out[1]), { id: 'fl1', name: 'схема.png', type: '', size: 5, data: null, unsaved: true });
  assert.ok(!('by' in out[0]) && !('at' in out[0]), 'у файла без автора появились by и at');
  assert.equal(out[2].by, 'p1');
  assert.equal(out[2].at, NOW);
});

test('Attach.tooBig: больше 2 МБ — отказ с названием файла; сохранённый и файл без данных не проверяются; ровно 2 МБ — можно', () => {
  const { Attach, Store } = load();
  const big = { name: 'видео.mp4', size: Store.FILE_MAX + 1, data: PDF };
  assert.match(Attach.tooBig([big], []), /«видео\.mp4».*больше предела 2 МБ/);
  assert.equal(Attach.tooBig([{ ...big, id: 'fl1' }], [{ id: 'fl1' }]), null, 'уже сохранённый файл проверили заново');
  assert.equal(Attach.tooBig([{ ...big, data: null }], []), null, 'файл без данных места не занимает');
  assert.equal(Attach.tooBig([{ name: 'ровно.pdf', size: Store.FILE_MAX, data: PDF }], []), null);
});

test('Attach.add и remove: добавляет с автором и временем; один большой — не добавлен ни один; чужой файл — только с правом', () => {
  const { Attach, Store } = load();
  const rec = { id: 't1' };
  assert.equal(Attach.add(rec, [], 'p2', NOW).ok, false);
  let r = Attach.add(rec, [{ name: 'a.pdf', type: 'application/pdf', size: 10, data: PDF }, { name: 'b.png', type: 'image/png', size: 20, data: PNG }], 'p2', NOW);
  assert.equal(r.ok, true);
  assert.equal(rec.files.length, 2);
  assert.ok(rec.files.every(f => f.by === 'p2' && f.at === NOW));
  assert.notEqual(rec.files[0].id, rec.files[1].id);
  r = Attach.add(rec, [{ name: 'c.pdf', size: 10, data: PDF }, { name: 'd.mp4', size: Store.FILE_MAX + 1, data: PDF }], 'p2', NOW);
  assert.equal(r.ok, false);
  assert.match(r.reason, /d\.mp4/);
  assert.equal(rec.files.length, 2, 'при отказе часть файлов всё же добавилась');
  const [a, b] = rec.files;
  assert.equal(Attach.remove(rec, a.id, 'p3', false).ok, false, 'чужой файл убран без права');
  assert.equal(Attach.remove(rec, a.id, 'p2', false).ok, true, 'свой файл не убрать');
  assert.equal(Attach.remove(rec, b.id, 'p3', true).ok, true, 'с правом чужой файл не убрать');
  assert.equal(rec.files.length, 0);
  assert.equal(Attach.remove(rec, 'нет', 'p2', true).ok, false);
  assert.equal(Attach.canRemove({ id: 'x' }, undefined, false), false, 'файл без автора убран без права');
});

// ——— сохранение ———
test('Store.dump: не влезло — сначала выкинут более новый файл; картинка поставки — файл, а не фото приёмки; состояние не тронуто', () => {
  const app = load(), { S, Store } = app;
  const old = 'data:application/pdf;base64,' + 'A'.repeat(200000), fresh = 'data:image/png;base64,' + 'B'.repeat(200000);
  const t = S.tasks[0], s = S.shipments[0];
  t.files = [{ id: 'fl1', name: 'старый.pdf', type: 'application/pdf', size: 150000, data: old, by: 'p1', at: new Date(2026, 9, 1) }];
  s.files = [{ id: 'fl1', name: 'новый.png', type: 'image/png', size: 150000, data: fresh, by: 'p1', at: new Date(2026, 10, 1) }];
  const full = Store.dump(S);
  assert.equal(full.droppedFiles, 0);
  assert.equal(Store.load(full.text).tasks.find(x => x.id === t.id).files[0].data, old, 'места хватает — файл задачи не сохранился');
  const tight = Store.dump(S, full.text.length - 100000);
  assert.equal(tight.droppedFiles, 1);
  assert.equal(tight.droppedPhotos, 0, 'картинку поставки посчитали фото приёмки');
  const back = Store.load(tight.text);
  const bs = back.shipments.find(x => x.id === s.id).files[0], bt = back.tasks.find(x => x.id === t.id).files[0];
  assert.equal(bs.data, null);
  assert.equal(bs.unsaved, true, 'выкинутый файл не помечен');
  assert.equal(bt.data, old, 'старый файл задачи выкинут, хотя хватало выкинуть новый');
  assert.equal(s.files[0].data, fresh, 'dump испортил само состояние');
});

// ——— форма новой задачи ———
test('форма «Новая задача»: поле «Файлы», большой файл — отказ, задача сохраняется с файлами; без файлов — без поля files', () => {
  const app = withReader(), { S, Store } = app;
  app.setMe('p1');
  const said = toasts(app);
  app.openModal('task');
  assert.ok(modal(app).includes('data-on="att-draft"') && modal(app).includes('Прикрепить файлы'), 'в форме задачи нет поля «Файлы»');
  const input = change(app, { on: 'att-draft' }, [file('схема.png', 'image/png', 1200, PNG), file('видео.mp4', 'video/mp4', Store.FILE_MAX + 1, PDF)]);
  assert.equal(S.ui.attDraft.files.length, 1, 'большой файл встал в черновик');
  assert.ok(said.some(t => t.includes('видео.mp4') && t.includes('больше предела')), said.join(' | '));
  assert.equal(input.value, '', 'поле выбора файлов не очистилось');
  assert.ok(app.byId('att-files').innerHTML.includes('схема.png'), 'выбранный файл не показан в форме');
  // крестик убирает, повторный выбор возвращает
  app.A['att-draft-del']({ dataset: { i: '0' } });
  assert.equal(S.ui.attDraft.files.length, 0);
  change(app, { on: 'att-draft' }, [file('схема.png', 'image/png', 1200, PNG)]);
  const set = (id, v) => { app.byId(id).value = v; };
  set('t-title', 'Задача с файлом'); set('t-to', 'p:p6'); set('t-due', '2026-11-05'); set('t-prio', 'normal'); set('t-deal', ''); set('t-desc', '');
  app.FORMS.task();
  const t = S.tasks.find(x => x.title === 'Задача с файлом');
  assert.equal(t.files.length, 1);
  assert.equal(t.files[0].by, 'p1');
  assert.equal(t.files[0].data, PNG);
  assert.equal(S.ui.attDraft, null, 'черновик пережил закрытие формы');
  app.openModal('task');
  assert.equal(S.ui.attDraft.files.length, 0, 'файлы прошлой задачи попали в новую форму');
  set('t-title', 'Без файла');
  app.FORMS.task();
  assert.ok(!('files' in S.tasks.find(x => x.title === 'Без файла')));
});

// ——— форма новой поставки ———
test('форма «Новая поставка»: поле «Файлы», поставка сохраняется с файлом', () => {
  const app = withReader(), { S } = app;
  app.setMe('p6');
  app.openModal('ship');
  assert.ok(modal(app).includes('data-on="att-draft"'), 'в форме поставки нет поля «Файлы»');
  change(app, { on: 'att-draft' }, [file('инвойс.pdf', 'application/pdf', 3000, PDF)]);
  const set = (id, v) => { app.byId(id).value = v; };
  const pid = S.products[0].id;
  const form = { querySelectorAll: () => [{ querySelector: sel => (sel === 'select' ? { value: pid } : { value: '3' }) }] };
  set('ns-from', 'Поставщик-пример 10'); set('ns-city', 'msk'); set('ns-ent', 'npp'); set('ns-car', 'Отдельная машина');
  set('ns-doc', ''); set('ns-stage', 'ordered'); set('ns-eta', '2026-12-01');
  const n = S.shipments.length;
  app.FORMS.ship(form);
  const s = S.shipments[n];
  assert.ok(s && s.supplier === 'Поставщик-пример 10', 'поставка не создана');
  assert.deepEqual(plain(s.files.map(f => [f.name, f.by, f.data])), [['инвойс.pdf', 'p6', PDF]]);
});

// ——— карточка задачи ———
test('карточка задачи: прикрепить сразу; убрать свой файл; чужой убирает только автор задачи; кому задача не видна — нельзя', () => {
  const app = withReader(), { S } = app;
  const t = S.tasks.find(x => x.to.t === 'p' && x.from !== x.to.id && !(x.files || []).length);
  assert.ok(t, 'в демо нет задачи сотруднику от другого человека');
  const doer = t.to.id, author = t.from;
  const said = toasts(app);
  app.setMe(doer);
  app.openDrawer('task', t.id);
  assert.ok(drawer(app).includes('data-on="att-add"') && drawer(app).includes(`data-kind="task" data-id="${t.id}"`), 'в карточке задачи нечем прикрепить файл');
  change(app, { on: 'att-add', kind: 'task', id: t.id }, [file('акт.pdf', 'application/pdf', 2048, PDF)]);
  assert.equal(t.files.length, 1);
  assert.equal(t.files[0].by, doer);
  assert.ok(said.some(x => x.includes('«акт.pdf» приложен')), said.join(' | '));
  const fid = t.files[0].id;
  assert.ok(drawer(app).includes('акт.pdf') && drawer(app).includes(app.person(doer).name), 'в карточке не видно файла и кто его приложил');
  assert.ok(drawer(app).includes('data-act="att-del"'), 'свой файл нельзя убрать');
  // автор задачи может убрать чужой файл, директор (видит все задачи) — нет
  app.setMe(author);
  app.openDrawer('task', t.id);
  assert.ok(drawer(app).includes('data-act="att-del"'), 'автор задачи не может убрать файл исполнителя');
  const other = S.people.find(p => p.id !== author && p.id !== doer && p.role === 'director');
  if (other) {
    app.setMe(other.id);
    app.openDrawer('task', t.id);
    assert.ok(!drawer(app).includes('data-act="att-del"'), 'чужой файл убирает тот, кто не автор задачи');
    app.A['att-del']({ dataset: { kind: 'task', id: t.id, fid } });
    assert.equal(t.files.length, 1, 'файл убран без права');
  }
  app.setMe(doer);
  app.A['att-del']({ dataset: { kind: 'task', id: t.id, fid } });
  assert.equal(t.files.length, 0, 'свой файл не убрался');
  // тот, кому задача не видна, прикрепить не может
  const stranger = S.people.find(p => p.id !== author && p.id !== doer && !app.Perms.can(S, p.id, 'tasksAll') && p.dept !== (app.person(doer) || {}).dept);
  app.setMe(stranger.id);
  change(app, { on: 'att-add', kind: 'task', id: t.id }, [file('чужое.pdf', 'application/pdf', 10, PDF)]);
  assert.equal(t.files.length, 0, 'файл прикрепил тот, кому задача не видна');
});

// ——— карточка поставки ———
test('карточка поставки: блок «Файлы»; логист убирает любой файл, кладовщик — только свой; без права на склад и перевозки — нельзя', () => {
  const app = withReader(), { S } = app;
  const s = S.shipments.find(x => x.dir === 'in' && !(x.files || []).length);
  app.setMe('p5');                                    // кладовщик: право «остатки»
  app.openDrawer('ship', s.id);
  assert.ok(drawer(app).includes('<h4 class="sh">Файлы</h4>') && drawer(app).includes(`data-kind="ship" data-id="${s.id}"`), 'в карточке поставки нет блока «Файлы»');
  change(app, { on: 'att-add', kind: 'ship', id: s.id }, [file('накладная.png', 'image/png', 900, PNG)]);
  app.setMe('p6');                                    // логист
  change(app, { on: 'att-add', kind: 'ship', id: s.id }, [file('инвойс.pdf', 'application/pdf', 3000, PDF)]);
  assert.deepEqual(plain(s.files.map(f => f.by)), ['p5', 'p6']);
  // картинка открывается крупно
  app.openDrawer('ship', s.id);
  const key = `ship|${s.id}|${s.files[0].id}`;
  assert.ok(drawer(app).includes(`data-act="att-file" data-key="${key}"`), 'картинку нельзя открыть крупно');
  assert.ok(app.MODALS.attFile(key).includes('class="dsp-big"'));
  // кладовщик чужой файл не убирает, логист — убирает
  app.setMe('p5');
  app.A['att-del']({ dataset: { kind: 'ship', id: s.id, fid: s.files[1].id } });
  assert.equal(s.files.length, 2, 'кладовщик убрал файл логиста');
  app.setMe('p6');
  app.A['att-del']({ dataset: { kind: 'ship', id: s.id, fid: s.files[0].id } });
  assert.deepEqual(plain(s.files.map(f => f.name)), ['инвойс.pdf']);
  // водитель: ни склада, ни перевозок — карточки нет, файл не прикрепить и не открыть
  const drv = S.people.find(p => p.role === 'driver');
  app.setMe(drv.id);
  change(app, { on: 'att-add', kind: 'ship', id: s.id }, [file('лишнее.pdf', 'application/pdf', 10, PDF)]);
  assert.equal(s.files.length, 1, 'водитель прикрепил файл к поставке');
  assert.ok(app.MODALS.attFile(`ship|${s.id}|${s.files[0].id}`).includes('Файла нет'), 'водитель открыл файл поставки');
});

test('файл, который не поместился в браузер, в карточке помечен, а не пропадает', () => {
  const app = load(), { S } = app;
  const s = S.shipments.find(x => x.dir === 'in');
  s.files = [{ id: 'fl1', name: 'большой.pdf', type: 'application/pdf', size: 1500000, data: null, unsaved: true, by: 'p6', at: NOW }];
  app.setMe('p6');
  app.openDrawer('ship', s.id);
  assert.ok(drawer(app).includes('большой.pdf') && drawer(app).includes('не сохранено — мало места в браузере'));
});
