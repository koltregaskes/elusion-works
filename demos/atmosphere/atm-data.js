// Live solar calculation. Hour ∈ [0, 24) → all telemetry values.
// Not astronomically accurate — calibrated to feel right at typical
// mid-latitude on a clear day. Tweak constants to taste.

(function () {
  // Sun altitude: peaks ~70° at noon, negative when below horizon
  function altitude(hour) {
    return Math.sin(((hour - 6) / 12) * Math.PI) * 70;
  }
  // Azimuth: 0° = N, 90° = E, 180° = S, 270° = W.
  // Sun rises in E (6am, az=90), peaks S (noon, az=180), sets W (6pm, az=270).
  function azimuth(hour) {
    // 0 = N (midnight), 90 = E (6am), 180 = S (noon), 270 = W (6pm)
    return ((hour / 24) * 360) % 360;
  }
  // Solar radiation (W/m²): peaks ~960 at noon, 0 at night
  function radiation(hour) {
    const alt = altitude(hour);
    if (alt <= 0) return 0;
    return Math.round(960 * Math.sin((alt / 70) * (Math.PI / 2)) * (0.85 + 0.15 * Math.sin(hour)));
  }
  // UV index 0..11
  function uv(hour) {
    const alt = altitude(hour);
    if (alt <= 0) return 0;
    return Math.round((alt / 70) * 9 * 10) / 10;
  }
  function uvBand(uv) {
    if (uv < 2) return 'LOW';
    if (uv < 5) return 'MODERATE';
    if (uv < 7) return 'HIGH';
    if (uv < 10) return 'V. HIGH';
    return 'EXTREME';
  }
  // Illuminance in klx: peaks ~100 in direct sun
  function illuminance(hour) {
    const alt = altitude(hour);
    if (alt <= 0) return 0.05 + 0.1 * Math.random(); // moonlight-ish, but we want stable
    return Math.round(100 * Math.sin((alt / 70) * (Math.PI / 2)) * 10) / 10;
  }
  // Hour → phase name
  function phase(hour) {
    if (hour < 4) return 'Deep night';
    if (hour < 5.5) return 'Pre-dawn';
    if (hour < 7) return 'Sunrise';
    if (hour < 9) return 'Early morning';
    if (hour < 11) return 'Mid-morning';
    if (hour < 12.5) return 'Late morning';
    if (hour < 13.5) return 'Solar noon';
    if (hour < 15.5) return 'Early afternoon';
    if (hour < 17) return 'Late afternoon';
    if (hour < 18.5) return 'Golden hour';
    if (hour < 19.5) return 'Sunset';
    if (hour < 21) return 'Dusk';
    return 'Night';
  }
  function timeStr(hour) {
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  function azimuthBearing(az) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(az / 22.5) % 16];
  }
  // Confidence depends on time-of-day + a fixed cloud factor (since cloud
  // layers are fixed in the mock). Higher near noon, lower at horizon.
  function confidence(hour) {
    const alt = altitude(hour);
    if (alt <= 0) return 0;
    // Three layers, light cirrus haze override active
    const base = 0.82 - 0.12 * 0.3 - 0.34 * 0.05 - 0.07 * 0.0; // weighted by layer density
    const altFactor = 0.85 + 0.15 * (alt / 70);
    return Math.round(base * altFactor * 100);
  }

  window.AtmData = {
    altitude, azimuth, radiation, uv, uvBand, illuminance, phase, timeStr, azimuthBearing, confidence,
  };
})();
