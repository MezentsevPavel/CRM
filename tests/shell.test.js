'use strict';
// Оболочка: ширина страниц и прокрутка колонок воронок (таск 08).
// Ожидаемые значения — из таска 08 и разобраны вручную (числа в пикселях), не из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { load } = require('./load.js');
const { cssFiles } = require('../tools/build.js');

// Вид воронки каждого раздела: как его включить на seed() и чем отмечены колонки внутри.
const BOARDS = [
  { name: 'задачи', view: 'tasks', cols: 'data-col=', prep: () => {} },
  { name: 'поставки', view: 'logistics', cols: 'data-scol=', prep: app => { app.S.prefs.ship.view = 'funnel'; } },
  { name: 'сделки', view: 'clients', cols: 'class="funnel"', prep: () => {} },
  { name: 'лиды', view: 'leads', cols: 'data-lcol=', prep: app => { app.leadU().view = 'funnel'; } },
];

for (const b of BOARDS) {
  test(`воронка «${b.name}»: контейнер колонок помечен data-hscroll — по нему оболочка ставит стрелки`, () => {
    const app = load();
    b.prep(app);
    const html = app.VIEWS[b.view]();
    assert.ok(html.includes(b.cols), `в виде нет самих колонок (${b.cols}) — проверка не о том`);
    const at = html.indexOf('data-hscroll');
    assert.ok(at >= 0, 'контейнер колонок не помечен data-hscroll');
    // пометка стоит на контейнере, внутри которого колонки, а не где-то в стороне
    assert.ok(html.indexOf(b.cols, at) > at, 'data-hscroll стоит не над колонками');
  });
}

test('ширина: у .view в собранном CSS нет ограничения в 1480 px; пояснения держат свою ширину строки', () => {
  const css = cssFiles().map(f => fs.readFileSync(f, 'utf8')).join('\n');
  const rule = sel => (css.match(new RegExp('(?:^|\\})\\s*' + sel.replace(/\./g, '\\.') + '\\s*\\{([^}]*)\\}')) || [])[1];
  const view = rule('.view');
  assert.ok(view, 'правило .view не найдено');
  assert.ok(!/max-width\s*:\s*1480px/.test(view), '.view всё ещё ограничен 1480 px');
  assert.ok(/max-width\s*:\s*80ch/.test(rule('.hint')), '.hint потерял ширину строки 80 знаков');
  assert.ok(/max-width\s*:\s*62ch/.test(rule('.prose')), '.prose потерял ширину строки 62 знака');
});

// ——— чистые решения прокрутки: куда ещё можно листать и как быстро ехать у края ———
// Окно 500 px, содержимое 1200 px: влево до 0, вправо до 700.
test('hscrollCan: у начала можно только вправо, у конца только влево, посередине в обе стороны, влезло — никуда', () => {
  const { hscrollCan } = load();
  assert.deepEqual({ ...hscrollCan({ scrollLeft: 0, clientWidth: 500, scrollWidth: 1200 }) }, { left: false, right: true });
  assert.deepEqual({ ...hscrollCan({ scrollLeft: 300, clientWidth: 500, scrollWidth: 1200 }) }, { left: true, right: true });
  assert.deepEqual({ ...hscrollCan({ scrollLeft: 700, clientWidth: 500, scrollWidth: 1200 }) }, { left: true, right: false });
  assert.deepEqual({ ...hscrollCan({ scrollLeft: 0, clientWidth: 500, scrollWidth: 500 }) }, { left: false, right: false });
});

test('hscrollCan: доли пикселя на дробном масштабе не оставляют стрелку у самого конца', () => {
  const { hscrollCan } = load();
  // до конца 0.4 px — пальцем и мышью туда уже не доехать
  assert.equal(hscrollCan({ scrollLeft: 699.6, clientWidth: 500, scrollWidth: 1200 }).right, false);
  // до конца 5 px — ещё есть что листать
  assert.equal(hscrollCan({ scrollLeft: 695, clientWidth: 500, scrollWidth: 1200 }).right, true);
});

// Контейнер от x=100 до x=600, полоса у края 60 px, скорость у самой кромки 1000 px/с.
test('hscrollEdgeSpeed: у левой кромки едет влево, у правой вправо, посередине стоит, чем ближе к кромке, тем быстрее', () => {
  const { hscrollEdgeSpeed } = load();
  const v = x => hscrollEdgeSpeed(x, 100, 600, 60, 1000);
  assert.equal(v(350), 0, 'посередине колонки не едут');
  assert.equal(v(160), 0, 'ровно на границе полосы — ещё нет');
  assert.equal(v(100), -1000, 'на левой кромке — полная скорость влево');
  assert.equal(v(600), 1000, 'на правой кромке — полная скорость вправо');
  assert.equal(v(130), -500, 'на полпути внутри левой полосы — половина скорости');
  assert.equal(v(570), 500, 'на полпути внутри правой полосы — половина скорости');
  assert.equal(v(50), -1000, 'курсор за кромкой не быстрее полной скорости');
});
