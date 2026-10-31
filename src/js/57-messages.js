// Раздел «Сообщения клиентам»
// Перенесено из прототипа v2 без изменений логики.

// ——— сообщения клиентам ———
function tplSample(){const d=deal('Д-318');return d?`${fillTpl(d,'контроллер заряда MPPT 60 А — 1 шт',true)}<small>${CH[S.ui.tplCh]} · авто</small>`:''}
function vMessages(){
  const ed=can('auto');
  const rules=`<section class="card"><div class="card-h"><h3>Правила: когда и что делаем</h3>${ed?'':'<span class="pill sm">менять может директор</span>'}</div><ul class="rules">${S.rules.map(r=>`<li class="rule"><label class="sw"><input type="checkbox" id="rule-${r.id}" data-on="rule" data-id="${r.id}" ${r.on?'checked':''} ${ed?'':'disabled'} aria-label="${esc(r.when)}"><span class="sw-t" aria-hidden="true"></span></label><div><p><b>Когда:</b> ${esc(r.when)}</p><p><b>Делаем:</b> ${esc(r.then)}</p></div></li>`).join('')}</ul></section>`;
  const tpl=`<section class="card"><div class="card-h"><h3>Шаблон «Товар пришёл на склад»</h3><div class="seg">${['telegram','max'].map(c=>`<button class="${S.ui.tplCh===c?'on':''}" data-act="tpl-ch" data-ch="${c}">${CH[c]}</button>`).join('')}</div></div><div class="card-b tpl-grid"><div class="stack-s"><div class="field"><label for="tpl">Текст сообщения</label><textarea id="tpl" class="inp" rows="6" data-on="tpl" ${ed?'':'disabled'}>${esc(S.tpl)}</textarea></div><div class="vars"><span>Вставить:</span>${VARS.map(v=>`<button class="chip" data-act="ins-var" data-v="${v}" ${ed?'':'disabled'}>${v}</button>`).join('')}</div><div class="field"><label for="addr">Адрес склада для сообщений</label><input id="addr" class="inp" data-on="addr" value="${esc(S.address)}" placeholder="Нет данных — впишите адрес склада" ${ed?'':'disabled'}></div></div><div><p class="prev-h" id="tpl-h">Так увидит клиент в ${CH[S.ui.tplCh]} · пример по сделке Д-318</p><div class="chat"><div class="bub out" id="tpl-prev">${tplSample()}</div></div></div></div></section>`;
  const log=`<section class="card clip"><div class="card-h"><h3>Журнал сообщений</h3><span class="pill sun sm">прототип: сообщения не отправляются</span></div><div class="xs"><table class="tbl"><thead><tr><th>Когда</th><th>Клиент</th><th>Канал</th><th>Сообщение</th><th>Кто</th></tr></thead><tbody>${S.msgs.slice().sort((a,b)=>b.at-a.at).map(x=>{const d=deal(x.deal);return `<tr><td class="nowrap">${fWhen(x.at)}</td><td><div class="pname"><span>${esc(d?.client||'')}</span><small class="mono">${x.deal}</small></div></td><td>${chPill(x.channel)}</td><td class="msg-cell">${esc(x.text)}</td><td class="nowrap">${x.inbound?'<span class="pill sm">ответ клиента</span>':x.auto?'<span class="pill violet sm">авто</span>':esc(person(x.by)?.name||'')}</td></tr>`}).join('')}</tbody></table></div></section>`;
  return rules+tpl+log;
}
function updTpl(){const p=byId('tpl-prev');if(p) p.innerHTML=tplSample();const h=byId('tpl-h');if(h) h.textContent=`Так увидит клиент в ${CH[S.ui.tplCh]} · пример по сделке Д-318`}

// ——— регистрация в реестрах оболочки ———
ON.input.tpl=t=>{S.tpl=t.value;updTpl()};
ON.input.addr=t=>{S.address=t.value;updTpl()};
ON.change.rule=t=>{const r=rule(t.dataset.id);r.on=t.checked;toast(`Правило «${r.when}» ${r.on?'включено':'выключено'}.`)};
