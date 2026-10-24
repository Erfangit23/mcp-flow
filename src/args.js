// args.js — hand-rolled CLI argument parsing (still zero dependencies).

'use strict';

import { UserError } from './util.js';

const FLAG_SPECS = {
  '--server': { arg: 'string' },
  '--url': { arg: 'string' },
  '--reporter': { arg: 'string' },
  '--out': { arg: 'string' },
  '--timeout': { arg: 'number' },
  '--filter': { arg: 'string' },
  '--max-steps': { arg: 'number' },
};

export const COMMANDS = ['run', 'init', 'serve', 'list', 'validate', 'help', 'version'];

export function parseArgs(argv) {
  const out = {
    command: null,
    flags: {
      server: undefined,
      url: undefined,
      reporter: undefined,
      out: undefined,
      timeout: undefined,
      filter: undefined,
      failFast: false,
      safeOnly: false,
      noColor: false,
      verbose: false,
      dryRun: false,
    },
    patterns: [],
    serverCommand: null, // from `--` separator
    positional: [],
  };

  let i = 0;
  // First non-flag token = command
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === '--') {
      // Everything after `--` is the server command, already tokenized by the
      // OS — never re-split (paths with spaces must survive).
      out.serverCommand = argv.slice(i + 1);
      if (!out.serverCommand.length) throw new UserError('"--" was given but no command followed');
      return out;
    }
    if (tok.startsWith('--')) {
      applyFlag(out, tok, argv, i, (next) => (i = next));
      i++;
      continue;
    }
    if (tok.startsWith('-') && tok.length > 1) {
      applyShort(out, tok);
      i++;
      continue;
    }
    if (!out.command) {
      if (!COMMANDS.includes(tok)) {
        throw new UserError(`Unknown command "${tok}"`, `Available: ${COMMANDS.join(', ')}. Run "mcp-flow help".`);
      }
      out.command = tok;
    } else if (COMMANDS.includes(tok) && tok === 'help') {
      out.command = 'help';
    } else {
      out.patterns.push(tok);
    }
    i++;
  }
  return out;
}

function applyFlag(out, tok, argv, i, setI) {
  const spec = FLAG_SPECS[tok];
  if (!spec) {
    const boolFlags = {
      '--fail-fast': 'failFast',
      '--safe-only': 'safeOnly',
      '--no-color': 'noColor',
      '--verbose': 'verbose',
      '--dry-run': 'dryRun',
    };
    if (boolFlags[tok]) {
      out.flags[boolFlags[tok]] = true;
      return;
    }
    throw new UserError(`Unknown flag "${tok}"`, 'Run "mcp-flow help" to see all flags.');
  }
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UserError(`Flag "${tok}" needs a value`);
  }
  if (spec.arg === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new UserError(`Flag "${tok}" needs a positive number, got "${value}"`);
    out.flags[tok.slice(2).replaceAll('-', '_')] = n;
  } else {
    out.flags[tok.slice(2).replaceAll('-', '_')] = value;
  }
  setI(i + 1);
}

function applyShort(out, tok) {
  const shorts = { '-f': 'failFast', '-q': 'noColor' };
  if (!shorts[tok]) throw new UserError(`Unknown flag "${tok}"`);
  out.flags[shorts[tok]] = true;
}
