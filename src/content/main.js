(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});
	if (CC.__started) return;
	CC.__started = true;

	function getConversationId() {
		const match = window.location.pathname.match(/\/chat\/([^/?]+)/);
		return match ? match[1] : null;
	}

	function getOrgIdFromCookie() {
		try {
			return (
				document.cookie
					.split('; ')
					.find((row) => row.startsWith('lastActiveOrg='))
					?.split('=')[1] || null
			);
		} catch {
			return null;
		}
	}

	function waitForElement(selector, timeoutMs) {
		return new Promise((resolve) => {
			const existing = document.querySelector(selector);
			if (existing) {
				resolve(existing);
				return;
			}

			let timeoutId;
			const observer = new MutationObserver(() => {
				const el = document.querySelector(selector);
				if (el) {
					if (timeoutId) clearTimeout(timeoutId);
					observer.disconnect();
					resolve(el);
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });

			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					observer.disconnect();
					resolve(null);
				}, timeoutMs);
			}
		});
	}

	CC.waitForElement = waitForElement;

	function waitForHeaderAnchor(timeoutMs) {
		const existing = CC.findHeaderAnchor();
		if (existing) return Promise.resolve(existing);

		return new Promise((resolve) => {
			let timeoutId;
			const observer = new MutationObserver(() => {
				const el = CC.findHeaderAnchor();
				if (el) {
					if (timeoutId) clearTimeout(timeoutId);
					observer.disconnect();
					resolve(el);
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });

			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					observer.disconnect();
					resolve(null);
				}, timeoutMs);
			}
		});
	}

	CC.waitForHeaderAnchor = waitForHeaderAnchor;

	function waitForModelSelector(timeoutMs) {
		const existing = CC.findModelSelector();
		if (existing) return Promise.resolve(existing);

		return new Promise((resolve) => {
			let timeoutId;
			const observer = new MutationObserver(() => {
				const el = CC.findModelSelector();
				if (el) {
					if (timeoutId) clearTimeout(timeoutId);
					observer.disconnect();
					resolve(el);
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });

			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					observer.disconnect();
					resolve(null);
				}, timeoutMs);
			}
		});
	}

	CC.waitForModelSelector = waitForModelSelector;

	function waitForComposerSurface(timeoutMs) {
		const existing = CC.findComposerSurface();
		if (existing) return Promise.resolve(existing);

		return new Promise((resolve) => {
			let timeoutId;
			const observer = new MutationObserver(() => {
				const el = CC.findComposerSurface();
				if (el) {
					if (timeoutId) clearTimeout(timeoutId);
					observer.disconnect();
					resolve(el);
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });

			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					observer.disconnect();
					resolve(null);
				}, timeoutMs);
			}
		});
	}

	CC.waitForComposerSurface = waitForComposerSurface;

	function waitForComposerBox(timeoutMs) {
		const existing = CC.findComposerBox ? CC.findComposerBox() : CC.findComposerSurface();
		if (existing) return Promise.resolve(existing);

		return new Promise((resolve) => {
			let timeoutId;
			const observer = new MutationObserver(() => {
				const el = CC.findComposerBox ? CC.findComposerBox() : CC.findComposerSurface();
				if (el) {
					if (timeoutId) clearTimeout(timeoutId);
					observer.disconnect();
					resolve(el);
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });

			if (timeoutMs) {
				timeoutId = setTimeout(() => {
					observer.disconnect();
					resolve(null);
				}, timeoutMs);
			}
		});
	}

	CC.waitForComposerBox = waitForComposerBox;

	function observeUrlChanges(callback) {
		let lastPath = window.location.pathname;

		const fireIfChanged = () => {
			const current = window.location.pathname;
			if (current !== lastPath) {
				lastPath = current;
				callback();
			}
		};

		window.addEventListener('cc:urlchange', fireIfChanged);
		window.addEventListener('popstate', fireIfChanged);

		return () => {
			window.removeEventListener('cc:urlchange', fireIfChanged);
			window.removeEventListener('popstate', fireIfChanged);
		};
	}

	function parseUsageFromUsageEndpoint(raw) {
		if (!raw || typeof raw !== 'object') return null;

		const normalizeWindow = (w) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			const utilization = Math.max(0, Math.min(100, w.utilization));
			const resets_at = typeof w.resets_at === 'string' ? w.resets_at : null;
			return { utilization, resets_at };
		};

		const fiveHour = normalizeWindow(raw.five_hour);
		const sevenDay = normalizeWindow(raw.seven_day);

		// If all limits/windows are null/empty, this is a Free tier account
		const isFreeTier = raw.five_hour === null && raw.seven_day === null && (!raw.limits || raw.limits.length === 0);

		return { isFreeTier, five_hour: fiveHour, seven_day: sevenDay };
	}

	function parseUsageFromMessageLimit(raw) {
		if (!raw || typeof raw !== 'object') return null;

		const normalizeWindow = (w) => {
			if (!w || typeof w !== 'object') return null;
			if (typeof w.utilization !== 'number' || !Number.isFinite(w.utilization)) return null;
			// windows utilization is typically a fraction 0.0 - 1.0 (e.g. 0.06 = 6%)
			const pct = w.utilization <= 1.0 && w.utilization > 0 ? w.utilization * 100 : w.utilization;
			const utilization = Math.max(0, Math.min(100, pct));
			let resets_at = null;
			if (typeof w.resets_at === 'number' && Number.isFinite(w.resets_at)) {
				const ms = w.resets_at < 1e11 ? w.resets_at * 1000 : w.resets_at;
				resets_at = new Date(ms).toISOString();
			} else if (typeof w.resets_at === 'string') {
				resets_at = w.resets_at;
			}
			return { utilization, resets_at };
		};

		let fiveHour = normalizeWindow(raw.windows?.['5h']);
		let sevenDay = normalizeWindow(raw.windows?.['7d']);

		// Fallback to resolved.limit if fiveHour window was not in windows
		if (!fiveHour && raw.resolved?.limit) {
			const lim = raw.resolved.limit;
			if (typeof lim.percent === 'number' && Number.isFinite(lim.percent)) {
				fiveHour = {
					utilization: Math.max(0, Math.min(100, lim.percent)),
					resets_at: typeof lim.resets_at === 'string' ? lim.resets_at : null
				};
			}
		}

		if (!fiveHour && !sevenDay) return null;
		return { five_hour: fiveHour, seven_day: sevenDay, isStale: false };
	}

	let currentConversationId = null;
	let currentOrgId = null;
	let latestConversationData = null;

	let accountTier = 'unknown'; // 'free' | 'pro' | 'unknown'
	let usageState = null;
	let usageResetMs = { five_hour: null, seven_day: null };
	let lastUsageSseMs = 0;
	let usageFetchInFlight = false;
	let lastUsageUpdateMs = 0;
	const rolloverHandledForResetMs = { five_hour: null, seven_day: null };
	let lastPeriodicUsageRefreshMs = Date.now();

	const ui = new CC.ui.CounterUI({
		onUsageRefresh: async () => {
			await refreshUsage();
		},
		onCopyChat: (format) => {
			if (!latestConversationData) return null;
			const trunk = CC.tokens.buildTrunk(latestConversationData);
			if (!trunk.length) return null;
			if (format === 'markdown') return CC.tokens.formatTrunkAsMarkdown(trunk);
			return CC.tokens.formatTrunkAsText(trunk);
		}
	});
	ui.initialize();

	// Hydrate cached usage state on startup
	if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
		chrome.storage.local.get(['pulse_usage_state'], (result) => {
			const data = result?.pulse_usage_state;
			if (!data || !data.usageState) return;

			const now = Date.now();
			const saved = data.usageState;
			const lastUpdate = data.lastUsageUpdateMs || 0;
			accountTier = data.accountTier || (saved.seven_day ? 'pro' : 'free');

			const resetMs = saved.five_hour?.resets_at ? Date.parse(saved.five_hour.resets_at) : null;

			// 1. If reset time passed, synthetic rollover to 0%
			if (resetMs && now >= resetMs) {
				applyUsageUpdate({
					five_hour: { utilization: 0, resets_at: null },
					seven_day: saved.seven_day,
					isStale: false
				}, 'rollover');
				return;
			}

			// 2. If Free tier and > 5h since sync (with no active future reset), mark stale
			const isOver5h = now - lastUpdate > 5 * 60 * 60 * 1000;
			if (accountTier === 'free' && isOver5h && (!resetMs || now >= resetMs)) {
				applyUsageUpdate({
					five_hour: null,
					seven_day: null,
					isStale: true
				}, 'stale_check');
				return;
			}

			// 3. Otherwise restore valid cached state
			usageState = saved;
			lastUsageUpdateMs = lastUpdate;
			usageResetMs.five_hour = resetMs;
			usageResetMs.seven_day = saved.seven_day?.resets_at ? Date.parse(saved.seven_day.resets_at) : null;
			ui.setUsage(Object.assign({}, saved, { accountTier }));
		});
	}

	const bridgeReady = CC.injectBridgeOnce();

	function applyUsageUpdate(normalized, source) {
		if (!normalized) return;
		const now = Date.now();
		usageState = normalized;
		lastUsageUpdateMs = now;
		if (source === 'sse') lastUsageSseMs = now;
		usageResetMs.five_hour = normalized.five_hour?.resets_at ? Date.parse(normalized.five_hour.resets_at) : null;
		usageResetMs.seven_day = normalized.seven_day?.resets_at ? Date.parse(normalized.seven_day.resets_at) : null;
		
		const stateWithTier = Object.assign({}, normalized, { accountTier });
		ui.setUsage(stateWithTier);

		if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
			try {
				chrome.storage.local.set({
					pulse_usage_state: {
						usageState: normalized,
						lastUsageUpdateMs: now,
						accountTier
					}
				});
			} catch (e) {
				// Context was invalidated, script will terminate on next tick check
			}
		}
	}

	function updateOrgIdIfNeeded(newOrgId) {
		if (newOrgId && typeof newOrgId === 'string' && newOrgId !== currentOrgId) {
			currentOrgId = newOrgId;
		}
	}

	async function refreshUsage() {
		await bridgeReady;
		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) return;
		updateOrgIdIfNeeded(orgId);

		if (usageFetchInFlight) return;
		usageFetchInFlight = true;
		let raw;
		try {
			raw = await CC.bridge.requestUsage(orgId);
		} catch {
			return;
		} finally {
			usageFetchInFlight = false;
		}

		const parsed = parseUsageFromUsageEndpoint(raw);
		if (!parsed) return;

		if (parsed.isFreeTier) {
			accountTier = 'free';
			// DO NOT clobber active usageState on Free tier!
			if (!usageState) {
				applyUsageUpdate({ five_hour: null, seven_day: null, isStale: true }, 'usage');
			} else {
				ui.setUsage(Object.assign({}, usageState, { accountTier: 'free' }));
			}
			return;
		}

		accountTier = 'pro';
		applyUsageUpdate({ five_hour: parsed.five_hour, seven_day: parsed.seven_day, isStale: false }, 'usage');
		lastPeriodicUsageRefreshMs = Date.now();
	}

	async function refreshConversation() {
		await bridgeReady;
		if (!currentConversationId) {
			ui.setConversationMetrics();
			return;
		}

		const orgId = currentOrgId || getOrgIdFromCookie();
		if (!orgId) return;
		updateOrgIdIfNeeded(orgId);

		try {
			await CC.bridge.requestConversation(orgId, currentConversationId);
		} catch {
			// ignore
		}
	}

	function handleGenerationStart() {
		if (!currentConversationId) return;
		ui.setPendingCache(true);
	}

	async function handleConversationPayload({ orgId, conversationId, data }) {
		if (!conversationId || conversationId !== currentConversationId) return;
		updateOrgIdIfNeeded(orgId);
		if (!data) return;

		latestConversationData = data;
		const metrics = await CC.tokens.computeConversationMetrics(data);
		ui.setConversationMetrics({ totalTokens: metrics.totalTokens, cachedUntil: metrics.cachedUntil });
	}

	function handleMessageLimit(messageLimit) {
		const parsed = parseUsageFromMessageLimit(messageLimit);
		if (parsed) {
			if (accountTier === 'unknown') accountTier = 'free';
			applyUsageUpdate(parsed, 'sse');
		}
	}

	CC.bridge.on('cc:generation_start', handleGenerationStart);
	CC.bridge.on('cc:conversation', handleConversationPayload);
	CC.bridge.on('cc:message_limit', handleMessageLimit);

	async function handleUrlChange() {
		currentConversationId = getConversationId();

		const waitFn = CC.waitForComposerBox || CC.waitForComposerSurface;
		waitFn(60000).then((el) => {
			if (el) ui.attachUsageLine();
		});
		CC.waitForHeaderAnchor(60000).then((el) => {
			if (el) ui.attachHeader();
		});

		if (!currentConversationId) {
			latestConversationData = null;
			ui.setConversationMetrics();
			return;
		}

		updateOrgIdIfNeeded(getOrgIdFromCookie());

		await refreshConversation();

		if (!usageState) await refreshUsage();
	}

	const unobserveUrl = observeUrlChanges(handleUrlChange);
	window.addEventListener('beforeunload', unobserveUrl);

	// Branch navigation: watch Previous/Next buttons for branch indicator change
	let branchObserver = null;
	document.addEventListener('click', (e) => {
		if (!currentConversationId) return;
		const btn = e.target.closest('button[aria-label="Previous"], button[aria-label="Next"]');
		if (!btn) return;

		const container = btn.closest('.inline-flex');
		const spans = container?.querySelectorAll('span') || [];
		const indicator = Array.from(spans).find((s) => /^\d+\s*\/\s*\d+$/.test(s.textContent.trim()));
		if (!indicator) return;

		const originalText = indicator.textContent;

		if (branchObserver) branchObserver.disconnect();

		branchObserver = new MutationObserver(() => {
			if (indicator.textContent !== originalText) {
				branchObserver.disconnect();
				branchObserver = null;
				refreshConversation();
			}
		});

		branchObserver.observe(indicator, { childList: true, characterData: true, subtree: true });

		setTimeout(() => {
			if (branchObserver) {
				branchObserver.disconnect();
				branchObserver = null;
			}
		}, 60000);
	});

	if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
		chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
			if (request && request.action === 'refresh_usage') {
				refreshUsage().then(() => {
					sendResponse({ success: true });
				}).catch(() => {
					sendResponse({ success: false });
				});
				return true;
			}
		});
	}

	handleUrlChange();

	function tick() {
		ui.tick();

		const now = Date.now();

		if (
			usageResetMs.five_hour &&
			now >= usageResetMs.five_hour &&
			rolloverHandledForResetMs.five_hour !== usageResetMs.five_hour
		) {
			rolloverHandledForResetMs.five_hour = usageResetMs.five_hour;
			if (accountTier === 'free') {
				applyUsageUpdate({
					five_hour: { utilization: 0, resets_at: null },
					seven_day: usageState?.seven_day || null,
					isStale: false
				}, 'rollover');
			} else {
				refreshUsage();
			}
		}
		if (
			usageResetMs.seven_day &&
			now >= usageResetMs.seven_day &&
			rolloverHandledForResetMs.seven_day !== usageResetMs.seven_day
		) {
			rolloverHandledForResetMs.seven_day = usageResetMs.seven_day;
			refreshUsage();
		}

		// Also check 5h stale condition in tick for Free tier
		if (accountTier === 'free' && usageState && !usageState.isStale && !usageResetMs.five_hour) {
			if (lastUsageUpdateMs && now - lastUsageUpdateMs > 5 * 60 * 60 * 1000) {
				applyUsageUpdate({
					five_hour: null,
					seven_day: null,
					isStale: true
				}, 'stale_check');
			}
		}

		// Hourly safety refresh if SSE has been silent (Pro tier only)
		const ONE_HOUR_MS = 60 * 60 * 1000;
		if (
			accountTier !== 'free' &&
			!document.hidden &&
			now - lastUsageSseMs > ONE_HOUR_MS &&
			now - lastUsageUpdateMs > ONE_HOUR_MS
		) {
			refreshUsage();
		}

		// Periodic usage refresh every 2 minutes while tab is visible (Pro tier only)
		const TWO_MIN_MS = 2 * 60 * 1000;
		if (accountTier !== 'free' && !document.hidden && now - lastPeriodicUsageRefreshMs >= TWO_MIN_MS) {
			lastPeriodicUsageRefreshMs = now;
			refreshUsage();
		}
	}

	setInterval(tick, 1000);
})();
