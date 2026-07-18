import React from 'react';
import { parseAnsiLine } from '../utils/ansi';

interface AnsiTextProps {
  /** Raw log line, possibly containing ANSI escape sequences */
  text: string;
  /** Optional search term — matches (case-insensitive) are wrapped in <mark> */
  highlight?: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @group AnsiText : Wrap the portions of `text` matching `highlight` in <mark>,
// preserving any ANSI-derived styling already applied to the surrounding span.
function renderWithHighlight(text: string, highlight?: string): React.ReactNode {
  if (!highlight) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(highlight)})`, 'gi'));
  return parts.map((part, idx) =>
    part.toLowerCase() === highlight.toLowerCase()
      ? <mark key={idx} style={{ backgroundColor: '#fef08a', color: '#1a1a1a', borderRadius: 2, padding: '0 1px' }}>{part}</mark>
      : part
  );
}

// @group AnsiText : Renders a raw PM2 log line, turning embedded ANSI color/style
// (SGR) codes into styled spans instead of showing them as garbled control
// characters. Non-color escape sequences (cursor moves, clear-line, …) are dropped.
const AnsiText: React.FC<AnsiTextProps> = ({ text, highlight }) => (
  <>
    {parseAnsiLine(text).map((seg, i) => (
      <span key={i} style={seg.style}>{renderWithHighlight(seg.text, highlight)}</span>
    ))}
  </>
);

export default AnsiText;
