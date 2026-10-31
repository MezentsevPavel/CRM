'use strict';
// Задачи, доски и «Настройки → Воронки» (таск 06, первый кусок).
// Ожидаемые значения — из таска, спецификации (истории 11–16) и разобранных вручную чисел, не из кода под тестом.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./load.js');

const plain = x => JSON.parse(JSON.stringify(x));

// Куда лежат записи каждого вида: список состояния и поле «в какой воронке».
const STORES = {
  tasks: ['tasks', 'boardId'], deals: ['deals', 'pipeId'], leads: ['leads', 'pipeId'],
  ships: ['shipments', 'pipeId'], dispatch: ['dispatches', 'pipeId'],
};

// ——— ядро: Pipes ———

test('Pipes.items: знает записи всех пяти видов воронок', () => {
  const { Pipes, seed } = load();
  const st = seed();
  for (const kind of ['tasks', 'deals', 'leads', 'ships', 'dispatch']) {
    const [list, field] = STORES[kind];
    const pipes = Pipes.of(st, kind);
    const viaPipes = pipes.reduce((n, p) => n + Pipes.items(st, p.id).length, 0);
    const byField = st[list].filter(x => pipes.some(p => p.id === x[field])).length;
    assert.ok(byField > 0, `в демо нет записей вида ${kind} — проверка пустая`);
    assert.equal(viaPipes, byField, `Pipes.items не видит записи вида ${kind}`);
    assert.equal(viaPipes, st[list].length, `в ${list} есть записи без воронки`);
  }
});

test('Pipes.removeStage: записи любого вида переезжают, ни одна не теряется', () => {
  const { Pipes, seed } = load();
  for (const kind of ['tasks', 'deals', 'leads', 'ships', 'dispatch']) {
    const st = seed();
    const [list, field] = STORES[kind];
    const p = Pipes.of(st, kind)[0];
    const spare = Pipes.addStage(st, p.id, 'Временный', Pipes.beforeEnd(st, p.id));
    const all = Pipes.items(st, p.id), total = all.length;
    // две записи кладём на временный этап, остальные остаются где были
    all.slice(0, 2).forEach(x => { x.stageId = spare.id; });
    const to = p.stages.find(s => s.id !== spare.id && !s.flag).id;
    const r = Pipes.removeStage(st, p.id, spare.id, to);
    assert.equal(r.ok, true, `${kind}: ${r.reason}`);
    assert.equal(r.moved, 2, `${kind}: перенесено не две записи`);
    assert.equal(Pipes.items(st, p.id).length, total, `${kind}: запись потерялась`);
    assert.equal(st[list].filter(x => x[field] === p.id && x.stageId === spare.id).length, 0, `${kind}: запись осталась на удалённом этапе`);
    assert.ok(Pipes.items(st, p.id).every(x => p.stages.some(s => s.id === x.stageId)), `${kind}: у записи нет такого этапа`);
  }
});

test('Pipes.removeStage (поставки): правила shipRules с этим этапом переезжают туда же, куда записи', () => {
  const { Pipes, seed } = load();
  const st = seed();
  const stuck = Pipes.items(st, 'ships').filter(s => s.stageId === 'transship').length;
  assert.ok(stuck > 0, 'в демо нет поставок на «Перевалке в Чите»');
  const rule = id => st.shipRules.find(r => r.id === id).then;
  assert.equal(rule('sr2'), 'transship');
  const r = Pipes.removeStage(st, 'ships', 'transship', 'toStock');
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.moved, stuck);
  assert.equal(rule('sr2'), 'toStock', 'правило осталось на удалённом этапе');
  assert.equal(rule('sr1'), 'inStock', 'чужое правило тронуто');
  assert.ok(st.shipRules.every(x => Pipes.stage(st, 'ships', x.then)), 'есть правило без этапа');
});

test('Pipes.removeStage: этап, на который ссылается правило, без «куда» не удалить, даже пустой', () => {
  const { Pipes, seed } = load();
  const st = seed();
  st.shipments.filter(s => s.stageId === 'transship').forEach(s => { s.stageId = 'customs'; });
  const refused = Pipes.removeStage(st, 'ships', 'transship');
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /правил/);
  assert.ok(Pipes.stage(st, 'ships', 'transship'), 'этап удалён без выбора');
  assert.equal(st.shipRules.find(r => r.id === 'sr2').then, 'transship');
  assert.equal(Pipes.removeStage(st, 'ships', 'transship', 'toStock').ok, true);
  assert.equal(st.shipRules.find(r => r.id === 'sr2').then, 'toStock');
});

test('Pipes.removeStage: этапы, на которых держится логика, не удаляются — только переименовываются', () => {
  const { Pipes, seed } = load();
  const st = seed();
  const LOCKED = {
    leads: ['new', 'contacted', 'qualified', 'deal', 'lost'],
    dispatch: ['new', 'onWay', 'delivered', 'cancelled'],
    ships: ['arrived', 'inStock'],
    tasks: ['done'],
    deals: ['done'],
  };
  for (const [kind, ids] of Object.entries(LOCKED)) {
    const p = Pipes.of(st, kind)[0];
    for (const id of ids) {
      assert.ok(Pipes.lock(st, p.id, id), `${kind}/${id}: этап не защищён`);
      const before = p.stages.length;
      const r = Pipes.removeStage(st, p.id, id, p.stages.find(s => s.id !== id).id);
      assert.equal(r.ok, false, `${kind}/${id}: этап удалён`);
      assert.equal(p.stages.length, before);
      assert.ok(r.reason.length > 10, `${kind}/${id}: нет объяснения`);
    }
  }
  // обычный этап — свободен
  assert.equal(Pipes.lock(st, 'dispatch', 'picking'), '');
  assert.equal(Pipes.lock(st, 'tasksCommon', 'work'), '');
  // переименование замка не трогает флаг и id
  assert.equal(Pipes.renameStage(st, 'leads', 'deal', 'Сделка заведена').ok, true);
  const deal = Pipes.stage(st, 'leads', 'deal');
  assert.equal(deal.name, 'Сделка заведена');
  assert.equal(deal.flag, 'final');
});

test('Pipes.beforeEnd: новый этап встаёт перед завершающими — флаг final остаётся у последнего', () => {
  const { Pipes, seed } = load();
  const st = seed();
  const board = Pipes.of(st, 'tasks')[0];
  const added = Pipes.addStage(st, board.id, 'Ждёт материалов', Pipes.beforeEnd(st, board.id));
  assert.deepEqual(plain(board.stages.map(s => s.name)), ['Новые', 'В работе', 'На проверке', 'Ждёт материалов', 'Готово']);
  assert.equal(board.stages[board.stages.length - 1].flag, 'final');
  assert.equal(added.flag, undefined);
  // у лидов два завершающих этапа в конце — новый встаёт перед обоими
  const leads = Pipes.of(st, 'leads')[0];
  Pipes.addStage(st, leads.id, 'Перезвонить', Pipes.beforeEnd(st, leads.id));
  assert.deepEqual(plain(leads.stages.map(s => s.name)), ['Новый', 'Связались', 'Квалифицирован', 'Перезвонить', 'Сделка создана', 'Отказ']);
});

test('Pipes.removePipe: последнюю доску не удалить; записи уезжают на выбранную; сделки не меняют тип', () => {
  const { Pipes, seed } = load();
  const st = seed();
  const only = Pipes.of(st, 'tasks')[0];
  const last = Pipes.removePipe(st, only.id, only.id);
  assert.equal(last.ok, false);
  assert.match(last.reason, /последн/);
  assert.equal(Pipes.of(st, 'tasks').length, 1);

  const second = Pipes.addPipe(st, 'tasks', 'Монтаж');
  assert.deepEqual(plain(second.stages.map(s => s.name)), ['Новые', 'В работе', 'На проверке', 'Готово'], 'новая доска не с этапами по умолчанию');
  const total = st.tasks.length;
  const r = Pipes.removePipe(st, only.id, second.id);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.moved, total);
  assert.equal(Pipes.items(st, second.id).length, total, 'задача потерялась');
  assert.ok(st.tasks.every(t => t.boardId === second.id && Pipes.stage(st, second.id, t.stageId)));
  assert.equal(Pipes.removePipe(st, second.id, second.id).ok, false, 'удалили и вторую — доски не осталось');

  // сделки B2B — единственная воронка типа: удалить нельзя, хоть B2C и есть
  const b2b = Pipes.of(st, 'deals', 'b2b').find(p => p.scope === 'b2b');
  const b2c = Pipes.of(st, 'deals', 'b2c').find(p => p.scope === 'b2c');
  const refused = Pipes.removePipe(st, b2b.id, b2c.id);
  assert.equal(refused.ok, false, 'сделки B2B уехали в воронку B2C');
});

// ——— задачи: человеку и отделу, «Взять», права ———

// Форма «Новая задача»: заполняем поля так, как это делает человек, и отправляем.
function postTask(app, { title, to, deal = '' }) {
  const set = (id, v) => { app.byId(id).value = v; };
  set('t-title', title); set('t-to', to); set('t-due', '2026-11-05'); set('t-prio', 'normal'); set('t-deal', deal); set('t-desc', '');
  app.FORMS.task();
  return app.S.tasks.find(t => t.title === title);
}
// Число в «Моих задачах» у человека — то же, что показывает значок в меню
const mineCount = (app, pid) => { app.setMe(pid); return app.NAV.find(n => n.id === 'tasks').badge(); };

test('задача отделу: видна всем в отделе с пометкой «отделу»; «Взять» делает взявшего исполнителем, у остальных она пропадает из «Моих задач»', () => {
  const app = load();
  app.setMe('p1');
  const t = postTask(app, { title: 'Согласовать дату пуска', to: 'd:eng' });
  assert.deepEqual(plain(t.to), { t: 'd', id: 'eng' });
  // отдел «Инженерный»: p4, p7, p8, p11
  const before = { p4: mineCount(app, 'p4'), p7: mineCount(app, 'p7'), p8: mineCount(app, 'p8') };
  for (const pid of ['p4', 'p7', 'p8', 'p11']) {
    app.setMe(pid);
    assert.ok(app.taskMine(t), `${pid}: задача отдела не в «Моих задачах»`);
    const html = app.VIEWS.tasks();
    assert.ok(html.includes('Согласовать дату пуска'), `${pid}: задачу отдела не видно на доске`);
    assert.ok(html.includes('отделу'), `${pid}: нет пометки «отделу»`);
    assert.ok(html.includes('data-act="task-take"'), `${pid}: нет кнопки «Взять»`);
  }
  // вне отдела задача не «моя», и взять её нельзя
  app.setMe('p2');
  assert.equal(app.taskMine(t), false);
  assert.equal(app.A['task-take']({ dataset: { id: t.id } }), false, 'взял человек не из отдела');
  assert.deepEqual(plain(t.to), { t: 'd', id: 'eng' });

  app.setMe('p7');
  app.A['task-take']({ dataset: { id: t.id } });
  assert.deepEqual(plain(t.to), { t: 'p', id: 'p7' }, 'исполнитель не стал взявший');
  assert.equal(app.taskMine(t), true);
  for (const pid of ['p4', 'p8', 'p11']) {
    app.setMe(pid);
    assert.equal(app.taskMine(t), false, `${pid}: задача осталась в «Моих задачах»`);
  }
  assert.equal(mineCount(app, 'p4'), before.p4 - 1, 'значок «Задачи» у p4 не уменьшился');
  assert.equal(mineCount(app, 'p8'), before.p8 - 1);
  assert.equal(mineCount(app, 'p7'), before.p7, 'у взявшего задача была и осталась в счёте');
  // вторую попытку «Взять» уже не принять: задача не отдела
  app.setMe('p8');
  assert.equal(app.A['task-take']({ dataset: { id: t.id } }), false);
  assert.deepEqual(plain(t.to), { t: 'p', id: 'p7' });
});

test('«Взять»: автору и отделу приходит уведомление, кто взял', () => {
  const app = load();
  app.setMe('p1');
  const t = postTask(app, { title: 'Замерить кровлю', to: 'd:eng' });
  app.setMe('p8');
  app.A['task-take']({ dataset: { id: t.id } });
  const note = app.S.notes[0];
  assert.equal(note.kind, 'task');
  assert.ok(note.text.includes('Артём Б.') && note.text.includes('Замерить кровлю'), note.text);
  assert.ok(note.to.includes('p1'), 'автор не узнал, кто взял');
  assert.ok(note.to.includes('p4') && note.to.includes('p7'), 'отдел не узнал, кто взял');
  assert.ok(!note.to.includes('p2'), 'уведомление ушло чужому отделу');
});

test('задача человеку: она у него в «Моих задачах», ему пришло уведомление, другим — нет', () => {
  const app = load();
  app.setMe('p1');
  const t = postTask(app, { title: 'Фото щита после монтажа', to: 'p:p7' });
  assert.deepEqual(plain(t.to), { t: 'p', id: 'p7' });
  assert.equal(t.from, 'p1');
  const notes = app.S.notes.filter(n => n.kind === 'task' && n.text.includes('Фото щита после монтажа'));
  assert.equal(notes.length, 1);
  assert.deepEqual(plain(notes[0].to), ['p7'], 'уведомление пришло не только исполнителю');
  assert.ok(app.Notify.unread(app.S, 'p7').some(n => n.id === notes[0].id), 'у p7 уведомление не непрочитанное');
  assert.ok(!app.Notify.unread(app.S, 'p8').some(n => n.id === notes[0].id), 'у коллеги исполнителя оно появилось');
  app.setMe('p7');
  assert.equal(app.taskMine(t), true);
  assert.ok(app.VIEWS.tasks().includes('Фото щита после монтажа'));
  app.setMe('p8');
  assert.equal(app.taskMine(t), false, 'коллега по отделу видит чужую личную задачу как свою');
  assert.ok(!app.VIEWS.tasks().includes('Фото щита после монтажа'), 'личная задача видна коллеге');
});

test('менеджер ставит задачу другому: у него есть право tasksAssign, в форме все отделы и люди', () => {
  const app = load();
  app.setMe('p2'); // Менеджер B2C, отдел продаж
  assert.equal(app.can('tasksAssign'), true, 'у менеджера B2C нет права ставить задачи другим');
  const html = app.MODALS.task();
  assert.ok(html.includes('value="p:p7"') && html.includes('value="d:eng"'), 'в форме нет людей и отделов других отделов');
  const t = postTask(app, { title: 'Подготовить КП для B2C', to: 'p:p7' });
  assert.deepEqual(plain({ to: t.to, from: t.from }), { to: { t: 'p', id: 'p7' }, from: 'p2' });
  assert.ok(app.Notify.unread(app.S, 'p7').some(n => n.text.includes('Подготовить КП для B2C')), 'исполнитель не получил уведомление');
  // РОП и менеджер B2B — тоже
  for (const pid of ['p3', 'p12']) { app.setMe(pid); assert.equal(app.can('tasksAssign'), true, `${pid}: нет tasksAssign`); }
  // без права — только свой отдел (форма говорит об этом)
  app.Perms.roleOf(app.S, 'p2').perms.tasksAssign = false;
  app.setMe('p2');
  const poor = app.MODALS.task();
  assert.ok(!poor.includes('value="p:p7"') && poor.includes('только ваш отдел'), 'без права форма всё равно открыта на всю фирму');
});

test('форма задачи: менеджер B2C не видит сделок B2B, директор видит все', () => {
  const app = load();
  const ids = type => app.S.deals.filter(d => d.type === type).map(d => d.id);
  assert.ok(ids('b2b').length > 0 && ids('b2c').length > 0, 'в демо нет сделок обоих типов');
  const inForm = (html, id) => html.includes(`<option value="${id}">`);
  app.setMe('p2'); // Менеджер B2C
  const c = app.MODALS.task();
  assert.ok(ids('b2b').every(id => !inForm(c, id)), 'менеджер B2C видит сделки B2B в форме задачи');
  assert.ok(ids('b2c').some(id => inForm(c, id)), 'менеджер B2C не видит и своих сделок');
  app.setMe('p3'); // Менеджер B2B
  const b = app.MODALS.task();
  assert.ok(ids('b2c').every(id => !inForm(b, id)), 'менеджер B2B видит сделки B2C');
  assert.ok(ids('b2b').some(id => inForm(b, id)));
  app.setMe('p1');
  const d = app.MODALS.task();
  assert.ok([...ids('b2b'), ...ids('b2c')].every(id => inForm(d, id)), 'директор не видит все сделки');
});


test('цвет точки задачи — по флагу и месту этапа в воронке, а не по id этапа', () => {
  const app = load();
  // доска, где id этапов «перепутаны»: «work» последний и завершающий, «done» первый
  app.S.pipelines.push({ id: 'odd', kind: 'tasks', name: 'Странная', stages: [
    { id: 'done', name: 'Старт' }, { id: 'review', name: 'Середина' }, { id: 'work', name: 'Финиш', flag: 'final' },
  ] });
  const mk = stageId => ({ id: 't', boardId: 'odd', stageId, to: { t: 'p', id: 'p1' } });
  assert.equal(app.taskDot(mk('done')), '', 'первый этап покрашен как законченный');
  assert.equal(app.taskDot(mk('review')), 'info');
  assert.equal(app.taskDot(mk('work')), 'ok', 'завершающий этап не зелёный');
  // и в разметке карточки
  const html = app.tCard({ ...mk('work'), title: 'x', due: new Date(), prio: 'normal', deal: '', desc: '', from: 'p1', at: new Date() }, false);
  assert.ok(html.includes('class="tdot ok"'), 'карточка не берёт цвет точки по этапу');
});

// ——— доски и «Настройки → Воронки»: один редактор ———

// Как человек нажимает кнопку с data-атрибутами: действие из реестра A получает «элемент» с dataset
const press = (app, act, dataset = {}) => app.A[act]({ dataset });
const taskIds = app => app.S.tasks.map(t => t.id).sort();

test('режим «Редактировать доску»: имя доски и колонок правятся на месте, есть «+ этап» и «+ доска»; контейнер колонок сохраняет data-hscroll', () => {
  const app = load();
  app.setMe('p1');
  const plainView = app.VIEWS.tasks();
  assert.ok(plainView.includes('data-act="board-edit"') && !plainView.includes('data-on="pipe-stage-name"'), 'правка включена без нажатия');
  press(app, 'board-edit');
  assert.equal(app.S.ui.boardEdit, true);
  const html = app.VIEWS.tasks();
  assert.equal((html.match(/data-on="pipe-stage-name"/g) || []).length, 4, 'не у каждой из четырёх колонок поле имени');
  for (const need of ['data-on="pipe-name"', 'data-act="pipe-stage-add"', 'data-act="pipe-add"', 'data-act="pipe-del"']) assert.ok(html.includes(need), `в режиме правки нет ${need}`);
  assert.ok(!/<div class="col col-edit" data-col/.test(html), 'колонки в режиме правки принимают перетаскивание');
  const at = html.indexOf('data-hscroll');
  assert.ok(at >= 0 && html.indexOf('class="kanban"', at) > at, 'режим правки потерял data-hscroll на контейнере колонок');
  // колонка «Готово» — под замком, не под кнопкой «удалить»; остальные три — с кнопкой
  assert.equal((html.match(/data-act="pipe-stage-del"/g) || []).length, 3);
  assert.equal((html.match(/data-act="pipe-lock"/g) || []).length, 1);
  // переименование на месте
  app.ON.change['pipe-stage-name']({ dataset: { pipe: 'tasksCommon', stage: 'work' }, value: 'Делаем' });
  app.ON.change['pipe-name']({ dataset: { pipe: 'tasksCommon' }, value: 'Монтаж' });
  const after = app.VIEWS.tasks();
  assert.ok(after.includes('value="Делаем"') && after.includes('value="Монтаж"'));
  press(app, 'board-edit');
  assert.ok(app.VIEWS.tasks().includes('Делаем'), 'после правки колонка не называется по-новому');
  assert.equal(app.Pipes.of(app.S, 'tasks')[0].name, 'Монтаж');
});

test('режим правки доступен только с правом «Менять настройки фирмы»; без него флаг ничего не включает', () => {
  const app = load();
  app.setMe('p2');
  app.S.ui.boardEdit = true;
  const html = app.VIEWS.tasks();
  assert.ok(!html.includes('data-on="pipe-stage-name"') && !html.includes('board-edit'), 'менеджеру открыта правка досок');
});

test('«+ этап» и «+ доска»: этап встаёт перед завершающим, флаг final остаётся у последнего; новая доска — с этапами по умолчанию', () => {
  const app = load();
  app.setMe('p1');
  press(app, 'pipe-stage-add', { pipe: 'tasksCommon' });
  const board = app.Pipes.of(app.S, 'tasks')[0];
  assert.deepEqual(plain(board.stages.map(s => s.name)), ['Новые', 'В работе', 'На проверке', 'Новый этап', 'Готово']);
  assert.equal(board.stages[board.stages.length - 1].flag, 'final', 'флаг final потерян у последнего этапа');
  // переименование последнего этапа флага не снимает
  app.ON.change['pipe-stage-name']({ dataset: { pipe: board.id, stage: 'done' }, value: 'Сдано' });
  assert.equal(app.Pipes.stage(app.S, board.id, 'done').flag, 'final');
  assert.equal(app.Pipes.isFinal(app.S, board.id, 'done'), true);
  // новая доска
  press(app, 'pipe-add', { g: 'tasks' });
  const boards = app.Pipes.of(app.S, 'tasks');
  assert.equal(boards.length, 2);
  assert.deepEqual(plain(boards[1].stages.map(s => s.name)), ['Новые', 'В работе', 'На проверке', 'Готово'], 'новая доска не с этапами по умолчанию');
  assert.equal(app.S.ui.taskBoard, boards[1].id, 'новая доска не открылась');
  // переключатель досок
  press(app, 'task-board', { id: boards[0].id });
  assert.equal(app.curBoard().id, boards[0].id);
  assert.ok(app.VIEWS.tasks().includes('data-act="task-board"'), 'нет переключателя досок');
});

test('удаление этапа с задачами спрашивает, куда перенести; ни одна задача не теряется', () => {
  const app = load();
  app.setMe('p1');
  const before = taskIds(app);
  const onWork = app.S.tasks.filter(t => t.stageId === 'work').length;
  assert.ok(onWork >= 2, 'в демо мало задач «В работе»');
  const total = app.S.tasks.length;
  const toReview = app.S.tasks.filter(t => t.stageId === 'review').length;

  press(app, 'pipe-stage-del', { pipe: 'tasksCommon', stage: 'work' });
  assert.equal(app.S.ui.modal && app.S.ui.modal.type, 'pipeStageDel', 'окно «куда перенести» не открылось');
  assert.ok(app.Pipes.stage(app.S, 'tasksCommon', 'work'), 'этап удалён до ответа');
  const win = app.MODALS.pipeStageDel('tasksCommon|work');
  assert.ok(win.includes(`${onWork} `) && win.includes('Куда перенести'), 'в окне нет числа задач и выбора');
  assert.ok(!win.includes('value="work"'), 'в списке «куда» есть сам удаляемый этап');

  app.byId('pm-to').value = 'review';
  app.FORMS['pipe-stage-del']({ dataset: { pipe: 'tasksCommon', stage: 'work' } });
  assert.equal(app.Pipes.stage(app.S, 'tasksCommon', 'work'), null);
  assert.equal(app.S.tasks.length, total);
  assert.deepEqual(taskIds(app), before, 'задача потерялась');
  assert.equal(app.S.tasks.filter(t => t.stageId === 'review').length, toReview + onWork, 'задачи переехали не на выбранный этап');
  assert.ok(app.S.tasks.every(t => app.Pipes.stage(app.S, t.boardId, t.stageId)), 'у задачи нет такого этапа');
  assert.equal(app.S.ui.modal, null, 'окно не закрылось');

  // пустой этап — без вопросов
  press(app, 'pipe-stage-add', { pipe: 'tasksCommon' });
  const fresh = app.Pipes.of(app.S, 'tasks')[0].stages.find(s => s.name === 'Новый этап');
  press(app, 'pipe-stage-del', { pipe: 'tasksCommon', stage: fresh.id });
  assert.equal(app.S.ui.modal, null);
  assert.equal(app.Pipes.stage(app.S, 'tasksCommon', fresh.id), null);
});

test('удаление доски с задачами спрашивает, на какую доску; последнюю доску удалить нельзя', () => {
  const app = load();
  app.setMe('p1');
  const before = taskIds(app);
  press(app, 'pipe-add', { g: 'tasks' });
  const [old, fresh] = app.Pipes.of(app.S, 'tasks');
  press(app, 'pipe-del', { pipe: old.id });
  assert.equal(app.S.ui.modal && app.S.ui.modal.type, 'pipeDel');
  assert.ok(app.MODALS.pipeDel(old.id).includes(`value="${fresh.id}"`), 'в окне нет второй доски');
  app.byId('pd-to').value = fresh.id;
  app.FORMS['pipe-del']({ dataset: { pipe: old.id } });
  assert.equal(app.Pipes.of(app.S, 'tasks').length, 1);
  assert.deepEqual(taskIds(app), before, 'задача потерялась вместе с доской');
  assert.ok(app.S.tasks.every(t => t.boardId === fresh.id && app.Pipes.stage(app.S, fresh.id, t.stageId)));
  assert.equal(app.curBoard().id, fresh.id, 'после удаления открыта несуществующая доска');

  // единственная — не удаляется ни действием, ни кнопкой
  press(app, 'pipe-del', { pipe: fresh.id });
  assert.equal(app.S.ui.modal, null, 'для последней доски открылось окно удаления');
  assert.equal(app.Pipes.of(app.S, 'tasks').length, 1);
  press(app, 'board-edit');
  assert.match(app.VIEWS.tasks(), /data-act="pipe-del"[^>]*disabled/, 'кнопка «удалить» у последней доски не выключена');
  assert.equal(app.Pipes.removePipe(app.S, fresh.id, fresh.id).ok, false);
});

test('удаление этапа поставок: правила shipRules уезжают вместе с записями (через окно «куда перенести»)', () => {
  const app = load();
  app.setMe('p1');
  const ruleThen = () => app.S.shipRules.find(r => r.id === 'sr2').then;
  const ships = app.S.shipments.length;
  press(app, 'pipe-stage-del', { pipe: 'ships', stage: 'transship' });
  assert.equal(app.S.ui.modal && app.S.ui.modal.type, 'pipeStageDel');
  assert.match(app.MODALS.pipeStageDel('ships|transship'), /правил/, 'окно не говорит о правилах поставок');
  app.byId('pm-to').value = 'toStock';
  app.FORMS['pipe-stage-del']({ dataset: { pipe: 'ships', stage: 'transship' } });
  assert.equal(ruleThen(), 'toStock');
  assert.equal(app.S.shipments.length, ships);
  assert.ok(app.S.shipments.every(s => app.Pipes.stage(app.S, s.pipeId, s.stageId)));
});

test('защищённый этап лида и отправки: в редакторе замок и пояснение вместо «×», действие удаления отказывает', () => {
  const app = load();
  app.setMe('p1');
  const pick = g => { app.S.ui.setTab = 'pipes'; app.S.ui.pipeGroup = g; app.S.ui.pipeSel = null; return app.VIEWS.settings(); };
  const leads = pick('leads');
  assert.equal((leads.match(/data-act="pipe-lock"/g) || []).length, 5, 'у лидов должны быть защищены все пять этапов');
  assert.equal((leads.match(/data-act="pipe-stage-del"/g) || []).length, 0);
  assert.ok(leads.includes('Защищён:') && leads.includes('удалить нельзя'), 'у замка нет пояснения словами');
  const disp = pick('dispatch');
  assert.equal((disp.match(/data-act="pipe-lock"/g) || []).length, 4, 'у отправок защищены «Новая», «В пути», «Доставлена», «Отменена»');
  assert.equal((disp.match(/data-act="pipe-stage-del"/g) || []).length, 2, '«Собирается» и «Готова к отправке» свободны');
  // нажать «удалить» на защищённом нельзя: ни окна, ни удаления
  const before = app.Pipes.of(app.S, 'leads')[0].stages.length;
  press(app, 'pipe-stage-del', { pipe: 'leads', stage: 'lost' });
  assert.equal(app.S.ui.modal, null);
  assert.equal(app.Pipes.of(app.S, 'leads')[0].stages.length, before);
  // а переименовать можно — id и флаг на месте
  app.ON.change['pipe-stage-name']({ dataset: { pipe: 'leads', stage: 'lost' }, value: 'Не получилось' });
  const lost = app.Pipes.stage(app.S, 'leads', 'lost');
  assert.deepEqual(plain({ name: lost.name, flag: lost.flag }), { name: 'Не получилось', flag: 'final' });
});

test('«Настройки → Воронки»: выбор воронки — доски задач, сделки B2B и B2C, лиды, поставки, отправки; у директора есть, у менеджера нет', () => {
  const app = load();
  app.setMe('p1');
  assert.ok(app.settingsTabs().some(t => t.id === 'pipes' && t.label === 'Воронки'), 'у директора нет вкладки «Воронки»');
  app.S.ui.setTab = 'pipes';
  const labels = ['Доски задач', 'Сделки B2B', 'Сделки B2C', 'Лиды', 'Поставки', 'Отправки'];
  const first = app.VIEWS.settings();
  for (const l of labels) assert.ok(first.includes(`>${l}</button>`), `в выборе воронки нет «${l}»`);
  const pipeOfGroup = { tasks: 'tasksCommon', b2b: 'dealsB2b', b2c: 'dealsB2c', leads: 'leads', ships: 'ships', dispatch: 'dispatch' };
  for (const [g, pid] of Object.entries(pipeOfGroup)) {
    app.S.ui.pipeGroup = g; app.S.ui.pipeSel = null;
    const html = app.VIEWS.settings();
    const p = app.S.pipelines.find(x => x.id === pid);
    assert.ok(html.includes(`value="${p.name}"`), `${g}: нет названия воронки «${p.name}»`);
    for (const s of p.stages) assert.ok(html.includes(`value="${s.name}"`), `${g}: нет этапа «${s.name}»`);
    assert.equal((html.match(/data-on="pipe-stage-name"/g) || []).length, p.stages.length, `${g}: поле имени не у каждого этапа`);
  }
  app.setMe('p2');
  assert.ok(!app.settingsTabs().some(t => t.id === 'pipes'), 'менеджеру открыты «Воронки»');
});

test('переименование этапа сделки видно в разделе «Сделки» сразу', () => {
  const app = load();
  app.setMe('p1');
  app.S.ui.dealType = 'b2b';
  assert.ok(!app.VIEWS.deals().includes('Просчёт'));
  app.S.ui.setTab = 'pipes'; app.S.ui.pipeGroup = 'b2b';
  app.ON.change['pipe-stage-name']({ dataset: { pipe: 'dealsB2b', stage: 'calc' }, value: 'Просчёт' });
  assert.ok(app.VIEWS.deals().includes('Просчёт'), 'раздел «Сделки» не показывает новое имя этапа');
  assert.ok(!app.VIEWS.deals().includes('>Расчёт<'), 'в разделе остался старый этап');
  // пустое имя не принимается
  app.ON.change['pipe-stage-name']({ dataset: { pipe: 'dealsB2b', stage: 'calc' }, value: '  ' });
  assert.equal(app.Pipes.stage(app.S, 'dealsB2b', 'calc').name, 'Просчёт');
});

test('«Настройки → Воронки»: «+ воронка» у сделок и «Удалить» работают тем же кодом, что доски; у лидов, поставок и отправок — только этапы', () => {
  const app = load();
  app.setMe('p1');
  app.S.ui.setTab = 'pipes';
  for (const g of ['leads', 'ships', 'dispatch']) {
    app.S.ui.pipeGroup = g;
    const html = app.VIEWS.settings();
    assert.ok(!html.includes('data-act="pipe-add"') && !html.includes('data-act="pipe-del"'), `${g}: можно завести лишнюю воронку, которую раздел не покажет`);
  }
  press(app, 'pipe-group', { g: 'b2c' });
  press(app, 'pipe-add', { g: 'b2c' });
  const b2c = app.Pipes.of(app.S, 'deals', 'b2c').filter(p => p.scope === 'b2c');
  assert.equal(b2c.length, 2);
  assert.equal(b2c[1].scope, 'b2c');
  assert.equal(app.S.ui.pipeSel, b2c[1].id);
  // сделок B2B в воронку B2C не отдать: у B2B воронка одна, удалить её нельзя
  press(app, 'pipe-del', { pipe: 'dealsB2b' });
  assert.equal(app.S.ui.modal, null);
  assert.ok(app.Pipes.stage(app.S, 'dealsB2b', 'request'));
});
