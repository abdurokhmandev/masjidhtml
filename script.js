// script.js – Masjidgacha Qibla Web App

const kaabaLat = 21.4225; // Makkah latitude
const kaabaLon = 39.8262; // Makkah longitude

const statusEl = document.getElementById('status');
const arrowEl  = document.getElementById('arrow');
const btnEl    = document.getElementById('locateBtn');

function degToRad(d) { return d * Math.PI / 180; }
function radToDeg(r) { return r * 180 / Math.PI; }

function calculateQibla(lat, lon) {
  const φ1 = degToRad(lat);
  const λ1 = degToRad(lon);
  const φ2 = degToRad(kaabaLat);
  const λ2 = degToRad(kaabaLon);
  const Δλ = λ2 - λ1;
  const x = Math.sin(Δλ);
  const y = Math.cos(φ1) * Math.tan(φ2) - Math.sin(φ1) * Math.cos(Δλ);
  let bearing = radToDeg(Math.atan2(x, y));
  bearing = (bearing + 360) % 360;
  return bearing;
}

function rotateArrow(bearing) {
  arrowEl.style.transform = `rotate(${bearing}deg)`;
}

function updateStatus(msg) {
  statusEl.textContent = msg;
}

function handleSuccess(position) {
  const { latitude, longitude } = position.coords;
  const bearing = calculateQibla(latitude, longitude);
  rotateArrow(bearing);
  updateStatus(`🕌 Sizning qibla bearing: ${Math.round(bearing)}°`);
}

function handleError(err) {
  console.error(err);
  switch (err.code) {
    case err.PERMISSION_DENIED:
      updateStatus('🚫 Geolokatsiya ruxsati berilmadi.');
      break;
    case err.POSITION_UNAVAILABLE:
      updateStatus('📍 Manzil topilmadi.');
      break;
    case err.TIMEOUT:
      updateStatus('⌛ Vaqt tugadi, qayta urinib ko\'ring.');
      break;
    default:
      updateStatus('❓ Noma\'lum xato.');
  }
}

btnEl.addEventListener('click', () => {
  updateStatus('⏳ Joylashuvingiz aniqlanmoqda…');
  if (!navigator.geolocation) {
    updateStatus('❌ Geolocation API bu brauzerda qo\'llab-quvvatlanmaydi.');
    return;
  }
  navigator.geolocation.getCurrentPosition(handleSuccess, handleError, { timeout: 12000, enableHighAccuracy: true });
});

// Initial animation – spin slowly to hint interaction
rotateArrow(0);
