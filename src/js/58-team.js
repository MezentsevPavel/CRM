// Раздел «Сотрудники и права»
// Перенесено из прототипа v2: люди и их роли, матрица прав. Роли — S.roles, права — Perms.LIST.

// ——— сотрудники и права ———
const isEngineer=p=>p.role==='engineer'||p.role==='chiefEngineer';
function vTeam(){
  const pick=S.roles.filter(r=>!r.all);
  const roleCell=p=>Perms.roleOf(S,p.id)?.all?esc(roleName(p)):`<select class="inp sm w-auto" id="pr-${esc(p.id)}" data-on="person-role" data-id="${esc(p.id)}" aria-label="Роль: ${esc(p.name)}">${pick.map(r=>`<option value="${esc(r.id)}" ${p.role===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select>`;
  const specCell=p=>isEngineer(p)?`<select class="inp sm w-auto" id="ps-${esc(p.id)}" data-on="person-spec" data-id="${esc(p.id)}" aria-label="Специализация: ${esc(p.name)}">${p.specialty?'':'<option value="">нет данных</option>'}${Object.entries(SPECIALTY).map(([k,v])=>`<option value="${k}" ${p.specialty===k?'selected':''}>${v}</option>`).join('')}</select>`:'<span class="muted">—</span>';
  if(SERVER) return teamServerHtml(roleCell,specCell)+roleMatrix(false);
  const emp=`<section class="card clip"><div class="card-h"><h3>Сотрудники</h3><span class="muted sm">${S.people.length} ${pl(S.people.length,'человек','человека','человек')}${S.people.some(p=>p.demo)?' · демо: примеры, не ваши сотрудники':''}</span></div><div class="xs"><table class="tbl"><thead><tr><th>Сотрудник</th><th>Отдел</th><th>Роль</th><th>Специализация</th><th></th></tr></thead><tbody>${S.people.map(p=>`<tr><td><span class="who">${av(p)}${esc(p.name)}${p.demo?' <span class="pill sm">демо</span>':''}</span></td><td>${esc(deptName(p.dept))}</td><td>${roleCell(p)}</td><td>${specCell(p)}</td><td class="num"><button class="btn sm ghost" data-act="view-as" data-id="${esc(p.id)}">${ic('eye')}Войти как</button></td></tr>`).join('')}</tbody></table></div></section>`;
  return emp+roleMatrix(false);
}

// Матрица «право × роль»: одна и на раздел «Сотрудники и права», и на вкладку «Настройки → Роли и права».
// Галочка меняет право сразу (ON.change.perm). Свою роль (не встроенную) можно удалить крестиком в шапке — withDel.
function roleMatrix(withDel){
  const head=r=>`<th class="c"><span class="mx-h">${esc(r.name)}${withDel&&!r.builtin?`<button type="button" class="btn ghost icon sm" data-act="role-del" data-id="${esc(r.id)}" title="Удалить роль" aria-label="Удалить роль «${esc(r.name)}»">${ic('x')}</button>`:''}</span>${r.builtin?'':'<small class="mx-own">своя роль</small>'}</th>`;
  const hint=SERVER&&!withDel
    ?'Галочки работают сразу и действуют на всех сотрудников этой роли. У директора права не снимаются. Свою роль добавляют в «Настройки → Роли и права».'
    :withDel
    ?'Галочки работают сразу. У директора права не снимаются. Встроенные роли удалить нельзя; свою роль можно удалить, когда на ней никого нет.'
    :'Галочки работают сразу. Попробуйте: снимите «Видеть цены и суммы» у менеджера B2B, затем вверху выберите менеджера B2B — колонка цен пропадёт. У директора права не снимаются. Свою роль добавляют в «Настройки → Роли и права».';
  return `<section class="card clip"><div class="card-h"><h3>Что может каждая роль</h3></div><div class="card-b"><p class="hint">${hint}</p></div><div class="xs"><table class="tbl matrix"><thead><tr><th>Право</th>${S.roles.map(head).join('')}</tr></thead><tbody>${Perms.LIST.map(([k,l])=>`<tr><td>${l}</td>${S.roles.map(r=>`<td class="c"><input type="checkbox" id="pm-${esc(r.id)}-${k}" data-on="perm" data-role="${esc(r.id)}" data-perm="${k}" ${r.all||r.perms[k]?'checked':''} ${r.all?'disabled':''} aria-label="${l} — ${esc(r.name)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}

// «Настройки → Роли и права» (вкладку добавляет 59-settings.js): матрица и «Добавить роль» — название и галочки.
function vRoles(){
  const add=`<section class="card"><div class="card-h"><h3>Добавить роль</h3></div><form data-form="role-add" class="card-b stack-s" novalidate>
    <div class="field"><label for="ra-name">Название роли</label><input id="ra-name" class="inp" maxlength="60" placeholder="Например: Бухгалтер" autocomplete="off"></div>
    <fieldset class="perm-grid"><legend>Что может эта роль</legend>${Perms.LIST.map(([k,l])=>`<label class="perm-opt"><input type="checkbox" id="ra-${k}" data-perm="${k}">${l}</label>`).join('')}</fieldset>
    <p class="hint">Права можно поменять потом в таблице выше. Назначить роль сотруднику — в разделе «Сотрудники и права».</p>
    <p class="err" id="ra-err" hidden></p>
    <div class="role-add-f"><button type="submit" class="btn pri">${ic('plus')}Добавить роль</button></div>
  </form></section>`;
  return roleMatrix(true)+add;
}

// ——— регистрация в реестрах оболочки ———
ON.change.perm=t=>{
  const r=S.roles.find(x=>x.id===t.dataset.role);
  if(!r||r.all||!(can('settings')||can('admin'))) return;
  r.perms[t.dataset.perm]=t.checked;
  const l=Perms.LIST.find(p=>p[0]===t.dataset.perm)?.[1]||t.dataset.perm;
  toast(`${r.name}: «${l}» — ${t.checked?'разрешено':'запрещено'}.`);
};
ON.change['person-role']=t=>{const p=person(t.dataset.id);p.role=t.value;render();toast(`${p.name} теперь ${roleName(p).toLowerCase()}.`)};
ON.change['person-spec']=t=>{const p=person(t.dataset.id);p.specialty=t.value;toast(`${p.name}: специализация — ${SPECIALTY[p.specialty]||'нет данных'}.`)};

// Новая роль: название и галочки прав (поля ra-<право>). Роль сразу в матрице и в выборе роли сотрудника.
FORMS['role-add']=()=>{
  const name=byId('ra-name').value,why=Perms.addBlock(S,name);
  if(why){byId('ra-name').focus?.();return showErr('ra-err',why)}
  const on=Perms.LIST.map(p=>p[0]).filter(k=>byId('ra-'+k).checked);
  const r=Perms.addRole(S,name,on);
  render();
  toast(`Роль «${r.name}» добавлена: ${on.length?on.length+' '+pl(on.length,'право','права','прав'):'пока без прав'}. Она уже в таблице и в выборе роли сотрудника.`);
};
// Удаление своей роли: сначала проверка (встроенную и роль с людьми не удалить — причина в сообщении), потом вопрос
A['role-del']=el=>{
  const why=Perms.removeBlock(S,el.dataset.id);
  if(why) return toast(why+'.','warn');
  openModal('roleDel',el.dataset.id);
};
MODALS.roleDel=id=>{
  const r=S.roles.find(x=>x.id===id);
  if(!r) return '';
  return `<form data-form="role-del" data-id="${esc(id)}" novalidate>${mHead('Удалить роль «'+esc(r.name)+'»?')}<div class="modal-b">
    <p class="m0">На этой роли никого нет. Таблица прав роли пропадёт; позже её можно завести заново.</p>
    <p class="err" id="rd-err" hidden></p></div>${mFoot('Удалить роль')}</form>`;
};
FORMS['role-del']=f=>{
  const r=S.roles.find(x=>x.id===f.dataset.id),res=Perms.removeRole(S,f.dataset.id);
  if(!res.ok) return showErr('rd-err',res.reason);
  closeModal();render();
  toast(`Роль «${r.name}» удалена.`);
};

// ——— серверный режим: вход сотрудников (раздел открыт только директору — право admin) ———
// Логины, пароли и сеансы живут на сервере (/api/users), в S их нет. Пароль придумывает сервер и показывает один раз.
function teamServerHtml(roleCell,specCell){
  if(!srv.users&&!srv.usersErr) srvUsersLoad();
  const u=pid=>srv.users?srv.users.get(pid)||null:null;
  const loginCell=p=>{
    if(!srv.users) return `<span class="muted">${esc(srv.usersErr||'загрузка…')}</span>`;
    const x=u(p.id);
    if(!x||!x.login) return '<span class="muted">нет входа</span>';
    return `<span class="mono">${esc(x.login)}</span>${x.disabled?' <span class="pill bad sm">отключён</span>':''}${x.mustChange&&!x.disabled?' <span class="pill sm">ждёт смены пароля</span>':''}`;
  };
  const btn=(act,p,label)=>`<button type="button" class="btn sm ghost" data-act="${act}" data-id="${esc(p.id)}">${label}</button>`;
  const acts=p=>{
    if(!srv.users) return '';
    const x=u(p.id),self=p.id===S.me,has=!!(x&&x.login);
    // себе пароль директор меняет сам («Сменить пароль»), себя не отключает
    return (self?'':btn('team-pass',p,'Выдать пароль'))+(has&&!self?btn(x.disabled?'team-on':'team-off',p,x.disabled?'Включить':'Отключить'):'')+(has?btn('team-logout',p,'Завершить сеансы'):'');
  };
  const rows=S.people.map(p=>`<tr><td><span class="who">${av(p)}${esc(p.name)}</span></td><td>${esc(deptName(p.dept))}</td><td>${roleCell(p)}</td><td>${specCell(p)}</td><td>${loginCell(p)}</td><td class="num nowrap">${acts(p)}</td></tr>`).join('');
  const pick=S.roles.filter(r=>!r.all);
  const add=`<section class="card"><div class="card-h"><h3>Новый сотрудник</h3></div><form data-form="team-add" class="card-b stack-s" novalidate>
    <div class="grid2"><div class="field"><label for="ta-name">Имя и фамилия</label><input id="ta-name" class="inp" maxlength="80" autocomplete="off"></div><div class="field"><label for="ta-login">Логин для входа</label><input id="ta-login" class="inp" maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Например: ivanov"></div></div>
    <div class="grid2"><div class="field"><label for="ta-dept">Отдел</label><select id="ta-dept" class="inp">${S.depts.map(d=>`<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></div><div class="field"><label for="ta-role">Роль</label><select id="ta-role" class="inp">${pick.map(r=>`<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></div></div>
    <p class="hint">Пароль CRM придумает сама и покажет один раз — передайте его сотруднику. При первом входе он задаст свой пароль.</p>
    <p class="err" id="ta-err" hidden></p>
    <div><button type="submit" class="btn pri">${ic('plus')}Добавить и выдать пароль</button></div>
  </form></section>`;
  return `<section class="card clip"><div class="card-h"><h3>Сотрудники</h3><span class="muted sm">${S.people.length} ${pl(S.people.length,'человек','человека','человек')}</span></div><div class="xs"><table class="tbl"><thead><tr><th>Сотрудник</th><th>Отдел</th><th>Роль</th><th>Специализация</th><th>Логин</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>${add}`;
}
const teamLoginTaken=(pid,login)=>!!srv.users&&[...srv.users.values()].some(x=>x.personId!==pid&&x.login===login.toLowerCase());
const teamLoginBad=login=>!login?'Придумайте логин для входа.':/\s/.test(login)?'Логин — без пробелов.':'';
// Логин (если новый или другой) и новый пароль → окно с паролем. → true, если выдан
async function teamIssue(pid,login){
  const x=srv.users&&srv.users.get(pid);
  if(!x||x.login!==login.toLowerCase()){
    const r=await srvUserAct(pid,'login',{login});
    if(r.status!==200){toast(r.body.error||'Логин не сохранён.','warn');srvUsersLoad();return false}
  }
  const r=await srvUserAct(pid,'password');
  if(r.status!==200){toast(r.body.error||'Пароль не выдан.','warn');srvUsersLoad();return false}
  srv.shown={name:person(pid)?.name||'',login:r.body.login||login,password:r.body.password};
  openModal('teamShown');
  srvUsersLoad();
  return true;
}
FORMS['team-add']=async()=>{
  const name=byId('ta-name').value.trim(),login=byId('ta-login').value.trim();
  if(!name) return showErr('ta-err','Напишите имя сотрудника.');
  const bad=teamLoginBad(login)||(teamLoginTaken('',login)?'Такой логин уже занят.':'');
  if(bad) return showErr('ta-err',bad);
  const id=Store.freeId(S.people,'p');
  S.people.push({id,name,role:byId('ta-role').value,dept:byId('ta-dept').value});
  render();
  await serverIdle();
  if(!(Docs.docId('people',id) in srv.confirmed)) return toast('Сотрудник не сохранён на сервере — проверьте связь и повторите.','warn');
  if(!await teamIssue(id,login)) toast(`${name} добавлен(а) без входа — задайте логин кнопкой «Выдать пароль».`,'warn');
};
A['team-pass']=el=>openModal('teamLogin',el.dataset.id);
MODALS.teamLogin=pid=>{
  const p=person(pid),x=srv.users&&srv.users.get(pid);
  if(!p) return `<div>${mHead('Сотрудник')}<div class="modal-b"><p class="m0">Сотрудника нет.</p></div></div>`;
  return `<form data-form="team-login" data-id="${esc(pid)}" novalidate>${mHead('Выдать пароль: '+esc(p.name))}<div class="modal-b">
    <div class="field"><label for="tl-login">Логин для входа</label><input id="tl-login" class="inp" maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(x&&x.login||'')}"></div>
    <p class="hint">CRM придумает новый пароль и покажет его один раз. Прежний пароль перестанет работать, открытые сеансы сотрудника закроются; при входе он задаст свой пароль.</p>
    <p class="err" id="tl-err" hidden></p></div>${mFoot('Выдать пароль')}</form>`;
};
FORMS['team-login']=async f=>{
  const pid=f.dataset.id,login=byId('tl-login').value.trim();
  const bad=teamLoginBad(login)||(teamLoginTaken(pid,login)?'Такой логин уже занят.':'');
  if(bad) return showErr('tl-err',bad);
  await teamIssue(pid,login);
};
// Пароль виден один раз: окно его показывает и забывает
MODALS.teamShown=()=>{
  const s=srv.shown;srv.shown=null;
  if(!s) return `<div>${mHead('Пароль')}<div class="modal-b"><p class="m0">Пароль уже был показан. Нужен новый — «Выдать пароль» ещё раз.</p></div></div>`;
  return `<div>${mHead('Пароль выдан: '+esc(s.name))}<div class="modal-b stack-s">
    <p class="m0">Логин: <b class="mono">${esc(s.login)}</b></p>
    <p class="m0">Пароль: <b class="mono srv-pw">${esc(s.password)}</b></p>
    <p class="warn-t m0">Пароль показан один раз — запишите и передайте сотруднику. Закроете окно — увидеть его снова нельзя, только выдать новый.</p>
  </div><div class="modal-f"><button type="button" class="btn pri" data-act="close-modal">Записал(а), закрыть</button></div></div>`;
};
// Отключить (сеансы закрываются, вход отклоняется, имя остаётся в истории) и включить обратно
async function teamDisable(pid,off){
  const p=person(pid),r=await srvUserAct(pid,'disable',{disabled:off});
  if(r.status!==200) return toast(r.body.error||'Не получилось.','warn');
  toast(off?`${p?.name||pid}: вход отключён, открытые сеансы закрыты.`:`${p?.name||pid}: вход снова включён.`);
  srvUsersLoad();
}
A['team-off']=el=>teamDisable(el.dataset.id,true);
A['team-on']=el=>teamDisable(el.dataset.id,false);
A['team-logout']=async el=>{
  const p=person(el.dataset.id),r=await srvUserAct(el.dataset.id,'logout');
  if(r.status!==200) return toast(r.body.error||'Не получилось.','warn');
  const n=r.body.closed||0;
  toast(n?`${p?.name||''}: завершено сеансов — ${n}. Войти снова можно по паролю.`:`${p?.name||''}: открытых сеансов не было.`);
  srvUsersLoad();
};
