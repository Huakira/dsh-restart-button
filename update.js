/**
 * Update registry-installed profile bundles before a restart.
 *
 * Only registry sources are eligible: the manager's own update path refuses
 * git/file dependencies (no version index to compare against), so those are
 * skipped silently instead of failing the whole run.
 */
const NOT_REGISTRY = /^(?:github:|git\+|git:|file:|link:|https?:|\.{0,2}\/|~)/i;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function isRegistrySource(source) {
	return typeof source === 'string' && source.length > 0 && !NOT_REGISTRY.test(source) && !source.includes(':');
}

/** Newest published version that can replace this bundle: semver, declares a bundle, compatible with the running DSH. */
export function pickUpgrade(listed) {
	if (!listed || listed.status !== 'listed' || !Array.isArray(listed.versions)) return undefined;
	for (const entry of listed.versions) {
		const version = typeof entry === 'string' ? entry : entry?.version;
		if (typeof version !== 'string' || !SEMVER.test(version)) continue;
		if (entry?.bundle === false) continue;
		if (entry?.incompatible) continue;
		return version;
	}
	return undefined;
}

const messageOf = error => (error instanceof Error ? error.message : String(error));

export function summarize({ updated, failed, skipped, eligible }) {
	if (!eligible) return '跳过插件更新：没有可从 registry 更新的插件。';
	const parts = [];
	if (updated.length) parts.push('已更新 ' + updated.map(row => row.name + ' ' + row.from + ' → ' + row.to).join('、'));
	if (failed.length) parts.push('更新失败 ' + failed.map(row => row.name + '（' + row.reason + '）').join('、'));
	if (skipped.length) parts.push('跳过 ' + skipped.map(row => row.name + '（' + row.reason + '）').join('、'));
	return parts.length ? parts.join('；') + '。' : '插件都是最新版本。';
}

/**
 * @param manager the `pluginManager` service, or undefined when unavailable
 * @param options budgetMs bounds the whole run; log receives per-bundle failures
 * @returns a report the command can show and the caller logs
 */
export async function updateInstalledBundles({ manager, log = console.warn, now = Date.now, budgetMs = 180_000 } = {}) {
	if (!manager || typeof manager.listBundles !== 'function' || typeof manager.listVersions !== 'function' || typeof manager.updateBundle !== 'function') {
		return { skipped: [], updated: [], failed: [], eligible: 0, text: '跳过插件更新：插件管理器不可用。' };
	}
	const bundles = await manager.listBundles();
	const eligible = bundles.filter(bundle => bundle && bundle.installed && bundle.availability === 'profile'
		&& bundle.official !== true && isRegistrySource(bundle.source));
	const updated = [];
	const failed = [];
	const skipped = [];
	const deadline = now() + budgetMs;
	for (const bundle of eligible) {
		if (now() > deadline) {
			skipped.push({ name: bundle.name, reason: '超出更新时间预算' });
			continue;
		}
		let target;
		try {
			target = pickUpgrade(await manager.listVersions(bundle.name));
		} catch (error) {
			skipped.push({ name: bundle.name, reason: '查询版本失败：' + messageOf(error) });
			continue;
		}
		if (!target) continue;
		try {
			const result = await manager.updateBundle(bundle.name, target);
			const application = result?.result?.application;
			if (application === 'failed' || application === 'cancelled') {
				failed.push({ name: bundle.name, from: result?.from ?? bundle.version, to: target, reason: application });
			} else {
				updated.push({ name: bundle.name, from: result?.from ?? bundle.version, to: target });
			}
		} catch (error) {
			log('[restart-button] 更新 ' + bundle.name + ' 失败：' + messageOf(error));
			failed.push({ name: bundle.name, from: bundle.version, to: target, reason: messageOf(error) });
		}
	}
	return { updated, failed, skipped, eligible: eligible.length, text: summarize({ updated, failed, skipped, eligible: eligible.length }) };
}
