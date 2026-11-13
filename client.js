window.__ModuleLoader__.load({
	id: "dsh-restart-button",
	factory: () => {
		const zh = /^zh/i.test(navigator.language || "");
		const L = zh
			? { item: "重启 DSH", update: "更新插件并重启", confirm: "检查并重启 DSH？有任何会话、子代理或后台任务运行时会拒绝重启。", confirmUpdate: "先更新 registry 安装的插件再重启？更新可能要一两分钟，期间页面会无响应；有任务运行时会拒绝。", fail: "重启未执行：" }
			: { item: "Restart DSH", update: "Update plugins and restart", confirm: "Check and restart DSH? Restart is refused while any session, subagent, or background job is running.", confirmUpdate: "Update registry-installed plugins, then restart? The update can take a minute or two; it is refused while any task is running.", fail: "Restart not performed: " };
		const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg>';
		const MARK = "data-dsh-restart";

		function sessionIds(ctx) {
			const store = ctx.get("sessions")?.list;
			let snap;
			try { snap = store?.get?.() ?? store?.getSnapshot?.() ?? store?.snapshot ?? store?.value; } catch { /* fall through */ }
			return Array.isArray(snap?.ids) ? snap.ids : [];
		}

		async function restart(ctx, update) {
			const ids = sessionIds(ctx);
			const id = ids.find((x) => location.href.includes(x)) ?? ids[0];
			if (!id) { alert(L.fail + "no session"); return; }
			if (!window.confirm(update ? L.confirmUpdate : L.confirm)) return;
			try {
				await ctx.remote.commands.execute(id, update ? "/dshupdate" : "/dshrestart", []);
			} catch (e) {
				alert(L.fail + (e?.message ?? e));
			}
		}

		function decorate(menu, ctx) {
			if (menu.querySelector("[" + MARK + "]")) return;
			const items = [...menu.querySelectorAll('[role="menuitem"]')];
			// Anchor on the Settings row (zh/en); fall back to the first row.
			const base = items.find((el) => /设置|settings/i.test(el.textContent || "")) ?? items[0];
			if (!base || items.length === 0) return;
			const clone = base.cloneNode(true);
			clone.setAttribute(MARK, "1");
			clone.removeAttribute("id");
			clone.removeAttribute("aria-keyshortcuts");
			const spans = [...clone.children];
			// First child = icon span, last = shortcut (if >2 children), middle = label.
			if (spans.length >= 2) {
				spans[0].innerHTML = ICON;
				const label = spans.length > 2 ? spans[1] : spans[spans.length - 1];
				label.textContent = L.item;
				if (spans.length > 2) spans.slice(2).forEach((s) => s.remove());
			} else {
				clone.textContent = L.item;
			}
			clone.addEventListener("click", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
				restart(ctx, false);
			});
			base.parentElement.insertBefore(clone, base.nextSibling);
			const update = clone.cloneNode(true);
			update.setAttribute(MARK, "update");
			const labels = [...update.children];
			const label = labels.length > 2 ? labels[1] : labels[labels.length - 1];
			if (label) label.textContent = L.update;
			update.addEventListener("click", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
				restart(ctx, true);
			});
			clone.parentElement.insertBefore(update, clone.nextSibling);
		}

		function apply(ctx) {
			ctx.inject(["sessions", "remote", "remote.commands"], () => {
				const scan = () => document.querySelectorAll('[role="menu"]').forEach((m) => {
					// Only the account menu: it contains the feedback row.
					if (/意见反馈|feedback|comentarios|commentaires|rückmeldung/i.test(m.textContent || "")) decorate(m, ctx);
				});
				const mo = new MutationObserver(scan);
				mo.observe(document.body, { childList: true, subtree: true });
				if (typeof ctx.effect === "function") ctx.effect(() => () => mo.disconnect(), "restart-button: observer");
			});
		}

		return { inject: ["slots", "locale", "sessions", "remote", "remote.commands"], apply };
	}
});
