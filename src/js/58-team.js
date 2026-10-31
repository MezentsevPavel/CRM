// Раздел «Сотрудники и права»
// Перенесено из прототипа v2: люди и их роли, матрица прав. Роли — S.roles, права — Perms.LIST.

// ——— сотрудники и права ———
const isEngineer=p=>p.role==='engineer'||p.role==='chiefEngineer';
function vTeam(){
  const pick=S.roles.filter(r=>!r.all);
  const roleCell=p=>Perms.roleOf(S,p.id)?.all?esc(roleName(p)):`<select class="inp sm w-auto" id="pr-${esc(p.id)}" data-on="person-role" data-id="${esc(p.id)}" aria-label="Роль: ${esc(p.name)}">${pick.map(r=>`<option value="${esc(r.id)}" ${p.role===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select>`;
  const specCell=p=>isEngineer(p)?`<select class="inp sm w-auto" id="ps-${esc(p.id)}" data-on="person-spec" data-id="${esc(p.id)}" aria-label="Специализация: ${esc(p.name)}">${p.specialty?'':'<option value="">нет данных</option>'}${Object.entries(SPECIALTY).map(([k,v])=>`<option value="${k}" ${p.specialty===k?'selected':''}>${v}</option>`).join('')}</select>`:'<span class="muted">—</span>';
  const emp=`<section class="card clip"><div class="card-h"><h3>Сотрудники</h3><span class="muted sm">${S.people.length} ${pl(S.people.length,'человек','человека','человек')}${S.people.some(p=>p.demo)?' · демо: примеры, не ваши сотрудники':''}</span></div><div class="xs"><table class="tbl"><thead><tr><th>Сотрудник</th><th>Отдел</th><th>Роль</th><th>Специализация</th><th></th></tr></thead><tbody>${S.people.map(p=>`<tr><td><span class="who">${av(p)}${esc(p.name)}${p.demo?' <span class="pill sm">демо</span>':''}</span></td><td>${esc(deptName(p.dept))}</td><td>${roleCell(p)}</td><td>${specCell(p)}</td><td class="num"><button class="btn sm ghost" data-act="view-as" data-id="${esc(p.id)}">${ic('eye')}Войти как</button></td></tr>`).join('')}</tbody></table></div></section>`;
  return emp+roleMatrix(false);
}

// Матрица «право × роль»: одна и на раздел «Сотрудники и права», и на вкладку «Настройки → Роли и права».
// Галочка меняет право сразу (ON.change.perm). Свою роль (не встроенную) можно удалить крестиком в шапке — withDel.
function roleMatrix(withDel){
  const head=r=>`<th class="c"><span class="mx-h">${esc(r.name)}${withDel&&!r.builtin?`<button type="button" class="btn ghost icon sm" data-act="role-del" data-id="${esc(r.id)}" title="Удалить роль" aria-label="Удалить роль «${esc(r.name)}»">${ic('x')}</button>`:''}</span>${r.builtin?'':'<small class="mx-own">своя роль</small>'}</th>`;
  const hint=withDel
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
