// Раздел «Сообщения клиентам»
// Перенесено из прототипа v2. Сообщение называет сделку и клиента, поэтому журнал и пример шаблона — только по сделкам,
// которые видит человек (Leads.dealsVisible): менеджер B2B не видит переписку с клиентами B2C.

// ——— сообщения клиентам ———
const msgDeals=()=>new Set(Leads.dealsVisible(S,S.me).map(d=>d.id));
// Сделка для примера шаблона: Д-318, если она видна, иначе первая видимая; видимых нет — примера нет
const tplDeal=()=>{const vis=msgDeals();return vis.has('Д-318')?deal('Д-318'):S.deals.find(d=>vis.has(d.id))||null};
function tplSample(){const d=tplDeal();return d?`${fillTpl(d,'контроллер заряда MPPT 60 А — 1 шт',true)}<small>${CH[S.ui.tplCh]} · авто</small>`:'<span class="muted">Пример появится, когда у вас будет сделка.</span>'}
const tplHead=()=>{const d=tplDeal();return `Так увидит клиент в ${CH[S.ui.tplCh]}${d?' · пример по сделке '+d.id:''}`};
function vMessages(){
  const ed=can('auto'),vis=msgDeals();
  const rules=`<section class="card"><div class="card-h"><h3>Правила: когда и что делаем</h3>${ed?'':'<span class="pill sm">менять может директор</span>'}</div><ul class="rules">${S.rules.map(r=>`<li class="rule"><label class="sw"><input type="checkbox" id="rule-${r.id}" data-on="rule" data-id="${r.id}" ${r.on?'checked':''} ${ed?'':'disabled'} aria-label="${esc(r.when)}"><span class="sw-t" aria-hidden="true"></span></label><div><p><b>Когда:</b> ${esc(r.when)}</p><p><b>Делаем:</b> ${esc(r.then)}</p></div></li>`).join('')}</ul></section>`;
  const tpl=`<section class="card"><div class="card-h"><h3>Шаблон «Товар пришёл на склад»</h3><div class="seg">${['telegram','max'].map(c=>`<button class="${S.ui.tplCh===c?'on':''}" data-act="tpl-ch" data-ch="${c}">${CH[c]}</button>`).join('')}</div></div><div class="card-b tpl-grid"><div class="stack-s"><div class="field"><label for="tpl">Текст сообщения</label><textarea id="tpl" class="inp" rows="6" data-on="tpl" ${ed?'':'disabled'}>${esc(S.tpl)}</textarea></div><div class="vars"><span>Вставить:</span>${VARS.map(v=>`<button class="chip" data-act="ins-var" data-v="${v}" ${ed?'':'disabled'}>${v}</button>`).join('')}</div><div class="field"><label for="addr">Адрес склада для сообщений</label><input id="addr" class="inp" data-on="addr" value="${esc(S.address)}" placeholder="Нет данных — впишите адрес склада" ${ed?'':'disabled'}></div></div><div><p class="prev-h" id="tpl-h">${esc(tplHead())}</p><div class="chat"><div class="bub out" id="tpl-prev">${tplSample()}</div></div></div></div></section>`;
  const log=`<section class="card clip"><div class="card-h"><h3>Журнал сообщений</h3><span class="pill sun sm">прототип: сообщения не отправляются</span></div><div class="xs"><table class="tbl"><thead><tr><th>Когда</th><th>Клиент</th><th>Канал</th><th>Сообщение</th><th>Кто</th></tr></thead><tbody>${S.msgs.filter(x=>vis.has(x.deal)).sort((a,b)=>b.at-a.at).map(x=>{const d=deal(x.deal);return `<tr><td class="nowrap">${fWhen(x.at)}</td><td><div class="pname"><span>${esc(d?.client||'')}</span><small class="mono">${x.deal}</small></div></td><td>${chPill(x.channel)}</td><td class="msg-cell">${esc(x.text)}</td><td class="nowrap">${x.inbound?'<span class="pill sm">ответ клиента</span>':x.auto?'<span class="pill violet sm">авто</span>':esc(person(x.by)?.name||'')}</td></tr>`}).join('')}</tbody></table></div></section>`;
  return rules+tpl+log;
}
function updTpl(){const p=byId('tpl-prev');if(p) p.innerHTML=tplSample();const h=byId('tpl-h');if(h) h.textContent=tplHead()}

// ——— регистрация в реестрах оболочки ———
ON.input.tpl=t=>{S.tpl=t.value;updTpl()};
ON.input.addr=t=>{S.address=t.value;updTpl()};
// Текст пишут по буквам и сохраняют сами; когда закончили (поле потеряло фокус) — короткое подтверждение
ON.change.tpl=()=>toast('Шаблон сообщения сохранён.');
ON.change.addr=()=>toast('Адрес склада сохранён.');
ON.change.rule=t=>{const r=rule(t.dataset.id);r.on=t.checked;toast(`Правило «${r.when}» ${r.on?'включено':'выключено'}.`)};
