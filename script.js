/* ============================================================
   QIBLA FINDER — script.js  (yangilangan versiya)
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
let deviceHeading = 0;

/* ============================================================
   COMPASS TICKS (SVG)
============================================================ */
(function drawTicks() {
  const g = document.getElementById('ticks');
  if (!g) return;
  const cx = 130, cy = 130, r = 125;
  for (let i = 0; i < 72; i++) {
    const angle    = (i * 5) * Math.PI / 180;
    const isMajor  = i % 9 === 0;
    const isMed    = i % 3 === 0;
    const len      = isMajor ? 12 : isMed ? 8 : 5;
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
function updateCompassDisplay() {
  if (qiblaBearing === null) return;

  // Halqa (ticks, N/S/E/W) — qurilma yo'nalishiga qarab teskari aylanadi
  compassRing.style.transform = `rotate(${-deviceHeading}deg)`;

  // Igna — haqiqiy qibla yo'nalishini ko'rsatadi (deviceHeading hisobga olinib)
  const needleAngle = qiblaBearing - deviceHeading;
  needleWrap.style.transform = `rotate(${needleAngle}deg)`;

  // Ka'ba belgisi — ignaning uchida, shu burchakda aylanadi
  kaabaOrbit.style.transform = `rotate(${needleAngle}deg)`;
}

function rotateNeedle(bearing) {
  qiblaBearing = bearing;
  updateCompassDisplay();
}

/* ============================================================
   DEVICE ORIENTATION (kompas sensori)
============================================================ */
function handleOrientation(e) {
  let heading = null;

  // iOS: webkitCompassHeading — to'g'ridan-to'g'ri shimolga nisbatan daraja
  if (typeof e.webkitCompassHeading === 'number') {
    heading = e.webkitCompassHeading;
  }
  // Android: alpha — ekran yo'nalishi, 360 - alpha = shimol
  else if (e.alpha !== null && e.alpha !== undefined) {
    heading = (360 - e.alpha + 360) % 360;
  }

  if (heading !== null) {
    deviceHeading = heading;
    updateCompassDisplay();
    motionNote.style.display = 'block';
  }
}

function startOrientation() {
  if (typeof DeviceOrientationEvent === 'undefined') return;

  // iOS 13+ — ruxsat so'rash kerak
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(state => {
        if (state === 'granted') {
          window.addEventListener('deviceorientation', handleOrientation, true);
        }
      })
      .catch(() => {});
  } else {
    window.addEventListener('deviceorientation', handleOrientation, true);
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

  rotateNeedle(bearing);
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

  // Kompas sensorini yoqish
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
   SPIN KEYFRAME
============================================================ */
const styleEl = document.createElement('style');
styleEl.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
document.head.appendChild(styleEl);
