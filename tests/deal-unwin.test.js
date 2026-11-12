'use strict';
// Директор 2026-11-12: успешно закрытую сделку «как вернуть?» — и во вкладке «Лента» пропадали этапы и вкладки, вернуться было некуда.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('./load.js');

function setup() {
  const a = load();
  const { S } = a;
  a.setMe(S.people.find(p => p.role === 'director').id);
  const d = S.deals.find(x => a.Deals.state(S, x) === 'open' && !x.lostReason);
  assert.ok(d, 'в демо нет открытой сделки');
  const stages = S.pipelines.find(p => p.id === d.pipeId).stages;
  const fi = stages.findIndex(s => s.flag === 'final');
  assert.ok(fi > 1, 'в воронке нет этапа «Успешно» или перед ним меньше двух этапов');
  return { a, S, d, stages, fi };
}

test('«Вернуть в работу» у успешной сделки: назад на тот этап, с которого закрыли; запись в ленте; не успешную — отказ', () => {
  const { a, S, d, stages } = setup();
  const from = stages[0];
  if (d.stageId !== from.id) assert.equal(a.Deals.move(S, d.id, from.id, S.me, new Date()).ok, true);
  assert.match(a.Deals.unwin(S, d.id, S.me, new Date()).reason, /не закрыта успешно/);
  assert.equal(a.Deals.win(S, d.id, S.me, new Date()).ok, true);
  assert.equal(a.Deals.state(S, d), 'won');
  const r = a.Deals.unwin(S, d.id, S.me, new Date());
  assert.equal(r.ok, true, r.reason);
  assert.equal(d.stageId, from.id, 'вернулась не на тот этап, с которого закрыли');
  assert.equal(a.Deals.state(S, d), 'open');
  assert.equal(d.wonAt, undefined);
  assert.equal(d.wonFrom, undefined);
  const last = S.feed[S.feed.length - 1];
  assert.equal(last.ref.id, d.id);
  assert.match(last.text, new RegExp(`→ «${from.name}»`), 'в ленте нет записи о возврате');
});

test('закрытая раньше, без запомненного этапа, — на этап перед «Успешно»', () => {
  const { a, S, d, stages, fi } = setup();
  assert.equal(a.Deals.win(S, d.id, S.me, new Date()).ok, true);
  delete d.wonFrom;
  assert.equal(a.Deals.unwin(S, d.id, S.me, new Date()).ok, true);
  assert.equal(d.stageId, stages[fi - 1].id);
});

test('карточка успешной сделки: кнопка «Вернуть в работу» при праве правки, нажатие возвращает', () => {
  const { a, S, d } = setup();
  a.Deals.win(S, d.id, S.me, new Date());
  const card = a.dealCard(d).body;
  assert.match(card, new RegExp(`data-act="deal-unwin" data-id="${d.id}"`));
  assert.doesNotMatch(card, /undefined/, 'в карточке «undefined» — нет такой иконки');
  a.A['deal-unwin']({ dataset: { id: d.id } });
  assert.equal(a.Deals.state(S, d), 'open');
  assert.doesNotMatch(a.dealCard(d).body, /data-act="deal-unwin"/);
});

test('в листаемой карточке блоки не сжимаются — полоса этапов и вкладки видны при длинной ленте', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'css', '50-shell.css'), 'utf8');
  assert.match(css, /\.drawer-b>\*\{flex-shrink:0\}/);
});
