import { safe } from './safe.js';

/** Float results of transcendental functions differ across JS engines and CPU math libraries. */
export function readMath(): string | null {
  return safe(() => {
    const m = Math;
    const values = [
      m.acos(0.123124234234234242),
      m.acosh(1e308),
      m.asin(0.123124234234234242),
      m.asinh(1),
      m.atanh(0.5),
      m.atan(0.5),
      m.sin(-1e300),
      m.sinh(1),
      m.cos(10.000000000123),
      m.cosh(1),
      m.tan(-1e300),
      m.tanh(1),
      m.exp(1),
      m.expm1(1),
      m.log1p(10),
      m.cbrt(100),
      m.pow(Math.PI, -100),
    ];
    return values.map((v) => v.toString()).join(',');
  }, null);
}
