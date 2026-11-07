// Unit system shared by every panel. Values arrive in US customary units.
const listeners = new Set();
export const U = { sys: 'imperial' };
export function setUnits(sys) { U.sys = sys; listeners.forEach((f) => f(sys)); }
export function onUnits(f) { listeners.add(f); }

const n = (v, d = 0) => Number(v).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
export const fmt = {
  num: n,
  elev: (ft, d = 0) => U.sys === 'imperial' ? `${n(ft, d)} ft` : `${n(ft * 0.3048, d)} m`,
  elevVal: (ft, d = 0) => U.sys === 'imperial' ? n(ft, d) : n(ft * 0.3048, d),
  elevUnit: () => U.sys === 'imperial' ? 'ft' : 'm',
  len: (ft, d = 0) => U.sys === 'imperial' ? `${n(ft, d)} ft` : `${n(ft * 0.3048, d)} m`,
  flow: (cfs) => U.sys === 'imperial' ? `${n(cfs)} ft³/s` : `${n(cfs * 0.0283168)} m³/s`,
  flowShort: (cfs) => U.sys === 'imperial' ? `${n(cfs / 1000, cfs < 10000 ? 1 : 0)}k cfs` : `${n(cfs * 0.0283168)} m³/s`,
  psi: (psi) => U.sys === 'imperial' ? `${n(psi)} psi` : `${n(psi * 6.89476 / 1000, 2)} MPa`,
  force: (mn) => U.sys === 'imperial' ? `${n(mn * 0.1124 / 1000, 2)}M tons` : `${n(mn / 1000, 1)} GN`,
  vol: (maf) => U.sys === 'imperial' ? `${n(maf, 1)} MAF` : `${n(maf * 1.2335, 1)} km³`,
  rate: (ftDay) => U.sys === 'imperial' ? `${ftDay >= 0 ? '+' : '−'}${n(Math.abs(ftDay), 2)} ft/day` : `${ftDay >= 0 ? '+' : '−'}${n(Math.abs(ftDay) * 30.48, 1)} cm/day`,
};
