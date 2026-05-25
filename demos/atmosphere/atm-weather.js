// Atmosphere weather engine
// Generates a 48-hour dataset (24h history + 24h forecast) with realistic
// hourly conditions. Designed to be SWAPPED with real data from a WU station
// later — the public surface is `getWeatherDay(now)` returning a 48-entry
// array.
//
// API key handoff: the consuming code expects two values from the user via
// the Setup page or localStorage:
//   - atm.wu_station_id   (default: "IEDENB52")
//   - atm.wu_api_key      (user-provided, kept client-side)
//   - atm.maps_api_key    (user-provided, kept client-side)
// All three are PLACEHOLDERS in this build — the data engine returns dummy
// data and the map view uses a static mockup. Wire-up notes:
//
//   const stationId = localStorage.getItem('atm.wu_station_id') || 'IEDENB52';
//   const apiKey = localStorage.getItem('atm.wu_api_key');
//   const url = `https://api.weather.com/v2/pws/observations/current?stationId=${stationId}&format=json&units=m&apiKey=${apiKey}`;
//   // For forecast, use api.weather.com/v3/wx/forecast/hourly/...
//   // (WU's PWS API may have CORS limits when called from the browser
//   //  directly — a proxy may be needed in production.)

(function () {
  // Seeded RNG so the dummy day is stable across reloads but unique per date.
  function seededDay() {
    const d = new Date();
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = a;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const CONDITIONS = ['sunny', 'partly-cloudy', 'overcast', 'fog', 'rain', 'heavy-rain', 'thunder', 'snow'];

  // Pick a "weather story" for the day — a sequence of condition windows.
  // E.g. "morning fog → sunny → afternoon clouds → evening rain"
  // Returns array of {start, end, condition} in hour space.
  function dayStory(seed) {
    const r = mulberry32(seed);
    // Pick an archetype
    const archetypes = [
      // Beautiful sunny day with light afternoon clouds
      [{ s: 0, e: 5, c: 'sunny' }, { s: 5, e: 16, c: 'sunny' }, { s: 16, e: 19, c: 'partly-cloudy' }, { s: 19, e: 24, c: 'sunny' }],
      // Morning fog → sun → afternoon thunder
      [{ s: 0, e: 7, c: 'fog' }, { s: 7, e: 13, c: 'partly-cloudy' }, { s: 13, e: 17, c: 'thunder' }, { s: 17, e: 24, c: 'overcast' }],
      // Mostly cloudy with rain windows
      [{ s: 0, e: 6, c: 'overcast' }, { s: 6, e: 11, c: 'rain' }, { s: 11, e: 15, c: 'partly-cloudy' }, { s: 15, e: 20, c: 'heavy-rain' }, { s: 20, e: 24, c: 'overcast' }],
      // Crisp clear (cold snap)
      [{ s: 0, e: 24, c: 'sunny' }],
      // Snowy winter day
      [{ s: 0, e: 8, c: 'snow' }, { s: 8, e: 14, c: 'partly-cloudy' }, { s: 14, e: 19, c: 'snow' }, { s: 19, e: 24, c: 'overcast' }],
    ];
    return archetypes[Math.floor(r() * archetypes.length)];
  }

  function conditionAt(story, hour) {
    for (const w of story) if (hour >= w.s && hour < w.e) return w.c;
    return story[story.length - 1].c;
  }

  // Smooth condition cloudiness 0..1 (used by background opacity)
  function cloudinessFor(condition) {
    return ({
      'sunny': 0.05,
      'partly-cloudy': 0.45,
      'overcast': 0.92,
      'fog': 0.7,
      'rain': 0.85,
      'heavy-rain': 0.95,
      'thunder': 0.95,
      'snow': 0.8,
    })[condition] ?? 0.3;
  }

  function precipFor(condition) {
    return ({
      'sunny': 0, 'partly-cloudy': 0, 'overcast': 0,
      'fog': 0.05, 'rain': 0.4, 'heavy-rain': 0.9,
      'thunder': 1.1, 'snow': 0.3,
    })[condition] ?? 0;
  }

  // Day temperature curve (peaks around 14:00). Modulated by cloud cover.
  function tempAt(hour, condition, baseHigh = 24, baseLow = 14) {
    const dayPhase = Math.sin(((hour - 4) / 24) * Math.PI * 2 - Math.PI / 2);
    const t = baseLow + (baseHigh - baseLow) * (dayPhase * 0.5 + 0.5);
    // Clouds dampen swings
    const cloud = cloudinessFor(condition);
    const damp = (baseHigh + baseLow) / 2;
    return t * (1 - cloud * 0.25) + damp * cloud * 0.25;
  }

  // Surface (in-sun) temperature is hotter than air temp when sun is up and clear
  function tempInSun(airTemp, hour, condition) {
    const alt = Math.sin(((hour - 6) / 12) * Math.PI) * 70;
    if (alt <= 0) return airTemp;
    const sunFactor = (1 - cloudinessFor(condition)) * (alt / 70);
    return airTemp + 8 * sunFactor;
  }

  function windAt(hour, seed, condition) {
    const r = mulberry32(seed + Math.floor(hour) * 7919);
    let base = 4 + r() * 8; // 4–12 mph
    if (condition === 'thunder' || condition === 'heavy-rain') base += 8 + r() * 12;
    if (condition === 'rain') base += 4;
    const dirSeed = mulberry32(seed * 31);
    const baseDir = dirSeed() * 360;
    const wobble = (mulberry32(seed + hour * 113)() - 0.5) * 60;
    return {
      speed: Math.round(base * 10) / 10,
      gust: Math.round((base * (1.3 + r() * 0.4)) * 10) / 10,
      dir: (baseDir + wobble + 360) % 360,
    };
  }

  function rainRateAt(hour, condition, seed) {
    const r = mulberry32(seed + Math.floor(hour) * 13);
    const base = precipFor(condition);
    if (base === 0) return 0;
    return Math.round(base * (0.5 + r()) * 100) / 100; // mm/h
  }

  function humidityAt(hour, condition, seed) {
    const r = mulberry32(seed + Math.floor(hour) * 17);
    const cloud = cloudinessFor(condition);
    return Math.round((45 + cloud * 40 + (r() - 0.5) * 10));
  }

  function pressureAt(hour, condition, seed) {
    const r = mulberry32(seed + Math.floor(hour) * 19);
    let base = 1013;
    if (condition === 'rain' || condition === 'heavy-rain' || condition === 'thunder') base -= 6;
    if (condition === 'sunny') base += 4;
    return Math.round((base + (r() - 0.5) * 4) * 10) / 10;
  }

  // Main: build a 48-entry array, indexed by `offset` where 0 = now,
  // negative = past, positive = future. Each entry has the full snapshot.
  function getWeatherDataset() {
    const seed = seededDay();
    const story = dayStory(seed);
    const now = new Date();
    const result = [];
    for (let offset = -24; offset <= 24; offset++) {
      const t = new Date(now.getTime() + offset * 60 * 60 * 1000);
      const wallHour = t.getHours() + t.getMinutes() / 60;
      const condition = conditionAt(story, wallHour);
      const airT = tempAt(wallHour, condition);
      const w = windAt(wallHour, seed, condition);
      result.push({
        offset,                              // -24..+24 hours from now
        date: t,
        hourOfDay: wallHour,
        isHistory: offset < 0,
        isForecast: offset > 0,
        isNow: offset === 0,
        condition,
        cloudiness: cloudinessFor(condition),
        airTemp: Math.round(airT * 10) / 10,
        sunTemp: Math.round(tempInSun(airT, wallHour, condition) * 10) / 10,
        wind: w,
        rain: rainRateAt(wallHour, condition, seed),
        humidity: humidityAt(wallHour, condition, seed),
        pressure: pressureAt(wallHour, condition, seed),
      });
    }
    return result;
  }

  // Look up a single snapshot at a "virtual time" represented by an offset
  // (which may be fractional). Interpolates between hourly snapshots.
  function getSnapshotAt(dataset, offsetHours) {
    const i0 = Math.max(0, Math.min(dataset.length - 1, Math.floor(offsetHours + 24)));
    const i1 = Math.min(dataset.length - 1, i0 + 1);
    const frac = (offsetHours + 24) - i0;
    const a = dataset[i0], b = dataset[i1];
    if (!b || frac === 0) return a;
    // Interpolate continuous values; pick condition from nearer side.
    return {
      ...a,
      offset: offsetHours,
      date: new Date(a.date.getTime() + frac * 60 * 60 * 1000),
      hourOfDay: (a.hourOfDay + frac) % 24,
      isHistory: offsetHours < 0,
      isForecast: offsetHours > 0,
      isNow: Math.abs(offsetHours) < 0.01,
      condition: frac < 0.5 ? a.condition : b.condition,
      cloudiness: a.cloudiness + (b.cloudiness - a.cloudiness) * frac,
      airTemp: Math.round((a.airTemp + (b.airTemp - a.airTemp) * frac) * 10) / 10,
      sunTemp: Math.round((a.sunTemp + (b.sunTemp - a.sunTemp) * frac) * 10) / 10,
      wind: {
        speed: Math.round((a.wind.speed + (b.wind.speed - a.wind.speed) * frac) * 10) / 10,
        gust: Math.round((a.wind.gust + (b.wind.gust - a.wind.gust) * frac) * 10) / 10,
        dir: a.wind.dir + ((((b.wind.dir - a.wind.dir + 540) % 360) - 180) * frac),
      },
      rain: Math.round((a.rain + (b.rain - a.rain) * frac) * 100) / 100,
      humidity: Math.round(a.humidity + (b.humidity - a.humidity) * frac),
      pressure: Math.round((a.pressure + (b.pressure - a.pressure) * frac) * 10) / 10,
    };
  }

  function conditionLabel(c) {
    return ({
      'sunny': 'Clear & sunny',
      'partly-cloudy': 'Partly cloudy',
      'overcast': 'Overcast',
      'fog': 'Foggy',
      'rain': 'Light rain',
      'heavy-rain': 'Heavy rain',
      'thunder': 'Thunderstorms',
      'snow': 'Snow',
    })[c] ?? c;
  }

  function bearingLabel(deg) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return dirs[Math.round(deg / 22.5) % 16];
  }

  window.AtmWeather = { getWeatherDataset, getSnapshotAt, conditionLabel, bearingLabel, CONDITIONS };
})();
