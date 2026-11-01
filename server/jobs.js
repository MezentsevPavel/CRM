'use strict';
// Задачи сервера раз в минуту. Напоминания о делах (Acts.notify) и «лид ждёт» (Leads.notifyWaiting) в рабочей версии
// делает только сервер — по одному, сколько бы вкладок ни было открыто; браузер их не запускает. Здесь же обслуживание:
// истёкшие сеансы, забытые вкладки, старые попытки входа, брошенные и давно удалённые файлы.

const MINUTE = 60e3;

function createJobs({ sync, core, auth, files, now, onClosed }) {
  // Есть ли что разослать — дёшево, без копии состояния
  function due(st, at) {
    if (core.Acts.due(st, at).length) return true;
    return (st.leads || []).some(l => !l.waitNoted && core.Leads.waiting(st, l, at) !== null);
  }

  function notifyTick() {
    sync.fresh();
    const at = new Date(now());
    if (!due(sync.state, at)) return 0;
    return sync.system(work => [...core.Acts.notify(work, at), ...core.Leads.notifyWaiting(work, at)].length);
  }

  function tick() {
    let made = 0;
    try { made = notifyTick(); } catch (e) { console.error('Уведомления по времени не разосланы:', e.message); }
    try {
      const closed = auth.sweep();
      sync.sweepViews(closed);
      if (closed.length && onClosed) onClosed(closed);
      files.sweep();
    } catch (e) { console.error('Обслуживание не выполнено:', e.message); }
    return made;
  }

  let timer = null;
  function start() {
    if (timer) return;
    timer = setInterval(tick, MINUTE);
    timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { tick, start, stop };
}

module.exports = { createJobs };
