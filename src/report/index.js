// report/index.js — reporter registry.

'use strict';

import { renderPretty, renderSummary, supportsColor } from './pretty.js';
import { renderJson } from './json.js';
import { renderJunit } from './junit.js';
import { renderTap } from './tap.js';

export const REPORTERS = {
  pretty: { render: renderPretty, file: false },
  json: { render: renderJson, file: true },
  junit: { render: renderJunit, file: true },
  tap: { render: renderTap, file: true },
};

export function getReporter(name) {
  const r = REPORTERS[name];
  if (!r) {
    throw new Error(`Unknown reporter "${name}" — available: ${Object.keys(REPORTERS).join(', ')}`);
  }
  return r;
}

export { renderPretty, renderSummary, renderJson, renderJunit, renderTap, supportsColor };
