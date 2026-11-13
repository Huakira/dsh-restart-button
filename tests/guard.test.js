import test from 'node:test';
import assert from 'node:assert/strict';
import { createRestartController, inspectActivity } from '../guard.js';

function fakeAgent(id, status) {
	return { id, status };
}

test('inspectActivity reports running sessions as blockers', () => {
	const blockers = inspectActivity({
		get(name) {
			if (name === 'agents') {
				return { list: () => [fakeAgent('root-1', 'running'), fakeAgent('child-1', 'idle')] };
			}
			return undefined;
		},
	});
	assert.equal(blockers.kind, 'error');
	assert.match(blockers.text, /root-1/);
});

test('inspectActivity counts background jobs of every owner', () => {
	const rows = { __unowned: [{ id: 'bash-1', status: 'running' }], 'root-1': [{ id: 'bash-2', status: 'stopping' }], 'child-1': [] };
	const owners = [undefined, 'root-1', 'child-1'];
	let calls = 0;
	const blockers = inspectActivity({
		get(name) {
			if (name === 'agents') return { list: () => [fakeAgent('root-1', 'idle'), fakeAgent('child-1', 'idle')] };
			if (name === 'jobs') return { list(caller) { calls += 1; assert.equal(caller, owners[calls - 1]); return rows[calls === 1 ? '__unowned' : caller]; } };
			return undefined;
		},
	});
	assert.equal(calls, 3);
	assert.equal(blockers.kind, 'error');
	assert.match(blockers.text, /bash-1/);
	assert.match(blockers.text, /bash-2/);
});

test('inspectActivity fails closed when registries are unavailable', () => {
	const result = inspectActivity({ get() { return undefined; } });
	assert.equal(result.kind, 'error');
	assert.match(result.text, /拒绝重启/);
});

test('inspectActivity fails closed on unknown status values', () => {
	const result = inspectActivity({
		get(name) {
			if (name === 'agents') return { list: () => [fakeAgent('root-1', 'weird')] };
			return undefined;
		},
	});
	assert.equal(result.kind, 'error');
});

test('inspectActivity passes when everything is idle', () => {
	const result = inspectActivity({
		get(name) {
			if (name === 'agents') return { list: () => [fakeAgent('root-1', 'idle')] };
			if (name === 'jobs') return { list: () => [] };
			return undefined;
		},
	});
	assert.equal(result.kind, 'success');
});

test('request runs the full inspect-verify-final sequence before signalling', async () => {
	const snapshots = ['success', 'success', 'success'];
	let signals = 0;
	let ticks = 0;
	const controller = createRestartController({
		inspect: () => (snapshots.length ? { kind: snapshots.shift(), text: '' } : { kind: 'error', text: 'unexpected read' }),
		resolvePid: async () => 4242,
		signal: (pid, sig) => {
			signals += 1;
			assert.equal(pid, 4242);
			assert.equal(sig, 'SIGTERM');
		},
		schedule: (fn) => { ticks += 1; fn(); },
		cancel: () => {},
	});
	const result = await controller.request();
	assert.equal(result.kind, 'success');
	assert.equal(signals, 1);
	assert.equal(ticks, 1);
	controller.dispose();
});

test('request aborts when the verification snapshot finds a new task', async () => {
	let signals = 0;
	const controller = createRestartController({
		inspect: () => { const calls = 1; return calls === 1 ? { kind: 'success', text: '' } : { kind: 'error', text: '会话 root-1' }; },
		resolvePid: async () => 4242,
		signal: () => { signals += 1; },
		schedule: () => { throw new Error('should not schedule'); },
		cancel: () => {},
	});
	const result = await controller.request();
	assert.equal(result.kind, 'error');
	assert.match(result.text, /拒绝重启/);
	assert.equal(signals, 0);
});

test('request fails closed when the PID cannot be resolved', async () => {
	let signals = 0;
	const controller = createRestartController({
		inspect: () => ({ kind: 'success', text: '' }),
		resolvePid: async () => { throw new Error('无法确定 PID'); },
		signal: () => { signals += 1; },
		schedule: () => {},
		cancel: () => {},
	});
	const result = await controller.request();
	assert.equal(result.kind, 'error');
	assert.match(result.text, /无法确定 PID/);
	assert.equal(signals, 0);
});

test('a mid-delay new task cancels the planned restart', async () => {
	let signals = 0;
	let saved;
	let finalBusy = false;
	const controller = createRestartController({
		inspect: () => (finalBusy ? { kind: 'error', text: '会话 root-1' } : { kind: 'success', text: '' }),
		resolvePid: async () => 4242,
		signal: () => { signals += 1; },
		schedule: (fn) => { saved = fn; },
		cancel: () => {},
	});
	const result = await controller.request();
	assert.equal(result.kind, 'success');
	finalBusy = true; // A new task starts while the restart sits scheduled.
	saved();
	assert.equal(signals, 0);
	controller.dispose();
});

test('dispose cancels a scheduled restart', async () => {
	let fired = false;
	let saved;
	const controller = createRestartController({
		inspect: () => ({ kind: 'success', text: '' }),
		resolvePid: async () => 4242,
		signal: () => { fired = true; },
		schedule: (fn) => { saved = fn; },
		cancel: () => {},
	});
	const result = await controller.request();
	assert.equal(result.kind, 'success');
	controller.dispose();
	saved();
	assert.equal(fired, false);
});

test('duplicate requests are rejected while one is pending', async () => {
	let resolvePid;
	const gate = new Promise((resolve) => { resolvePid = resolve; });
	const controller = createRestartController({
		inspect: () => ({ kind: 'success', text: '' }),
		resolvePid: () => gate,
		signal: () => {},
		schedule: () => {},
		cancel: () => {},
	});
	const first = controller.request();
	const second = await controller.request();
	assert.equal(second.kind, 'error');
	resolvePid(4242);
	await first;
	controller.dispose();
});
