import { safe } from './safe.js';

export interface WebglReading {
  vendor: string | null;
  renderer: string | null;
  params: string | null;
}

const PARAM_NAMES = [
  'MAX_TEXTURE_SIZE',
  'MAX_CUBE_MAP_TEXTURE_SIZE',
  'MAX_RENDERBUFFER_SIZE',
  'MAX_VERTEX_ATTRIBS',
  'MAX_VERTEX_UNIFORM_VECTORS',
  'MAX_FRAGMENT_UNIFORM_VECTORS',
  'MAX_VARYING_VECTORS',
  'MAX_TEXTURE_IMAGE_UNITS',
  'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
  'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
  'ALIASED_LINE_WIDTH_RANGE',
  'ALIASED_POINT_SIZE_RANGE',
  'MAX_VIEWPORT_DIMS',
  'SHADING_LANGUAGE_VERSION',
  'VERSION',
] as const;

const EMPTY: WebglReading = { vendor: null, renderer: null, params: null };

export function readWebgl(): WebglReading {
  return safe(() => {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl || typeof gl.getParameter !== 'function') return EMPTY;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR) ?? '') || null;
    const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '') || null;
    const params = PARAM_NAMES.map((name) => {
      const value: unknown = gl.getParameter(gl[name]);
      return `${name}=${ArrayBuffer.isView(value) ? Array.from(value as Float32Array).join('x') : String(value)}`;
    });
    const extensions = (gl.getSupportedExtensions() ?? []).slice().sort();
    return { vendor, renderer, params: `${params.join(';')}|${extensions.join(',')}` };
  }, EMPTY);
}
