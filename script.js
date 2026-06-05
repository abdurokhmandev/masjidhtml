/* ============================================================
   QIBLA FINDER — script.js (to'liq tuzatilgan versiya)
============================================================ */
const KAABA_LAT = 21.4225;
const KAABA_LON = 39.8262;

const findBtn       = document.getElementById('findBtn');
const needleWrap    = document.getElementById('needleWrap');
const compassLabel  = document.getElementById('compassLabel');
const kaabaOrbit    = document.getElementById('kaabaOrbit');
const statDirection = document.getElementById('statDirection');
const statDegree    = document.getElementById('statDegree');
const statNorth     = document.getElementById('statNorth');
const statLocation  = document.getElementById('statLocation');
const statsRow      = document.getElementById('statsRow');
const mapEl         = document.getElementById('map');
const mapHint       = document.getElementById('mapHint');
const themeToggle   = document.getElementById('themeToggle');
const motionNote    = document.getElementById('motionNote');
const compassRing   = document.getElementById('compassRing');

let leafMap = null;
let qiblaBearing = null;

/* ============================================================
   SMOOTHING — tebranishlarni kamaytirish uchun
   Exponential moving average (EMA) burchaklar uchun
============================================================ */
const ALPHA = 0.12; // kichikroq = tekisroq, lekin sekinroq | 0.1-0.2 ideal
let smoothedHeading = null;

function smoothAngle(current, target) {
  if (current === null) return target;
  // Burchak "o'rash" muammosini hal qilish (359° → 1° bo'lganda qisqa yo'l)
  let diff = target - current;
  if (diff > 180)  diff -= 360;
  if (diff < -180) diff += 360;
  return (current + ALPHA * diff + 360) % 360;
}

/* ============================================================
   COMPASS TICKS (SVG)
============================================================ */
(function drawTicks() {
  const g = document.getElementById('ticks');
  if (!g) return;
  const cx = 130, cy = 130, r = 125;
  for (let i = 0; i < 72; i++) {
    const angle   = (i * 5) * Math.PI / 180;
    const isMajor = i % 9 === 0;
    const isMed   = i % 3 === 0;
    const len     = isMajor ? 12 : isMed ? 8 : 5;
    const x1 = cx + (r - 2) * Math.sin(angle);
    const y1 = cy - (r - 2) * Math.cos(angle);
    const x2 = cx + (r - 2 - len) * Math.sin(angle);
    const y2 = cy - (r - 2 - len) * Math.cos(angle);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('stroke', isMajor ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)');
    line.setAttribute('stroke-width', isMajor ? '2' : '1');
    line.setAttribute('stroke-linecap', 'round');
    g.appendChild(line);
  }
})();

/* ============================================================
   MATH
============================================================ */
function degToRad(d) { return d * Math.PI / 180; }
function radToDeg(r) { return r * 180 / Math.PI; }

function calcQibla(lat, lon) {
  const φ1 = degToRad(lat),  λ1 = degToRad(lon);
  const φ2 = degToRad(KAABA_LAT), λ2 = degToRad(KAABA_LON);
  const Δλ = λ2 - λ1;
  const x  = Math.sin(Δλ);
  const y  = Math.cos(φ1) * Math.tan(φ2) - Math.sin(φ1) * Math.cos(Δλ);
  return ((radToDeg(Math.atan2(x, y)) % 360) + 360) % 360;
}

function bearingLabel(deg) {
  const dirs = ['Shimol','Sh-Sharq','Sharq','J-Sharq','Janub','J-G\'arb','G\'arb','Sh-G\'arb'];
  return dirs[Math.round(deg / 45) % 8];
}

/* ============================================================
   DISPLAY UPDATE — igna + Ka'ba + halqa
============================================================ */
function updateCompassDisplay(deviceHeading) {
  if (qiblaBearing === null) return;

  // Halqa — qurilma yo'nalishiga qarab teskari aylanadi (shimol har doim yuqorida)
  compassRing.style.transform = `rotate(${-deviceHeading}deg)`;

  // Igna va Ka'ba — qibla burchagida turadi (qurilma hisobga olinib)
  const needleAngle = qiblaBearing - deviceHeading;
  needleWrap.style.transform  = `rotate(${needleAngle}deg)`;
  kaabaOrbit.style.transform  = `rotate(${needleAngle}deg)`;
}

/* ============================================================
   DEVICE ORIENTATION — to'liq qayta yozildi
   
   Muammo 1: Android da alpha = ekran rotatsiyasi, shimol emas.
             Lekin absolute=true bo'lsa, alpha = haqiqiy shimoldan burchak.
   
   Muammo 2: Qurilma gorizontal/vertikal ushlanganda burchak o'zgaradi.
             beta (old-orqa egilish) va gamma (chap-o'ng egilish) ni
             hisobga olish kerak.
   
   Muammo 3: Tez harakatda titroq — EMA smoothing bilan hal qilinadi.
============================================================ */
let orientationListenerActive = false;

function computeTrueHeading(e) {
  // --- iOS: webkitCompassHeading to'g'ridan-to'g'ri shimolga nisbatan daraja ---
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
    return e.webkitCompassHeading;
  }

  // --- Android (absolute orientation events) ---
  // alpha: qurilma Z o'qi atrofida aylanish (0-360, shimolga nisbatan)
  // beta:  qurilma X o'qi atrofida egilish (-180..180, oldingaorqa)
  // gamma: qurilma Y o'qi atrofida egilish (-90..90, chap-o'ng)
  const alpha = e.alpha;
  const beta  = e.beta;
  const gamma = e.gamma;

  if (alpha === null || alpha === undefined) return null;

  // Qurilma orientatsiyasiga qarab tuzatish
  // Agar telefon tekis yotsa (beta≈0, gamma≈0) — alpha ni to'g'ridan ishlatish mumkin
  // Agar tik tutilsa (beta≈90) — boshqa formula kerak
  const rad = Math.PI / 180;
  const b = (beta  || 0) * rad;
  const g = (gamma || 0) * rad;
  const a = alpha * rad;

  // Kompas shimol uchun tuzatish (qurilma og'ishi hisobga olinadi)
  // Bu formulasi telefon tik (portrait) tutilganda to'g'ri ishlaydi
  const cosB = Math.cos(b);
  const sinB = Math.sin(b);
  const cosG = Math.cos(g);
  const sinG = Math.sin(g);
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);

  // X, Y, Z o'qlari bo'yicha magnit vektori
  const Bx = cosA * cosG + sinA * sinB * sinG;
  const By = sinA * cosG - cosA * sinB * sinG;

  let heading = radToDeg(Math.atan2(-By, Bx));
  heading = (heading + 360) % 360;

  return heading;
}

function handleOrientation(e) {
  const rawHeading = computeTrueHeading(e);
  if (rawHeading === null) return;

  // EMA smoothing — tez harakatda siltanishni oldini oladi
  smoothedHeading = smoothAngle(smoothedHeading, rawHeading);

  updateCompassDisplay(smoothedHeading);

  if (motionNote.style.display === 'none') {
    motionNote.style.display = 'block';
  }
}

/* ============================================================
   ORIENTATION PERMISSION & START
============================================================ */
function startOrientation() {
  if (typeof DeviceOrientationEvent === 'undefined') return;
  if (orientationListenerActive) return;

  function addListener() {
    // Android: deviceorientationabsolute = haqiqiy shimolga nisbatan (ustunlik berish)
    if ('ondeviceorientationabsolute' in window) {
      window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    }
    // Qo'shimcha ravishda oddiy deviceorientation ham tinglash (iOS + eski Android)
    window.addEventListener('deviceorientation', handleOrientation, true);
    orientationListenerActive = true;
  }

  // iOS 13+ ruxsat so'rash
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          addListener();
        } else {
          compassLabel.textContent = '🔒 Kompas uchun ruxsat berilmadi. Brauzer sozlamalarini tekshiring.';
        }
      })
      .catch(() => { addListener(); }); // ruxsat muammosi bo'lsa ham sinab ko'rish
  } else {
    addListener();
  }
}

/* ============================================================
   STATS UPDATE
============================================================ */
function updateStats(bearing, lat, lon, locationName) {
  statDirection.textContent = bearingLabel(bearing);
  statDegree.textContent    = `${Math.round(bearing)}°`;
  statNorth.textContent     = `0°`;
  statLocation.textContent  = locationName || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  statsRow.querySelectorAll('.stat-card').forEach(c => c.classList.add('active'));
}

/* ============================================================
   REVERSE GEOCODE
============================================================ */
async function reverseGeocode(lat, lon) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'Accept-Language': 'uz,en' } }
    );
    const d = await r.json();
    const addr = d.address || {};
    return addr.city || addr.town || addr.village || addr.county || addr.country || null;
  } catch {
    return null;
  }
}

/* ============================================================
   MAP
============================================================ */
function initMap(lat, lon) {
  mapHint.style.display = 'none';
  mapEl.style.display   = 'block';

  if (!leafMap) {
    leafMap = L.map('map', { zoomControl: true, attributionControl: false })
               .setView([lat, lon], 5);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_matter_no_labels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 18
    }).addTo(leafMap);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_matter_only_labels/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd', maxZoom: 18, opacity: 0.7
    }).addTo(leafMap);
  } else {
    leafMap.setView([lat, lon], 5);
    leafMap.eachLayer(l => {
      if (l._qiblaLine || l._userMarker || l._kaabaMarker) leafMap.removeLayer(l);
    });
  }

  const line = L.polyline([[lat, lon], [KAABA_LAT, KAABA_LON]], {
    color: '#f59e0b', weight: 2.5, opacity: 0.85, dashArray: '8 5'
  });
  line._qiblaLine = true;
  line.addTo(leafMap);

  const userIcon = L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;background:#3b82f6;border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 4px rgba(59,130,246,0.3)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7]
  });
  const um = L.marker([lat, lon], { icon: userIcon });
  um._userMarker = true;
  um.addTo(leafMap).bindPopup('<b>📍 Siz shu yerdasiz</b>').openPopup();

  const kaabaIcon = L.divIcon({
    className: '',
    html: `<div style="font-size:22px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.6))">🕋</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14]
  });
  const km = L.marker([KAABA_LAT, KAABA_LON], { icon: kaabaIcon });
  km._kaabaMarker = true;
  km.addTo(leafMap).bindPopup("<b>🕋 Ka'ba – Makka</b>");

  leafMap.fitBounds([[lat, lon], [KAABA_LAT, KAABA_LON]], { padding: [40, 40] });
}

/* ============================================================
   GEOLOCATION
============================================================ */
async function handleSuccess(pos) {
  const { latitude: lat, longitude: lon } = pos.coords;
  const bearing = calcQibla(lat, lon);
  qiblaBearing  = bearing;

  // Dastlab qurilma yo'nalishisiz ko'rsatish (shimolni 0° deb)
  updateCompassDisplay(smoothedHeading || 0);
  compassLabel.textContent = `🕌 Qibla: ${Math.round(bearing)}° — ${bearingLabel(bearing)} tomoni`;

  initMap(lat, lon);

  const locationName = await reverseGeocode(lat, lon);
  updateStats(bearing, lat, lon, locationName);

  findBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    Aniqlandi!
  `;
  findBtn.classList.remove('loading');
  findBtn.style.background = 'linear-gradient(135deg,#10b981,#059669)';

  // Kompas sensorini ishga tushirish (joylashuv aniqlanganidan keyin)
  startOrientation();
}

function handleError(err) {
  findBtn.classList.remove('loading');
  findBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
    Qiblani Topish
  `;
  const msgs = {
    1: '🚫 Geolokatsiya ruxsati rad etildi.',
    2: '📍 Joylashuvni aniqlab bo\'lmadi.',
    3: '⌛ Vaqt tugadi. Qaytadan urinib ko\'ring.',
  };
  compassLabel.textContent = msgs[err.code] || '❓ Noma\'lum xato yuz berdi.';
}

/* ============================================================
   BUTTON
============================================================ */
findBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    compassLabel.textContent = '❌ Brauzeringiz geolokatsiyani qo\'llab-quvvatlamaydi.';
    return;
  }
  findBtn.classList.add('loading');
  findBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite">
      <path d="M21 12a9 9 0 11-6.219-8.56"/>
    </svg>
    Aniqlanmoqda…
  `;
  compassLabel.textContent = '⏳ Joylashuvingiz aniqlanmoqda…';
  navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
    timeout: 12000,
    enableHighAccuracy: true
  });
});

/* ============================================================
   THEME TOGGLE
============================================================ */
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
let isLight = !prefersDark;
if (isLight) document.body.classList.add('light-mode');

themeToggle.addEventListener('click', () => {
  isLight = !isLight;
  document.body.classList.toggle('light-mode', isLight);
  if (leafMap) {
    leafMap.eachLayer(l => { if (l._url) leafMap.removeLayer(l); });
    const tileUrl = isLight
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_matter_no_labels/{z}/{x}/{y}{r}.png';
    L.tileLayer(tileUrl, { subdomains: 'abcd', maxZoom: 18 }).addTo(leafMap);
  }
});

/* ============================================================
   CSS ANIMATION
============================================================ */
const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes spin { to { transform: rotate(360deg); } }
  .compass-ring  { transition: transform 0.08s linear; }
  .needle-wrap   { transition: transform 0.08s linear; }
  .kaaba-orbit   { transition: transform 0.08s linear; }
`;
document.head.appendChild(styleEl);
