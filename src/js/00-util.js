// Общие помощники: даты, числа, экранирование, иконки
// Перенесено из прототипа v2 без изменений логики.

// ——— даты и форматы ———
const DAY=864e5;
const T0=(()=>{const d=new Date();d.setHours(0,0,0,0);return d})();
const day=(n,h=10,m=0)=>{const d=new Date(T0);d.setDate(d.getDate()+n);d.setHours(h,m,0,0);return d};
const MON=['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
const MONF=['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const WD=['вс','пн','вт','ср','чт','пт','сб'];
const WDF=['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота'];
const sod=d=>{const x=new Date(d);x.setHours(0,0,0,0);return x};
const dd=d=>Math.round((sod(d)-T0)/DAY);
const fD=d=>{d=new Date(d);return d.getDate()+' '+MON[d.getMonth()]};
const fRel=d=>{const n=dd(d);return n===0?'сегодня':n===1?'завтра':n===-1?'вчера':fD(d)};
const fT=d=>{d=new Date(d);return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')};
const fWhen=d=>fRel(d)+', '+fT(d);
const iso=d=>{d=new Date(d);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const fromIso=(s,h=12)=>{const [y,m,x]=s.split('-').map(Number);return new Date(y,m-1,x,h)};
const num=n=>Number(n).toLocaleString('ru-RU');
const rub=n=>num(Math.round(n))+' ₽';
const mln=n=>n>=1e6?(n/1e6).toLocaleString('ru-RU',{maximumFractionDigits:2})+' млн ₽':rub(n);
const pl=(n,a,b,c)=>{const x=Math.abs(n)%100,y=x%10;return x>10&&x<20?c:y>1&&y<5?b:y===1?a:c};
const days=n=>n+' '+pl(n,'день','дня','дней');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const low=s=>/^[А-ЯЁA-Z][а-яёa-z]/.test(s)?s.charAt(0).toLowerCase()+s.slice(1):s;
let _n=100;const uid=p=>p+(++_n);
const $=s=>document.querySelector(s);
const byId=id=>document.getElementById(id);

// ——— иконки ———
const IC={
  home:'<path d="M3.5 10.5 12 4l8.5 6.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  tasks:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  box:'<path d="M3.5 7.5 12 3.5l8.5 4-8.5 4z"/><path d="M3.5 7.5v9l8.5 4 8.5-4v-9"/><path d="M12 11.5v9"/>',
  truck:'<path d="M2.5 6.5h11v9.5h-11z"/><path d="M13.5 9.5h4l3.5 3.5v3h-7.5"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  camera:'<path d="M4 8h3l1.8-2.5h6.4L17 8h3v11H4z"/><circle cx="12" cy="13.2" r="3.4"/>',
  users:'<circle cx="9" cy="8" r="3.3"/><path d="M2.8 19.5c.8-3.4 3.2-5.2 6.2-5.2s5.4 1.8 6.2 5.2"/><path d="M15.5 4.8a3.3 3.3 0 0 1 0 6.4"/><path d="M17.8 14.6c1.8.6 3 2.3 3.4 4.9"/>',
  chat:'<path d="M4 5h16v11H9.5L5 19.5V16H4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  bell:'<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  shield:'<path d="M12 3.5 19.5 6v5.5c0 4.3-3.1 7.8-7.5 9-4.4-1.2-7.5-4.7-7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  photo:'<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9 8"/>',
  check:'<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert:'<path d="M12 4 21 19.5H3z"/><path d="M12 10v4.5M12 17v.4"/>',
  arrow:'<path d="M5 12h14M13 6l6 6-6 6"/>',
  pin:'<path d="M12 21s6.5-5.8 6.5-11.2a6.5 6.5 0 0 0-13 0C5.5 15.2 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>',
  lock:'<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  send:'<path d="M4 11.5 20 4l-5.5 16-3-6.5z"/><path d="m11.5 13.5 8.5-9.5"/>',
  eye:'<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
};
const ic=(n,c='')=>`<svg class="ic ${c}" viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;
