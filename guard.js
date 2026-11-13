// These checks run in the unscoped Host context, never against a browser roster.
export function inspectActivity(ctx) {
	try {
		const registry = ctx.get('agents');
		if (!registry || typeof registry.list !== 'function') throw new Error('agents registry unavailable');
		const agents = registry.list();
		if (!Array.isArray(agents)) throw new Error('invalid agents snapshot');
		const blockers = [];
		for (const agent of agents) {
			if (!agent || typeof agent.id !== 'string' || !agent.id) throw new Error('invalid live agent');
			const status = agent.status;
			if (status !== 'idle' && status !== 'running') throw new Error('unknown agent status: ' + agent.id);
			if (status === 'running') blockers.push('会话 ' + agent.id);
		}
		// Jobs can outlive a model turn. list() alone sees only unowned jobs;
		// query each live owner as well, including child agents.
		const jobs = ctx.get('jobs');
		if (jobs !== undefined && jobs !== null) {
			if (typeof jobs.list !== 'function') throw new Error('jobs registry unavailable');
			const seen = new Set();
			for (const owner of [undefined, ...agents.map((agent) => agent.id)]) {
				const rows = jobs.list(owner);
				if (!Array.isArray(rows)) throw new Error('invalid jobs snapshot');
				for (const job of rows) {
					if (!job || typeof job.id !== 'string' || !['running', 'stopping', 'completed', 'killed', 'failed'].includes(job.status)) {
						throw new Error('unknown job status');
					}
					if (!seen.has(job.id) && (job.status === 'running' || job.status === 'stopping')) {
						blockers.push('后台任务 ' + job.id);
					}
					seen.add(job.id);
				}
			}
		}
		if (blockers.length) {
			return { kind: 'error', text: '拒绝重启：仍有 ' + blockers.length + ' 项正在运行或停止中。等它们自然结束后再试，不要用 Stop 绕过。' };
		}
		return { kind: 'success', text: '检查通过：全部 ' + agents.length + ' 个已加载会话（含子代理）空闲，未发现运行中的后台任务。' };
	} catch (error) {
		return { kind: 'error', text: '拒绝重启：无法确认全局会话状态。' + (error instanceof Error ? error.message : String(error)) };
	}
}

// Dependencies let tests exercise the real command path without signalling DSH.
export function createRestartController({ inspect, resolvePid, signal, schedule = setTimeout, cancel = clearTimeout, log = console.warn, delayMs = 800 }) {
	let pending = false;
	let timer;
	let disposed = false;
	return {
		check: inspect,
		async request(invocation = {}) {
			if (disposed) return { kind: 'error', text: '拒绝重启：插件已卸载。' };
			if (pending) return { kind: 'error', text: '重启检查已在进行，请勿重复提交。' };
			const first = inspect();
			if (first.kind !== 'success') return first;
			pending = true;
			try {
				const pid = await resolvePid();
				if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('invalid supervisor PID');
				if (disposed || invocation.signal?.aborted) throw new Error('command cancelled');
				const second = inspect();
				if (second.kind !== 'success') { pending = false; return second; }
				timer = schedule(() => {
					timer = undefined;
					if (disposed) return;
					// No await or additional timer between this snapshot and SIGTERM.
					const final = inspect();
					if (final.kind !== 'success') {
						pending = false;
						log('[restart-button] 已取消计划中的重启：' + final.text);
						return;
					}
					try { signal(pid, 'SIGTERM'); }
					catch (error) {
						pending = false;
						log('[restart-button] 重启信号发送失败：' + String(error));
					}
				}, delayMs);
				return { kind: 'success', text: '已安排重启 DSH；执行前会再次检查，若出现新任务将自动取消。' };
			} catch (error) {
				pending = false;
				return { kind: 'error', text: '拒绝重启：' + (error instanceof Error ? error.message : String(error)) };
			}
		},
		dispose() {
			disposed = true;
			pending = false;
			if (timer !== undefined) cancel(timer);
			timer = undefined;
		},
	};
}
