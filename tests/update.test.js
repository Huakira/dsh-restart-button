import test from 'node:test';
import assert from 'node:assert/strict';
import { isRegistrySource, pickUpgrade, updateInstalledBundles } from '../update.js';

const bundle = (name, overrides = {}) => ({
	name,
	installed: true,
	availability: 'profile',
	official: false,
	version: '1.0.0',
	source: name,
	...overrides,
});

test('isRegistrySource accepts registry specs only', () => {
	assert.equal(isRegistrySource('@huakirax/dsh-session-library'), true);
	assert.equal(isRegistrySource('@huakirax/dsh-ears'), true);
	assert.equal(isRegistrySource('github:Huakira/dsh-session-library'), false);
	assert.equal(isRegistrySource('git+https://github.com/a/b.git'), false);
	assert.equal(isRegistrySource('file:../plugin'), false);
	assert.equal(isRegistrySource('link:/root/plugin'), false);
	assert.equal(isRegistrySource('npm:@scope/name'), false);
	assert.equal(isRegistrySource(''), false);
	assert.equal(isRegistrySource(undefined), false);
});

test('pickUpgrade skips non-bundle, incompatible and malformed entries', () => {
	const listed = {
		status: 'listed',
		versions: [
			{ version: '2.0.0', bundle: false, tags: ['latest'] },
			{ version: '1.9.0', bundle: true, tags: [], incompatible: { version: '1.9.0' } },
			{ version: '1.8.0', bundle: true, tags: [] },
			{ version: '1.7.0', bundle: true, tags: [] },
		],
	};
	assert.equal(pickUpgrade(listed), '1.8.0');
	assert.equal(pickUpgrade({ status: 'refused', problem: 'not-updatable', reason: 'git' }), undefined);
	assert.equal(pickUpgrade(undefined), undefined);
});

test('updateInstalledBundles updates registry bundles and skips git ones', async () => {
	const calls = [];
	const manager = {
		listBundles: async () => [
			bundle('@huakirax/dsh-session-library'),
			bundle('github:Huakira/dsh-mac-mount', { source: 'github:Huakira/dsh-mac-mount' }),
			bundle('@huakira/restart-button', { version: '0.3.0' }),
			bundle('@huakira/broken'),
		],
		listVersions: async name => {
			calls.push(['list', name]);
			if (name === '@huakira/broken') throw new Error('registry down');
			if (name === '@huakira/restart-button') return { status: 'listed', versions: [] };
			return { status: 'listed', versions: [{ version: '1.1.0', bundle: true, tags: ['latest'] }], registry: 'https://registry.npmjs.org/' };
		},
		updateBundle: async (name, version) => {
			calls.push(['update', name, version]);
			return { from: '1.0.0', to: version, step: 'install', result: { changed: true, application: 'restart-required', stage: 'install', target: name } };
		},
	};
	const report = await updateInstalledBundles({ manager });
	assert.deepEqual(calls, [
		['list', '@huakirax/dsh-session-library'],
		['update', '@huakirax/dsh-session-library', '1.1.0'],
		['list', '@huakira/restart-button'],
		['list', '@huakira/broken'],
	]);
	assert.deepEqual(report.updated, [{ name: '@huakirax/dsh-session-library', from: '1.0.0', to: '1.1.0' }]);
	assert.equal(report.failed.length, 0);
	assert.deepEqual(report.skipped.map(row => row.name), ['@huakira/broken']);
	assert.match(report.text, /已更新 @huakirax\/dsh-session-library/);
	assert.match(report.text, /跳过 @huakira\/broken/);
});

test('updateInstalledBundles without a manager reports a skip', async () => {
	const report = await updateInstalledBundles({ manager: undefined });
	assert.match(report.text, /插件管理器不可用/);
	assert.deepEqual(report.updated, []);
});
