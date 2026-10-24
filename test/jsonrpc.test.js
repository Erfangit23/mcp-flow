// test/jsonrpc.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNotification, isResponse, makeRequest, validateMessage } from '../src/jsonrpc.js';

test('validateMessage accepts well-formed messages', () => {
  assert.ok(validateMessage({ jsonrpc: '2.0', id: 1, method: 'ping' }).ok);
  assert.ok(validateMessage({ jsonrpc: '2.0', id: 1, result: {} }).ok);
  assert.ok(validateMessage({ jsonrpc: '2.0', id: 'abc', error: { code: -1, message: 'x' } }).ok);
  assert.ok(validateMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }).ok);
});

test('validateMessage rejects malformed messages with reasons', () => {
  assert.ok(!validateMessage(null).ok);
  assert.ok(!validateMessage([1]).ok);
  assert.ok(!validateMessage({ id: 1, method: 'ping' }).ok, 'missing jsonrpc');
  assert.ok(!validateMessage({ jsonrpc: '1.0', id: 1, method: 'ping' }).ok, 'wrong version');
  assert.ok(!validateMessage({ jsonrpc: '2.0' }).ok, 'neither method nor id');
  assert.ok(!validateMessage({ jsonrpc: '2.0', id: true, method: 'ping' }).ok, 'bad id type');
  assert.ok(!validateMessage({ jsonrpc: '2.0', id: 1 }).ok, 'response without result/error');
  assert.ok(!validateMessage({ jsonrpc: '2.0', id: 1, result: {}, error: { code: 1, message: 'x' } }).ok, 'both result and error');
  assert.ok(!validateMessage({ jsonrpc: '2.0', id: 1, error: { message: 'no code' } }).ok, 'error without code');
});

test('classification helpers', () => {
  assert.ok(isResponse({ jsonrpc: '2.0', id: 1, result: {} }));
  assert.ok(!isResponse({ jsonrpc: '2.0', method: 'x' }));
  assert.ok(isNotification({ jsonrpc: '2.0', method: 'x' }));
  assert.ok(!isNotification({ jsonrpc: '2.0', id: 1, method: 'x' }));
  const req = makeRequest('ping', undefined, 7);
  assert.equal(req.id, 7);
  assert.ok(!('params' in req));
});
