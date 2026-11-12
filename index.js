/**
 * dsh-restart-button, host half. Registers /dshrestart. The client half adds a
 * menu item that runs it. Restart = SIGTERM to the Supervisor-managed process,
 * so autorestart respawns it (never `supervisorctl restart`, which kills its own
 * client when run from inside dsh).
 */
import { execFile } from 'node:child_process';

export const name = 'restart-button';
export const inject = ['commands'];

const PROGRAM = 'dsh-web:dsh-web_00';

function supervisorPid() {
	return new Promise((resolve) => {
		execFile('supervisorctl', ['pid', PROGRAM], { timeout: 3000 }, (err, stdout) => {
			const pid = Number.parseInt(String(stdout ?? '').trim(), 10);
			resolve(!err && Number.isInteger(pid) && pid > 1 ? pid : process.pid);
		});
	});
}

export function apply(ctx) {
	ctx.commands.register({
		name: 'dshrestart',
		description: '重启 DSH（Supervisor autorestart 约 1 秒内拉起，进行中的会话会中断）',
		handler: async () => {
			const pid = await supervisorPid();
			setTimeout(() => {
				try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
			}, 800);
			return { kind: 'success', text: '正在重启 DSH（pid ' + pid + '），几秒后刷新页面。' };
		}
	});
}
