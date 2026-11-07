'use strict';
// Слова директора 2026-11-08: «Ещё нужна возможность вручную заменить, добавить, удалить фото» товара; «Сделай пока просто функцию
// работы с фото». Фото хранятся у нас (в демо — в браузере, на сервере — файлом), а не ссылкой на чужой сайт.
// Здесь демо и ядро: Attach (фото = файлы в product.photos, первое — главное), карточка товара, миниатюра в списке, просмотр крупно,
// уменьшение перед загрузкой, сохранение при нехватке места. Сервер — tests/server-photos.test.js.
// Данные искусственные: «картинки» — несколько байт с настоящими началами PNG и JPEG, их никто не раскодирует.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const NOW = new Date(2026, 10, 8, 12, 0, 0);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const url = (type, bytes, pad = 0) => `data:${type};base64,${Buffer.concat([bytes, Buffer.alloc(pad, 1)]).toString('base64')}`;
const PNG = url('image/png', png), JPG = url('image/jpeg', jpg);
const photo = (name, type = 'image/png', data = PNG) => ({ name, type, size: 40, data });

class FakeReader { readAsDataURL(f) { this.result = f.dataUrl; this.onload(); } }
const file = (name, type, dataUrl = PNG, size = 40) => ({ name, type, size, dataUrl });
const world = () => {
  const a = load({ now: NOW, globals: { FileReader: FakeReader } });
  a.setMe('p1');
  const p = a.Catalog.add(a.S, { name: 'Тест Инвертор с фото', cat: 'Тест' }).product;
  return { a, p };
};
const toasts = a => { const list = []; a.document.getElementById('toasts').appendChild = el => list.push(el.innerHTML || ''); return list; };
const change = (a, on, dataset, files) => {
  const target = { dataset: { on, ...dataset }, files, value: 'C:\\fakepath\\x', tagName: 'INPUT' };
  a.document.dispatchEvent({ type: 'change', target });
  return target;
};
const names = p => [...(p.photos || []).map(f => f.name)];
const drawer = a => a.document.getElementById('drawer-root').innerHTML;
const modal = a => a.document.getElementById('modal-root').innerHTML;

// ——— ядро ———
test('Attach.addPhotos: несколько фото сразу, у каждого свой номер, автор и время; порядок — как выбрано; первое — главное', () => {
  const { a, p } = world();
  const r = a.Attach.addPhotos(p, [photo('один.png'), photo('два.jpg', 'image/jpeg', JPG), photo('три.png')], 'p1', NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(names(p), ['один.png', 'два.jpg', 'три.png']);
  assert.equal(new Set(p.photos.map(f => f.id)).size, 3, 'номера фото повторились');
  assert.ok(p.photos.every(f => f.by === 'p1' && f.at === NOW));
  assert.equal(p.files, undefined, 'фото попали в files — это поле вложений, не фото');
});

test('Attach.replacePhoto: новое фото встаёт на место старого (главное остаётся главным), старое пропадает; не вышло — список как был', () => {
  const { a, p } = world();
  a.Attach.addPhotos(p, [photo('a.png'), photo('b.png'), photo('c.png')], 'p1', NOW);
  const [a1, b1, c1] = p.photos.map(f => f.id);
  let r = a.Attach.replacePhoto(p, b1, photo('b2.jpg', 'image/jpeg', JPG), 'p2', NOW);
  assert.equal(r.ok, true);
  assert.deepEqual(names(p), ['a.png', 'b2.jpg', 'c.png'], 'место в списке изменилось');
  assert.equal(r.old.id, b1);
  assert.ok(!p.photos.some(f => f.id === b1), 'старое фото осталось в списке');
  assert.equal(p.photos[1].by, 'p2', 'автор нового — тот, кто заменил');
  r = a.Attach.replacePhoto(p, a1, photo('a2.png'), 'p1', NOW);
  assert.deepEqual(names(p), ['a2.png', 'b2.jpg', 'c.png'], 'главное фото перестало быть первым');
  // отказ: не фото, нет такого, нет данных — список прежний
  const before = plain(p.photos);
  assert.equal(a.Attach.replacePhoto(p, c1, { name: 'схема.svg', type: 'image/svg+xml', size: 5, data: 'data:image/svg+xml;base64,PHN2Zy8+' }, 'p1', NOW).ok, false);
  assert.equal(a.Attach.replacePhoto(p, 'нет', photo('x.png'), 'p1', NOW).ok, false);
  assert.equal(a.Attach.replacePhoto(p, c1, { name: 'пусто.png', type: 'image/png' }, 'p1', NOW).ok, false);
  assert.deepEqual(plain(p.photos), before, 'после отказа список изменился');
});

test('Attach.removePhoto и mainPhoto: удаление; «Сделать главным» ставит фото первым, остальные в прежнем порядке; порядок после всех действий', () => {
  const { a, p } = world();
  a.Attach.addPhotos(p, [photo('1.png'), photo('2.png'), photo('3.png'), photo('4.png')], 'p1', NOW);
  const id = n => p.photos.find(f => f.name === n).id;
  assert.equal(a.Attach.mainPhoto(p, id('3.png')).ok, true);
  assert.deepEqual(names(p), ['3.png', '1.png', '2.png', '4.png']);
  assert.equal(a.Attach.mainPhoto(p, id('3.png')).ok, true, 'уже главное — без изменений');
  assert.deepEqual(names(p), ['3.png', '1.png', '2.png', '4.png']);
  const r = a.Attach.removePhoto(p, id('1.png'));
  assert.equal(r.ok, true);
  assert.equal(r.file.name, '1.png');
  assert.deepEqual(names(p), ['3.png', '2.png', '4.png']);
  a.Attach.replacePhoto(p, id('2.png'), photo('2b.png'), 'p1', NOW);
  a.Attach.addPhotos(p, [photo('5.png')], 'p1', NOW);
  a.Attach.mainPhoto(p, id('5.png'));
  a.Attach.removePhoto(p, id('3.png'));
  assert.deepEqual(names(p), ['5.png', '2b.png', '4.png'], 'порядок после всех действий');
  assert.equal(a.Attach.removePhoto(p, 'нет').ok, false);
  assert.equal(a.Attach.mainPhoto(p, 'нет').ok, false);
});

test('Attach: не фото — отказ с понятным текстом и ничего не добавлено (SVG, PDF, текст, без типа, тип и данные не сходятся); больше 20 — отказ', () => {
  const { a, p } = world();
  const bad = [
    { name: 'схема.svg', type: 'image/svg+xml', size: 5, data: 'data:image/svg+xml;base64,PHN2Zy8+' },
    { name: 'счёт.pdf', type: 'application/pdf', size: 5, data: 'data:application/pdf;base64,JVBERi0=' },
    { name: 'заметка.txt', type: 'text/plain', size: 5, data: 'data:text/plain;base64,YQ==' },
    { name: 'без-типа.png', type: '', size: 5, data: 'data:application/octet-stream;base64,YQ==' },
    { name: 'подмена.png', type: 'image/png', size: 5, data: 'data:image/svg+xml;base64,PHN2Zy8+' },
  ];
  for (const f of bad) {
    const r = a.Attach.addPhotos(p, [photo('хорошее.png'), f], 'p1', NOW);
    assert.equal(r.ok, false, f.name);
    assert.match(r.reason, new RegExp(`«${f.name}» не принят: можно только фото: JPEG, PNG, WebP или GIF`), f.name);
  }
  assert.equal(p.photos === undefined || p.photos.length === 0, true, 'после отказа что-то добавилось');
  for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) assert.equal(a.Attach.photoProblem({ name: 'x', type: t, data: `data:${t};base64,QQ==` }), null, t);
  assert.equal(a.Attach.photoProblem({ name: 'х', type: 'IMAGE/PNG' }), null, 'регистр типа не важен');
  const many = Array.from({ length: a.Attach.PHOTO_MAX }, (_, i) => photo(`${i}.png`));
  assert.equal(a.Attach.addPhotos(p, many, 'p1', NOW).ok, true);
  const over = a.Attach.addPhotos(p, [photo('лишнее.png')], 'p1', NOW);
  assert.equal(over.ok, false);
  assert.match(over.reason, /Не больше 20/);
  assert.equal(p.photos.length, 20);
});

test('Attach: файлы задач не задеты — поле files, права убрать и предел по-прежнему как были', () => {
  const { a } = world();
  const rec = {};
  assert.equal(a.Attach.add(rec, [{ name: 'схема.svg', type: 'image/svg+xml', size: 5, data: 'data:image/svg+xml;base64,PHN2Zy8+' }], 'p1', NOW).ok, true, 'вложению тип не важен');
  assert.equal(rec.files.length, 1);
  assert.equal(rec.photos, undefined);
  assert.equal(a.Attach.remove(rec, rec.files[0].id, 'p9', false).ok, false, 'чужой файл убран без права');
});

test('Catalog.merge и сохранение: фото товара снимка каталога не затираются; после dump и load на месте', () => {
  const { a } = world();
  const snap = a.S.products.find(p => p.src === 'catalog');
  a.Attach.addPhotos(snap, [photo('снимок.png'), photo('снимок2.jpg', 'image/jpeg', JPG)], 'p1', NOW);
  const mine = a.Catalog.add(a.S, { name: 'Тест свой товар', cat: 'Тест' }).product;
  a.Attach.addPhotos(mine, [photo('свой.png')], 'p1', NOW);
  a.Catalog.merge(a.S, a.CATALOG);
  assert.deepEqual(names(snap), ['снимок.png', 'снимок2.jpg'], 'merge стёр фото товара снимка');
  assert.deepEqual(names(mine), ['свой.png']);
  const dumped = a.Store.dump(a.S);
  const back = a.Store.load(dumped.text);
  assert.deepEqual(names(back.products.find(p => p.id === snap.id)), ['снимок.png', 'снимок2.jpg'], 'фото товара снимка не пережило сохранение');
  assert.deepEqual(names(back.products.find(p => p.id === mine.id)), ['свой.png']);
  assert.equal(back.products.find(p => p.id === snap.id).photos[0].data, PNG);
});

test('Store.dump: мало места — данные фото товара выкидываются как у вложений (unsaved), прочее остаётся; в карточке «фото не поместилось в браузер»', () => {
  const { a } = world();
  const snap = a.S.products.find(p => p.src === 'catalog');
  const big = url('image/png', png, 90000);
  a.Attach.addPhotos(snap, [photo('крупное.png', 'image/png', big)], 'p1', NOW);
  const mine = a.Catalog.add(a.S, { name: 'Тест своё', cat: 'Тест' }).product;
  a.Attach.addPhotos(mine, [photo('своё-крупное.png', 'image/png', big)], 'p1', NOW);
  const full = a.Store.dump(a.S);
  assert.equal(full.droppedFiles, 0);
  const tight = a.Store.dump(a.S, full.text.length - 100000);
  assert.ok(tight.droppedFiles >= 1, 'ничего не выкинуто');
  assert.equal(tight.fits, true);
  const back = a.Store.load(tight.text);
  const lost = [back.products.find(p => p.id === snap.id), back.products.find(p => p.id === mine.id)].flatMap(p => p.photos).filter(f => f.unsaved);
  assert.equal(lost.length, tight.droppedFiles);
  assert.ok(lost.every(f => f.data === null), 'у выкинутого остались данные');
  assert.equal(a.S.products.find(p => p.id === mine.id).photos[0].data, big, 'сохранение тронуло живое состояние');
  // карточка не ломается: вместо картинки — пометка
  mine.photos[0].data = null; mine.photos[0].unsaved = true;
  const html = a.dProduct(mine).body;
  assert.match(html, /фото не поместилось в браузер/);
  assert.match(html, /data-act="photo-del"/, 'потерянное фото нельзя удалить');
  assert.doesNotMatch(html, /data-act="photo-view"/, 'потерянное фото открывается крупно');
  assert.equal(a.photoThumb(mine), '', 'в списке — миниатюра без картинки');
  // потеряно главное, а второе целое: в списке всё равно главное — то есть ничего, а не второе под видом главного
  a.Attach.addPhotos(mine, [photo('второе.png')], 'p1', NOW);
  assert.equal(a.photoThumb(mine), '', 'вместо потерянного главного нарисовано второе фото');
});

// ——— карточка товара ———
test('карточка: без фото — рамка «Фото нет» и «Добавить фото»; с фото — главное крупно, ряд маленьких, у каждого три кнопки; у главного нет «Сделать главным»', () => {
  const { a, p } = world();
  let html = a.dProduct(p).body;
  assert.match(html, /<h4 class="sh">Фото<\/h4><div class="pp-empty">.*<b>Фото нет<\/b>/s);
  assert.match(html, /Добавить фото<input id="pp-add-in"[^>]*type="file"[^>]*multiple[^>]*accept="image\/jpeg,image\/png,image\/webp,image\/gif"/);
  assert.match(html, /capture="environment"/, 'нет кнопки камеры для телефона');
  assert.ok(html.indexOf('Фото нет') < html.indexOf('Карточка каталога'), 'блок «Фото» ниже карточки каталога');
  assert.doesNotMatch(html, /data-act="photo-(del|main|view)"/);
  a.Attach.addPhotos(p, [photo('главное.png'), photo('второе.jpg', 'image/jpeg', JPG), photo('третье.png')], 'p1', NOW);
  html = a.dProduct(p).body;
  const block = html.slice(html.indexOf('<div class="pp">'), html.indexOf('Карточка каталога'));
  assert.match(block, /Фото · 3/);
  assert.equal((block.match(/<figure class="pp-it/g) || []).length, 3);
  assert.equal((block.match(/<figure class="pp-it big"/g) || []).length, 1, 'крупное — одно');
  assert.ok(block.indexOf('pp-it big') < block.indexOf('class="pp-row"'), 'главное не раньше ряда');
  assert.equal((block.match(/data-act="photo-del"/g) || []).length, 3, '«Удалить» у каждого');
  assert.equal((block.match(/Заменить<input/g) || []).length, 3, '«Заменить» у каждого');
  assert.equal((block.match(/data-act="photo-main"/g) || []).length, 2, '«Сделать главным» — у всех, кроме главного');
  assert.equal((block.match(/data-act="photo-view"/g) || []).length, 3, 'нажатие на фото — просмотр');
  assert.equal((block.match(/<img /g) || []).length, 3);
  assert.ok([...block.matchAll(/<img [^>]*>/g)].every(m => /alt="[^"]+"/.test(m[0]) && /loading="lazy"/.test(m[0])), 'у фото нет alt или loading="lazy"');
  assert.match(block, /<span class="pill ok sm pp-main">Главное<\/span>/);
});

test('карточка: без права «Добавлять товары» (catalog) кнопок нет, фото только смотреть; действия отказывают', () => {
  const { a, p } = world();
  a.Attach.addPhotos(p, [photo('a.png'), photo('b.png')], 'p1', NOW);
  a.setMe('p3');
  assert.match(a.dProduct(p).body, /data-act="photo-del"/, 'у менеджера право есть');
  a.S.roles.find(r => r.id === 'managerB2b').perms.catalog = false;
  const html = a.dProduct(p).body;
  assert.match(html, /data-act="photo-view"/, 'смотреть можно');
  assert.doesNotMatch(html, /photo-del|photo-main|Заменить|Добавить фото|pp-add-in/);
  const msgs = toasts(a);
  a.A['photo-del']({ dataset: { pid: p.id, fid: p.photos[0].id } });
  assert.equal(modal(a), '', 'окно удаления открылось без права');
  a.A['photo-main']({ dataset: { pid: p.id, fid: p.photos[1].id } });
  assert.deepEqual(names(p), ['a.png', 'b.png'], 'порядок изменился без права');
  change(a, 'photo-add', { pid: p.id }, [file('c.png', 'image/png')]);
  assert.deepEqual(names(p), ['a.png', 'b.png'], 'добавилось без права');
  assert.ok(msgs.length >= 1 && msgs.every(m => /нет права менять фото/.test(m)), msgs.join('|'));
  // пустая карточка без права — рамка без кнопки
  const q = a.Catalog.add(a.S, { name: 'Тест без фото', cat: 'Тест' }).product;
  assert.match(a.dProduct(q).body, /Фото нет/);
  assert.doesNotMatch(a.dProduct(q).body, /Добавить фото/);
});

test('список «Товары и остатки»: миниатюра 40 px с loading="lazy" у товара с фото; без фото — серый квадрат со значком', () => {
  const { a, p } = world();
  const bare = a.Catalog.add(a.S, { name: 'Тест без фото в списке', cat: 'Тест' }).product;
  a.Attach.addPhotos(p, [photo('главное.png'), photo('второе.png')], 'p1', NOW);
  const withRow = a.stockRow(p, true), bareRow = a.stockRow(bare, true);
  assert.match(withRow, /<div class="pcell"><img class="pthumb" src="data:image\/png;base64,[^"]+" alt="Фото: Тест Инвертор с фото" width="40" height="40" loading="lazy" decoding="async">/);
  assert.equal((withRow.match(/<img /g) || []).length, 1, 'в строке одна миниатюра — главное фото');
  // без фото слева тот же квадрат — серая рамка со значком, без картинки (слово директора: список должен быть ровным)
  assert.match(bareRow, /<div class="pcell"><span class="pthumb pph" aria-hidden="true"><svg/, 'у товара без фото нет серого квадрата');
  assert.doesNotMatch(bareRow, /<img/, 'у товара без фото нарисована картинка');
  // порядок: главным стало второе — в списке именно оно
  a.Attach.mainPhoto(p, p.photos[1].id);
  const png2 = url('image/png', png, 3);
  p.photos[0].data = png2;
  assert.ok(a.stockRow(p, true).includes(png2.slice(0, 60)) && a.stockRow(p, true).includes(png2), 'в списке не главное фото');
  // строка списка в целом: название по-прежнему рядом
  assert.match(withRow, /<div class="pname"><span>Тест Инвертор с фото<\/span>/);
});

test('просмотр крупно: слой поверх карточки; закрывается Esc и нажатием на картинку; стрелки к соседнему фото; чужого фото нет', () => {
  const { a, p } = world();
  a.Attach.addPhotos(p, [photo('одно.png'), photo('второе.jpg', 'image/jpeg', JPG)], 'p1', NOW);
  a.render();
  a.A['open-product']({ dataset: { pid: p.id } });
  a.A['photo-view']({ dataset: { pid: p.id, fid: p.photos[0].id } });
  let m = modal(a);
  assert.match(m, /class="dsp-big" src="data:image\/png;base64,[^"]+" alt="Фото 1 из 2: Тест Инвертор с фото"/);
  assert.match(m, /data-act="close-modal" aria-label="Закрыть просмотр"><img/, 'картинка не закрывает окно');
  assert.match(m, /1 из 2 · одно\.png/);
  assert.match(m, new RegExp(`data-act="photo-view" data-pid="${p.id}" data-fid="${p.photos[1].id}" aria-label="Следующее фото"`));
  assert.doesNotMatch(m, /Предыдущее фото/, 'у первого нет «назад»');
  assert.ok(drawer(a).includes('Тест Инвертор с фото'), 'карточка под слоем пропала');
  a.document.dispatchEvent({ type: 'keydown', key: 'Escape', target: {} });
  assert.equal(modal(a), '', 'Esc не закрыл просмотр');
  assert.ok(drawer(a).includes('pp-it'), 'Esc закрыл и карточку');
  a.A['photo-view']({ dataset: { pid: p.id, fid: 'нет-такого' } });
  assert.equal(modal(a), '', 'открылось несуществующее фото');
  a.A['photo-view']({ dataset: { pid: p.id, fid: p.photos[1].id } });
  a.A['close-modal']();
  assert.equal(modal(a), '');
});

test('удаление: сперва подтверждение (окно с фото), «Отмена» ничего не трогает, «Удалить» — одно сохранение; «Сделать главным» и «Заменить» — тоже по одному', async () => {
  const { a, p } = world();
  a.Attach.addPhotos(p, [photo('a.png'), photo('b.png'), photo('c.png')], 'p1', NOW);
  const saves = [];
  Object.defineProperty(a.storage, a.Store.KEY, { set: v => saves.push(v), get: () => saves[saves.length - 1], configurable: true, enumerable: true });
  const fid = n => p.photos.find(f => f.name === n).id;
  a.A['photo-del']({ dataset: { pid: p.id, fid: fid('b.png') } });
  assert.match(modal(a), /<form data-form="photo-del"/);
  assert.match(modal(a), /Удалить фото\?/);
  assert.match(modal(a), /Фото «b\.png» пропадёт из карточки «Тест Инвертор с фото»/);
  assert.deepEqual(names(p), ['a.png', 'b.png', 'c.png'], 'удалилось до подтверждения');
  assert.equal(saves.length, 0);
  a.A['close-modal']();
  assert.deepEqual(names(p), ['a.png', 'b.png', 'c.png']);
  a.A['photo-del']({ dataset: { pid: p.id, fid: fid('b.png') } });
  a.FORMS['photo-del']({ dataset: { key: p.id + '|' + fid('b.png') } });
  assert.deepEqual(names(p), ['a.png', 'c.png']);
  assert.equal(saves.length, 1, 'одно действие — одно сохранение');
  assert.equal(modal(a), '');
  a.A['photo-main']({ dataset: { pid: p.id, fid: fid('c.png') } });
  assert.deepEqual(names(p), ['c.png', 'a.png']);
  assert.equal(saves.length, 2, '«Сделать главным» — одно сохранение');
  change(a, 'photo-repl', { pid: p.id, fid: fid('a.png') }, [file('новое.jpg', 'image/jpeg', JPG)]);
  await a.photoIdle();
  assert.deepEqual(names(p), ['c.png', 'новое.jpg'], 'замена не на том же месте');
  assert.equal(saves.length, 3, '«Заменить» — одно сохранение');
  assert.match(drawer(a) || '', /^$|pp-it/);
});

test('добавление: несколько файлов сразу — один render и одно сохранение, порядок как выбран; не фото среди них — отказ с текстом, остальные добавлены', async () => {
  const { a, p } = world();
  const saves = [], msgs = toasts(a);
  Object.defineProperty(a.storage, a.Store.KEY, { set: v => saves.push(v), get: () => saves[saves.length - 1], configurable: true, enumerable: true });
  const input = change(a, 'photo-add', { pid: p.id }, [file('раз.png', 'image/png'), file('два.jpg', 'image/jpeg', JPG), file('три.png', 'image/png')]);
  assert.equal(input.value, '', 'поле выбора не очищено — тот же файл не выбрать снова');
  await a.photoIdle();
  assert.deepEqual(names(p), ['раз.png', 'два.jpg', 'три.png']);
  assert.equal(saves.length, 1, 'три файла — три сохранения');
  await new Promise(r => setTimeout(r, 550));   // отложенное сохранение оболочки (400 мс после выбора файла) не должно добавить второе
  assert.equal(saves.length, 1, 'после выбора файла сохранение сработало ещё раз');
  assert.ok(msgs.some(m => /Добавлено фото: 3/.test(m)), msgs.join('|'));
  change(a, 'photo-add', { pid: p.id }, [file('схема.svg', 'image/svg+xml', 'data:image/svg+xml;base64,PHN2Zy8+'), file('четыре.png', 'image/png')]);
  await a.photoIdle();
  assert.deepEqual(names(p), ['раз.png', 'два.jpg', 'три.png', 'четыре.png']);
  assert.ok(msgs.some(m => /«схема\.svg» не принят: можно только фото: JPEG, PNG, WebP или GIF/.test(m)), msgs.join('|'));
  assert.equal(saves.length, 2);
  // файл больше предела браузера — отказ, остальное добавляется
  change(a, 'photo-add', { pid: p.id }, [file('огромное.png', 'image/png', PNG, a.Store.FILE_MAX + 1)]);
  await a.photoIdle();
  assert.equal(p.photos.length, 4);
  assert.ok(msgs.some(m => /«огромное\.png».*больше предела 2 МБ/.test(m)), msgs.join('|'));
});

test('экран: названия и адреса проходят через esc; чужой адрес картинки в src не попадает', () => {
  const { a, p } = world();
  p.photos = [
    { id: 'fl1', name: '"><img src=x onerror=alert(1)>.png', type: 'image/png', size: 5, data: PNG },
    { id: 'fl2', name: 'x.png', type: 'image/png', size: 5, url: 'javascript:alert(1)', data: null },
    { id: 'fl3', name: 'y.png', type: 'image/png', size: 5, url: 'https://example.invalid/x.png', data: null },
    { id: 'fl4', name: 'z.png', type: 'image/png', size: 5, data: 'javascript:alert(1)' },
  ];
  const html = a.dProduct(p).body + a.stockRow(p, true);
  assert.doesNotMatch(html, /<img src=x|onerror=alert\(1\)>|javascript:|example\.invalid/);
  assert.match(html, /&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;\.png/);
  assert.equal(a.photoSrc(p.photos[1]), '');
  assert.equal(a.photoSrc({ url: '/api/files/fl' + 'a'.repeat(24) }), '/api/files/fl' + 'a'.repeat(24));
  assert.equal(a.photoSrc({ url: '/api/files/fl' + 'a'.repeat(24) + '"onerror=1' }), '');
});

// ——— уменьшение перед загрузкой ———
test('photoFit: длинная сторона не больше 1600 px, пропорции сохраняются; меньше — без изменений', () => {
  const { a } = world();
  assert.deepEqual(plain(a.photoFit(4000, 3000)), { k: 0.4, w: 1600, h: 1200 });
  assert.deepEqual(plain(a.photoFit(3000, 4000)), { k: 0.4, w: 1200, h: 1600 }, 'портретное фото');
  assert.equal(a.photoFit(1600, 900).k, 1, 'ровно 1600 — без изменений');
  assert.equal(a.photoFit(800, 600).k, 1);
  assert.equal(a.photoFit(10000, 1).h, 1, 'сторона не нулевая');
});

// Поддельный браузер: decode отдаёт размеры, холст запоминает, что рисовали и в каком типе просили, alpha — есть ли прозрачность
function fakeIO({ w, h, alpha = false, outSize = 1000, broken = false, noCanvas = false }) {
  const log = { drawn: null, asked: null, closed: false, canvas: null };
  return {
    log,
    async decode() { if (broken) throw new Error('не раскодировалось'); return { w, h, src: 'IMG', done: () => { log.closed = true; } }; },
    canvas(cw, ch) {
      if (noCanvas) return null;
      log.canvas = [cw, ch];
      return { draw: src => { log.drawn = src; }, alpha: () => alpha, blob: async (type, q) => { log.asked = [type, q]; return { size: outSize, type }; } };
    },
  };
}
const src = (name, type, size) => ({ name, type, size });

test('photoPrepare: большое JPEG уменьшается до 1600 по длинной стороне и сохраняется JPEG с качеством 0,85; имя и тип нового файла сходятся', async () => {
  const { a } = world();
  const io = fakeIO({ w: 4000, h: 3000, outSize: 400000 });
  const out = await a.photoPrepare(src('IMG_0001.jpeg', 'image/jpeg', 5000000), io);
  assert.deepEqual(io.log.canvas, [1600, 1200]);
  assert.deepEqual(io.log.asked, ['image/jpeg', 0.85]);
  assert.equal(io.log.drawn, 'IMG');
  assert.equal(io.log.closed, true, 'картинка не освобождена');
  assert.equal(out.type, 'image/jpeg');
  assert.equal(out.name, 'IMG_0001.jpg');
  assert.equal(out.size, 400000);
});

test('photoPrepare: PNG с прозрачностью остаётся PNG; PNG без прозрачности становится JPEG; WebP с прозрачностью — PNG', async () => {
  const { a } = world();
  let io = fakeIO({ w: 3200, h: 1600, alpha: true, outSize: 100 });
  let out = await a.photoPrepare(src('логотип.png', 'image/png', 900000), io);
  assert.equal(io.log.asked[0], 'image/png', 'прозрачный PNG превратился в JPEG');
  assert.equal(io.log.asked[1], undefined);
  assert.equal(out.name, 'логотип.png');
  io = fakeIO({ w: 3200, h: 1600, alpha: false, outSize: 100 });
  out = await a.photoPrepare(src('снимок.png', 'image/png', 900000), io);
  assert.deepEqual(io.log.asked, ['image/jpeg', 0.85]);
  assert.equal(out.name, 'снимок.jpg');
  io = fakeIO({ w: 3200, h: 1600, alpha: true, outSize: 100 });
  out = await a.photoPrepare(src('кадр.webp', 'image/webp', 900000), io);
  assert.equal(out.type, 'image/png');
});

test('photoPrepare: как есть — маленькое фото, GIF, ошибка раскодирования, нет холста, нет браузерной части, результат не меньше исходного', async () => {
  const { a } = world();
  const same = async (f, io, why) => assert.equal(await a.photoPrepare(f, io), f, why);
  const f = src('маленькое.jpg', 'image/jpeg', 300000);
  await same(f, fakeIO({ w: 1600, h: 1000 }), 'не больше 1600 уменьшено');
  const io0 = fakeIO({ w: 1600, h: 1000 });
  await a.photoPrepare(f, io0);
  assert.equal(io0.log.closed, true);
  await same(src('анимация.gif', 'image/gif', 9000000), fakeIO({ w: 4000, h: 4000 }), 'GIF превращён в JPEG — анимация потеряна');
  await same(f, fakeIO({ w: 4000, h: 3000, broken: true }), 'ошибка раскодирования сломала загрузку');
  await same(f, fakeIO({ w: 4000, h: 3000, noCanvas: true }), 'нет холста');
  await same(f, null, 'нет браузерной части');
  await same(src('большое.jpg', 'image/jpeg', 100), fakeIO({ w: 4000, h: 3000, outSize: 5000 }), 'результат больше исходного взят вместо него');
  // без подмены: тестовая страница без холста и декодера отдаёт файл как есть
  const g = src('просто.png', 'image/png', 10);
  assert.equal(await a.photoPrepare(g), g);
});

test('наведение на миниатюру: окошко с крупным фото ставится справа от неё, у края окна — слева, всегда целиком в окне', () => {
  const { a } = world();
  const at = (r, vw = 1000, vh = 800, w = 260, h = 200) => JSON.parse(JSON.stringify(a.photoPreviewPos(r, vw, vh, w, h)));
  // места справа хватает: правее миниатюры на 12 px, по центру её высоты
  assert.deepEqual(at({ left: 100, right: 140, top: 300, height: 40 }), { x: 152, y: 220 });
  // у правого края — слева от миниатюры
  assert.deepEqual(at({ left: 900, right: 940, top: 300, height: 40 }), { x: 628, y: 220 });
  // у верхнего и нижнего края — не выходит за окно
  assert.equal(at({ left: 100, right: 140, top: 2, height: 40 }).y, 8);
  assert.equal(at({ left: 100, right: 140, top: 790, height: 40 }).y, 592);
  // окно слишком узкое для обеих сторон — не уходит левее 8 px
  assert.equal(at({ left: 20, right: 60, top: 300, height: 40 }, 300).x, 8);
});
