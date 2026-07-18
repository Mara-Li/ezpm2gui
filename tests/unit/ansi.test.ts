import assert from 'assert/strict';
import { parseAnsiLine, stripAnsi } from '../../src/client/src/utils/ansi';

// @group UnitTests : Plain text with no escape codes passes through untouched
assert.deepEqual(parseAnsiLine('hello world'), [{ text: 'hello world', style: {} }]);
assert.equal(stripAnsi('hello world'), 'hello world');

// @group UnitTests : Basic foreground color (chalk.red("ERROR"))
assert.deepEqual(
  parseAnsiLine('\x1b[31mERROR\x1b[0m: boom'),
  [
    { text: 'ERROR', style: { color: '#cd3131' } },
    { text: ': boom', style: {} },
  ]
);

// @group UnitTests : Bright foreground + bold combine into one style
assert.deepEqual(
  parseAnsiLine('\x1b[1;92mOK\x1b[0m'),
  [{ text: 'OK', style: { color: '#23d18b', fontWeight: 700 } }]
);

// @group UnitTests : Background color
assert.deepEqual(
  parseAnsiLine('\x1b[41mALERT\x1b[49m'),
  [{ text: 'ALERT', style: { backgroundColor: '#cd3131' } }]
);

// @group UnitTests : 256-color mode (38;5;n)
assert.deepEqual(
  parseAnsiLine('\x1b[38;5;208mtext\x1b[0m'),
  [{ text: 'text', style: { color: '#ff8700' } }]
);

// @group UnitTests : Truecolor mode (38;2;r;g;b)
assert.deepEqual(
  parseAnsiLine('\x1b[38;2;10;20;30mtext\x1b[0m'),
  [{ text: 'text', style: { color: '#0a141e' } }]
);

// @group UnitTests : Style resets (22 clears bold, 39 clears fg) without a full reset
assert.deepEqual(
  parseAnsiLine('\x1b[1;31ma\x1b[22mb\x1b[39mc'),
  [
    { text: 'a', style: { color: '#cd3131', fontWeight: 700 } },
    { text: 'b', style: { color: '#cd3131' } },
    { text: 'c', style: {} },
  ]
);

// @group UnitTests : Non-SGR CSI sequences (cursor move, clear-line) are dropped silently
assert.deepEqual(
  parseAnsiLine('\x1b[2Kprogress\x1b[1A\x1b[?25ldone'),
  [
    { text: 'progress', style: {} },
    { text: 'done', style: {} },
  ]
);
assert.equal(stripAnsi('\x1b[2Kprogress\x1b[1Adone'), 'progressdone');

// @group EdgeCases : Empty string yields no segments
assert.deepEqual(parseAnsiLine(''), []);

console.log('ansi tests passed');
