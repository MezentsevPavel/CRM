// Ядро: роли и права. Роли — данные (st.roles), проверки спрашивают право, а не название роли.
// Встроенные роли не удаляются; у директора все права, и снять их нельзя.

const Perms = (() => {
  // Права: ключ и подпись. Первые тринадцать — как в v2, дальше новые.
  const LIST = [
    ['firm', 'Видеть сводку по всей фирме'],
    ['tasksAll', 'Видеть задачи всех отделов'],
    ['tasksAssign', 'Ставить задачи другим отделам'],
    ['stock', 'Видеть остатки, резервы и поставки'],
    ['prices', 'Видеть цены и суммы'],
    ['reserve', 'Ставить и снимать резервы'],
    ['catalog', 'Добавлять товары в номенклатуру'],
    ['logistics', 'Отмечать этапы перевозки'],
    ['receive', 'Принимать товар на склад'],
    ['clients', 'Видеть клиентов и сделки'],
    ['write', 'Писать клиентам в Telegram и MAX'],
    ['auto', 'Настраивать авто-сообщения'],
    ['admin', 'Управлять сотрудниками и правами'],
    ['mail', 'Работать с почтой своих ящиков'],
    ['leads', 'Видеть и вести лиды'],
    ['leadsAssign', 'Распределять и передавать лиды'],
    ['dealsAll', 'Видеть сделки всех типов'],
    ['dealsEdit', 'Заводить и править сделки'],
    ['settings', 'Менять настройки фирмы'],
    ['dispatch', 'Вести отправки'],
    ['sell', 'Списывать при продаже'],
  ];
  const KEYS = LIST.map(p => p[0]);
  // Права, которых в рабочей версии (SERVER) не видно ни в таблице прав, ни в форме роли: почта и сообщения клиентам в
  // Telegram и MAX — не этот этап. Сами права остаются в ролях (данные), прячется только их показ.
  const SERVER_HIDDEN = ['write', 'mail'];
  // Права для таблиц и форм на экране: в демо все, в рабочей версии — без спрятанных
  const shown = () => (SERVER ? LIST.filter(p => !SERVER_HIDDEN.includes(p[0])) : LIST);

  // Права по умолчанию — «Решения по реализации» спецификации.
  // Менеджер видит лиды и сделки своего типа (scope), dealsAll у него нет. Заводить и править сделки (dealsEdit) — менеджерам,
  // РОП (право ему дают в шаге сделок, 42-deals.js) и директору; инженеры смотрят сделки, но не правят (R30).
  const ENGINEER = ['tasksAssign', 'stock', 'clients', 'dealsAll', 'auto'];
  const DEFAULTS = [
    { id: 'director', name: 'Директор', all: true, on: KEYS },
    { id: 'managerB2b', name: 'Менеджер B2B', scope: 'b2b', on: ['stock', 'prices', 'reserve', 'leads', 'clients', 'dealsEdit', 'write', 'mail', 'sell', 'tasksAssign', 'auto'] },
    { id: 'managerB2c', name: 'Менеджер B2C', scope: 'b2c', on: ['stock', 'prices', 'reserve', 'leads', 'clients', 'dealsEdit', 'write', 'mail', 'sell', 'tasksAssign', 'auto'] },
    { id: 'logist', name: 'Логист', on: ['stock', 'logistics', 'mail', 'tasksAssign', 'dispatch', 'auto'] },
    // Клиентов и сделки всех типов кладовщик видит — слово директора 2026-11-01: «Отметь сам по умолчанию».
    { id: 'warehouse', name: 'Кладовщик', on: ['stock', 'receive', 'dispatch', 'clients', 'dealsAll', 'auto'] },
    // Главный инженер и инженер — одна матрица (R30).
    { id: 'chiefEngineer', name: 'Главный инженер', on: ENGINEER },
    { id: 'engineer', name: 'Инженер', on: ENGINEER },
  ];

  // Полная матрица {право: да/нет} из списка включённых прав или из готовой матрицы.
  function matrix(perms) {
    const on = Array.isArray(perms) ? perms : Object.keys(perms || {}).filter(k => perms[k] === true);
    const m = {};
    for (const k of KEYS) m[k] = on.includes(k);
    return m;
  }

  // Встроенные роли — новая копия на каждый вызов (для seed()).
  function defaultRoles() {
    return DEFAULTS.map(r => {
      const role = { id: r.id, name: r.name, builtin: true, perms: matrix(r.on) };
      if (r.all) role.all = true;
      if (r.scope) role.scope = r.scope;
      return role;
    });
  }

  const person = (st, personId) => (st.people || []).find(p => p.id === personId) || null;

  function roleOf(st, personId) {
    const p = person(st, personId);
    if (!p) return null;
    return (st.roles || []).find(r => r.id === p.role) || null;
  }

  // Может ли человек это. Неизвестное право — нет ни у кого (опечатка не открывает доступ).
  function can(st, personId, perm) {
    if (!KEYS.includes(perm)) return false;
    const role = roleOf(st, personId);
    if (!role) return false;
    if (role.all) return true;
    return !!(role.perms && role.perms[perm] === true);
  }

  // Почему такую роль завести нельзя ('' — можно): имя пустое или уже занято.
  function addBlock(st, name) {
    const n = String(name || '').trim();
    if (!n) return 'Впишите название роли.';
    if ((st.roles || []).some(r => r.name.trim().toLowerCase() === n.toLowerCase())) return `Роль «${n}» уже есть — назовите по-другому.`;
    return '';
  }

  // Своя роль директора: имя и права. Пустое или занятое имя → null (причину говорит addBlock).
  function addRole(st, name, perms) {
    if (addBlock(st, name)) return null;
    st.roles = st.roles || [];
    const role = { id: Store.freeId(st.roles, 'role'), name: String(name).trim(), builtin: false, perms: matrix(perms) };
    st.roles.push(role);
    return role;
  }

  const staff = n => n % 10 === 1 && n % 100 !== 11 ? 'сотрудник'
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'сотрудника' : 'сотрудников';

  // Почему роль удалить нельзя ('' — можно): встроенная, или на ней есть люди — пока их не переназначат.
  function removeBlock(st, roleId) {
    const role = (st.roles || []).find(r => r.id === roleId);
    if (!role) return 'Роль не найдена';
    if (role.builtin) return `Роль «${role.name}» встроенная — её нельзя удалить`;
    const n = (st.people || []).filter(p => p.role === roleId).length;
    return n ? `На роли «${role.name}» ${n} ${staff(n)} — сначала назначьте им другую роль` : '';
  }

  // Удалить роль: встроенную нельзя, роль с людьми нельзя, пока их не переназначат.
  function removeRole(st, roleId) {
    const reason = removeBlock(st, roleId);
    if (reason) return { ok: false, reason };
    st.roles = st.roles.filter(r => r.id !== roleId);
    return { ok: true, reason: '' };
  }

  return { LIST, shown, defaultRoles, roleOf, can, addBlock, addRole, removeBlock, removeRole };
})();
