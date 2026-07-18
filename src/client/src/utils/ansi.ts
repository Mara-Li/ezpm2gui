import type { CSSProperties } from 'react';

// @group Types : One styled run of text within a parsed log line
export interface AnsiSegment {
  text: string;
  style: CSSProperties;
}

// @group Constants : Standard 16-color ANSI palette (VS Code dark-theme values —
// matches the app's existing dark log viewport)
const PALETTE_16 = [
  '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
];

// @group Utilities : xterm 256-color palette index -> hex
function ansi256ToHex(n: number): string {
  if (!Number.isFinite(n) || n < 0) return PALETTE_16[7];
  if (n < 16) return PALETTE_16[n];
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  if (n < 232) {
    const idx = n - 16;
    const level = (v: number) => (v === 0 ? 0 : v * 40 + 55);
    const r = level(Math.floor(idx / 36));
    const g = level(Math.floor((idx % 36) / 6));
    const b = level(idx % 6);
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  const gray = Math.min(232 + 23, n) - 232;
  const v = toHex(gray * 10 + 8);
  return `#${v}${v}${v}`;
}

function rgbToHex(r?: number, g?: number, b?: number): string {
  const clamp = (v?: number) => Math.max(0, Math.min(255, v ?? 0)).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

// @group Types : Accumulated SGR (Select Graphic Rendition) state while scanning a line
interface SgrState {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  inverse?: boolean;
}

// @group Utilities : Apply one SGR escape's parameters (e.g. "1;31") to the running state
function applySgrParams(state: SgrState, paramStr: string): void {
  const params = paramStr.length === 0 ? [0] : paramStr.split(';').map(p => (p === '' ? 0 : parseInt(p, 10)));

  for (let i = 0; i < params.length; i++) {
    const p = params[i];

    if (p === 0) {
      for (const key of Object.keys(state) as (keyof SgrState)[]) delete state[key];
    } else if (p === 1) {
      state.bold = true;
    } else if (p === 2) {
      state.dim = true;
    } else if (p === 3) {
      state.italic = true;
    } else if (p === 4) {
      state.underline = true;
    } else if (p === 7) {
      state.inverse = true;
    } else if (p === 9) {
      state.strikethrough = true;
    } else if (p === 22) {
      state.bold = false;
      state.dim = false;
    } else if (p === 23) {
      state.italic = false;
    } else if (p === 24) {
      state.underline = false;
    } else if (p === 27) {
      state.inverse = false;
    } else if (p === 29) {
      state.strikethrough = false;
    } else if (p === 39) {
      delete state.fg;
    } else if (p === 49) {
      delete state.bg;
    } else if (p >= 30 && p <= 37) {
      state.fg = PALETTE_16[p - 30];
    } else if (p >= 90 && p <= 97) {
      state.fg = PALETTE_16[p - 90 + 8];
    } else if (p >= 40 && p <= 47) {
      state.bg = PALETTE_16[p - 40];
    } else if (p >= 100 && p <= 107) {
      state.bg = PALETTE_16[p - 100 + 8];
    } else if (p === 38 || p === 48) {
      const isFg = p === 38;
      const mode = params[i + 1];
      if (mode === 5) {
        const color = ansi256ToHex(params[i + 2]);
        if (isFg) state.fg = color; else state.bg = color;
        i += 2;
      } else if (mode === 2) {
        const color = rgbToHex(params[i + 2], params[i + 3], params[i + 4]);
        if (isFg) state.fg = color; else state.bg = color;
        i += 4;
      }
    }
    // Unrecognized SGR codes are ignored rather than throwing.
  }
}

function styleFromState(state: SgrState): CSSProperties {
  const style: CSSProperties = {};
  const fg = state.inverse ? state.bg : state.fg;
  const bg = state.inverse ? state.fg : state.bg;
  if (fg) style.color = fg;
  if (bg) style.backgroundColor = bg;
  if (state.bold) style.fontWeight = 700;
  if (state.dim) style.opacity = 0.6;
  if (state.italic) style.fontStyle = 'italic';
  if (state.underline && state.strikethrough) style.textDecoration = 'underline line-through';
  else if (state.underline) style.textDecoration = 'underline';
  else if (state.strikethrough) style.textDecoration = 'line-through';
  return style;
}

// Matches any CSI escape sequence: ESC [ params letter — covers both SGR
// (color/style, ending in "m") and non-SGR sequences (cursor moves, clear-line,
// hide-cursor "\x1b[?25l", …) that PM2/terminal apps sometimes emit into log files.
// eslint-disable-next-line no-control-regex
const CSI_RE = /\x1b\[([0-9;?]*)([a-zA-Z])/g;

// @group AnsiParsing : Strip all ANSI escape sequences from a line, leaving plain text.
export function stripAnsi(line: string): string {
  return line.replace(CSI_RE, '');
}

// @group AnsiParsing : Split a raw log line into styled segments.
// SGR sequences ("\x1b[31m", "\x1b[1;32m", 256-color, truecolor, …) become inline
// styles on the following text; any other CSI sequence is dropped since it has no
// visual meaning outside a real terminal and would otherwise render as garbled
// control characters.
export function parseAnsiLine(line: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  const state: SgrState = {};
  let lastIndex = 0;

  CSI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSI_RE.exec(line)) !== null) {
    const text = line.slice(lastIndex, match.index);
    if (text) segments.push({ text, style: styleFromState(state) });
    lastIndex = CSI_RE.lastIndex;

    const [, paramStr, command] = match;
    if (command === 'm') applySgrParams(state, paramStr);
  }

  const rest = line.slice(lastIndex);
  if (rest) segments.push({ text: rest, style: styleFromState(state) });

  return segments;
}
