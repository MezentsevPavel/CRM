// Запуск. Демо: состояние из браузера (localStorage[Store.KEY]); нет или битое — демо seed(), затем первая отрисовка.
// Серверный режим: вход и состояние с сервера — serverBoot() (72-server.js).

if(SERVER) serverBoot();
else{
  S=startState();
  render();
}
