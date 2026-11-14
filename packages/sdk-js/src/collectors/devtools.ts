import { type DevtoolsIndicators } from '@tbdname/signals/types';
import { safe } from './safe.js';

const THRESHOLD_PX = 160;

/**
 * Docked developer tools shrink the viewport while the window keeps its size. Only the
 * size heuristic is used: tricks that pause in the debugger or spam the console would
 * hurt real users. Undocked devtools are not detected.
 */
export function readDevtools(): DevtoolsIndicators {
  return safe(
    () => {
      if (/Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) return { likely: false, method: null };
      const zoom = window.devicePixelRatio || 1;
      const widthGap = window.outerWidth - window.innerWidth * (zoom >= 1 ? 1 : zoom);
      const heightGap = window.outerHeight - window.innerHeight * (zoom >= 1 ? 1 : zoom);
      if (window.outerWidth === 0 || window.outerHeight === 0) return { likely: false, method: null };
      if (widthGap > THRESHOLD_PX) return { likely: true, method: 'widthGap' };
      if (heightGap > THRESHOLD_PX + 120) return { likely: true, method: 'heightGap' };
      return { likely: false, method: null };
    },
    { likely: false, method: null },
  );
}
