/** Host-wide restart commands. SIGTERM lets Supervisor autorestart DSH. */
import { execFile } from 'node:child_process';
import { createRestartController, inspectActivity } from './guard.js';

export const name = 'restart-button';
export const inject = ['commands'];
const PROGRAM = 'dsh-web:dsh-web_00';

export function supervisorPid() {
	return new Promise((resolve, reject) => {
		execFile('supervisorctl', ['pid', PROGRAM], { timeout: 3000 }, (error, stdout) => {
			const text = String(stdout ?? '').trim();
			const pid = /^\d+$/.test(text) ? Number(text) : NaN;
			if (error || !Number.isSafeInteger(pid) || pid <= 1) {
				reject(new Error('无法确定 Supervisor 管理的 DSH PID，不发送重启信号。'));
			} else resolve(pid);
		});
	});
}

export function apply(ctx) {
	const controller = createRestartController({
		inspect: () => inspectActivity(ctx),
		resolvePid: supervisorPid,
		signal: (pid, signal) => process.kill(pid, signal),
	});
	ctx.effect(() => () => controller.dispose());
	ctx.commands.register({
		name: 'dshrestartcheck',
		description: '只读检查全部会话、子代理与后台任务是否空闲，不触发重启',
		handler: () => controller.check(),
	});
	ctx.commands.register({
		name: 'dshrestart',
		description: '仅在全部会话、子代理与后台任务空闲时重启 DSH；有任务运行则拒绝',
		handler: (invocation) => controller.request(invocation),
	});
}
