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
    ['settings', 'Менять настройки фирмы'],
    ['dispatch', 'Вести отправки'],
    ['sell', 'Списывать при продаже'],
  ];
  const KEYS = LIST.map(p => p[0]);

  // Права по умолчанию — «Решения по реализации» спецификации.
  // Менеджер видит лиды и сделки своего типа (scope), dealsAll у него нет.
  const ENGINEER = ['tasksAssign', 'stock', 'clients', 'dealsAll'];
  const DEFAULTS = [
    { id: 'director', name: 'Директор', all: true, on: KEYS },
    { id: 'managerB2b', name: 'Менеджер B2B', scope: 'b2b', on: ['stock', 'prices', 'reserve', 'leads', 'clients', 'write', 'mail', 'sell', 'tasksAssign'] },
    { id: 'managerB2c', name: 'Менеджер B2C', scope: 'b2c', on: ['stock', 'prices', 'reserve', 'leads', 'clients', 'write', 'mail', 'sell', 'tasksAssign'] },
    { id: 'logist', name: 'Логист', on: ['stock', 'logistics', 'mail', 'tasksAssign', 'dispatch'] },
    { id: 'warehouse', name: 'Кладовщик', on: ['stock', 'receive', 'dispatch'] },
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

  // Своя роль директора: имя и права. Пустое или занятое имя → null.
  function addRole(st, name, perms) {
    const n = String(name || '').trim();
    if (!n) return null;
    st.roles = st.roles || [];
    if (st.roles.some(r => r.name.trim().toLowerCase() === n.toLowerCase())) return null;
    const role = { id: Store.freeId(st.roles, 'role'), name: n, builtin: false, perms: matrix(perms) };
    st.roles.push(role);
    return role;
  }

  const staff = n => n % 10 === 1 && n % 100 !== 11 ? 'сотрудник'
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'сотрудника' : 'сотрудников';

  // Удалить роль: встроенную нельзя, роль с людьми нельзя, пока их не переназначат.
  function removeRole(st, roleId) {
    const roles = st.roles || [];
    const role = roles.find(r => r.id === roleId);
    if (!role) return { ok: false, reason: 'Роль не найдена' };
    if (role.builtin) return { ok: false, reason: `Роль «${role.name}» встроенная — её нельзя удалить` };
    const n = (st.people || []).filter(p => p.role === roleId).length;
    if (n) return { ok: false, reason: `На роли «${role.name}» ${n} ${staff(n)} — сначала назначьте им другую роль` };
    st.roles = roles.filter(r => r.id !== roleId);
    return { ok: true, reason: '' };
  }

  return { LIST, defaultRoles, roleOf, can, addRole, removeRole };
})();
