// Раздел «Сотрудники и права»
// Перенесено из прототипа v2: люди и их роли, матрица прав. Роли — S.roles, права — Perms.LIST.

// ——— сотрудники и права ———
const isEngineer=p=>p.role==='engineer'||p.role==='chiefEngineer';
function vTeam(){
  const pick=S.roles.filter(r=>!r.all);
  const roleCell=p=>Perms.roleOf(S,p.id)?.all?esc(roleName(p)):`<select class="inp sm w-auto" id="pr-${esc(p.id)}" data-on="person-role" data-id="${esc(p.id)}" aria-label="Роль: ${esc(p.name)}">${pick.map(r=>`<option value="${esc(r.id)}" ${p.role===r.id?'selected':''}>${esc(r.name)}</option>`).join('')}</select>`;
  const specCell=p=>isEngineer(p)?`<select class="inp sm w-auto" id="ps-${esc(p.id)}" data-on="person-spec" data-id="${esc(p.id)}" aria-label="Специализация: ${esc(p.name)}">${p.specialty?'':'<option value="">нет данных</option>'}${Object.entries(SPECIALTY).map(([k,v])=>`<option value="${k}" ${p.specialty===k?'selected':''}>${v}</option>`).join('')}</select>`:'<span class="muted">—</span>';
  const emp=`<section class="card clip"><div class="card-h"><h3>Сотрудники</h3><span class="muted sm">${S.people.length} ${pl(S.people.length,'человек','человека','человек')}${S.people.some(p=>p.demo)?' · демо: примеры, не ваши сотрудники':''}</span></div><div class="xs"><table class="tbl"><thead><tr><th>Сотрудник</th><th>Отдел</th><th>Роль</th><th>Специализация</th><th></th></tr></thead><tbody>${S.people.map(p=>`<tr><td><span class="who">${av(p)}${esc(p.name)}${p.demo?' <span class="pill sm">демо</span>':''}</span></td><td>${esc(deptName(p.dept))}</td><td>${roleCell(p)}</td><td>${specCell(p)}</td><td class="num"><button class="btn sm ghost" data-act="view-as" data-id="${esc(p.id)}">${ic('eye')}Войти как</button></td></tr>`).join('')}</tbody></table></div></section>`;
  const mx=`<section class="card clip"><div class="card-h"><h3>Что может каждая роль</h3></div><div class="card-b"><p class="hint">Галочки работают сразу. Попробуйте: снимите «Видеть цены и суммы» у менеджера B2B, затем вверху выберите менеджера B2B — колонка цен пропадёт. У директора права не снимаются.</p></div><div class="xs"><table class="tbl matrix"><thead><tr><th>Право</th>${S.roles.map(r=>`<th class="c">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>${Perms.LIST.map(([k,l])=>`<tr><td>${l}</td>${S.roles.map(r=>`<td class="c"><input type="checkbox" id="pm-${esc(r.id)}-${k}" data-on="perm" data-role="${esc(r.id)}" data-perm="${k}" ${r.all||r.perms[k]?'checked':''} ${r.all?'disabled':''} aria-label="${l} — ${esc(r.name)}"></td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
  return emp+mx;
}
