/* ═══════════════════════════════════════════════
   Claude Pulse — Popup Script
   Data Access Approach: Option A
   - Reads cached metrics from `chrome.storage.local` to show usage instantly.
   - Relays refresh requests to active claude.ai tabs via messaging.
   - Smallest permission/complexity footprint (zero new permissions needed).
   ═══════════════════════════════════════════════ */

(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	document.addEventListener('DOMContentLoaded', () => {
		initTheme();
		loadCachedData();
		setupListeners();
	});

	function initTheme() {
		if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
			chrome.storage.local.get(['pulse_theme_mode'], (result) => {
				const mode = result.pulse_theme_mode || 
				             (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
				document.documentElement.setAttribute('data-mode', mode);
			});
		} else {
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			document.documentElement.setAttribute('data-mode', prefersDark ? 'dark' : 'light');
		}
	}

	function loadCachedData() {
		if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
			renderPlaceholder();
			return;
		}

		chrome.storage.local.get(['pulse_usage_state'], (result) => {
			const data = result.pulse_usage_state;
			if (!data || !data.usageState) {
				renderPlaceholder();
				return;
			}
			renderMetrics(data.usageState, data.lastUsageUpdateMs);
		});
	}

	function renderPlaceholder() {
		const sessionBar = document.getElementById('session-bar-fill');
		const sessionMeta = document.getElementById('session-meta');
		const noteEl = document.querySelector('.pp-note');
		const syncEl = document.querySelector('.pp-sync__text');

		if (sessionBar) {
			sessionBar.style.width = '0%';
			sessionBar.classList.remove('pp-warn', 'pp-critical');
		}
		if (sessionMeta) {
			sessionMeta.textContent = '0%';
			sessionMeta.classList.remove('pp-warn-text', 'pp-critical-text');
		}
		if (noteEl) noteEl.textContent = 'Awaiting data sync';
		if (syncEl) {
			syncEl.textContent = 'Not synced yet';
			syncEl.classList.add('stale');
		}
	}

	function renderMetrics(usageState, lastUsageUpdateMs) {
		const sessionBar = document.getElementById('session-bar-fill');
		const sessionMeta = document.getElementById('session-meta');
		const noteEl = document.querySelector('.pp-note');
		const syncEl = document.querySelector('.pp-sync__text');

		const fiveHour = usageState.five_hour;

		// 1. Render 5h Limit Row
		if (fiveHour && typeof fiveHour.utilization === 'number') {
			const used = Math.round(fiveHour.utilization * 10) / 10;
			if (sessionBar) {
				sessionBar.style.width = `${used}%`;
				sessionBar.classList.toggle('pp-warn', used >= 80 && used < 95);
				sessionBar.classList.toggle('pp-critical', used >= 95);
			}
			if (sessionMeta) {
				sessionMeta.textContent = `${used}%`;
				sessionMeta.classList.toggle('pp-warn-text', used >= 80 && used < 95);
				sessionMeta.classList.toggle('pp-critical-text', used >= 95);
			}
		} else {
			if (sessionBar) {
				sessionBar.style.width = '0%';
				sessionBar.classList.remove('pp-warn', 'pp-critical');
			}
			if (sessionMeta) {
				sessionMeta.textContent = '0%';
				sessionMeta.classList.remove('pp-warn-text', 'pp-critical-text');
			}
		}

		// 2. Render Resets Note
		let noteText = 'No resets scheduled';
		if (CC.format && CC.format.formatResetCountdown) {
			if (fiveHour && fiveHour.resets_at) {
				const ms = Date.parse(fiveHour.resets_at);
				if (ms > Date.now()) {
					noteText = `Resets in ${CC.format.formatResetCountdown(ms)}`;
				}
			}
		}
		if (noteEl) {
			noteEl.textContent = noteText;
		}

		// 4. Render Last Sync
		if (syncEl && typeof lastUsageUpdateMs === 'number') {
			const syncDiff = Date.now() - lastUsageUpdateMs;
			syncEl.classList.remove('stale');
			
			if (syncDiff < 60000) {
				syncEl.textContent = 'Synced: Just now';
			} else {
				const mins = Math.floor(syncDiff / 60000);
				if (mins < 60) {
					syncEl.textContent = `Synced ${mins}m ago`;
				} else {
					const hrs = Math.floor(mins / 60);
					syncEl.textContent = `Synced ${hrs}h ago`;
				}
			}

			// Flag syncs older than 2 minutes as stale
			if (syncDiff >= 120000) {
				syncEl.classList.add('stale');
				syncEl.textContent += ' (open claude.ai)';
			}
		}
	}

	function setupListeners() {
		const refreshBtn = document.querySelector('.pp-refresh');
		const syncEl = document.querySelector('.pp-sync__text');

		if (refreshBtn) {
			refreshBtn.addEventListener('click', () => {
				if (typeof chrome === 'undefined' || !chrome.tabs) return;

				refreshBtn.disabled = true;
				refreshBtn.classList.add('pp-refresh--busy');

				// Query for open Claude.ai tabs
				chrome.tabs.query({ url: '*://claude.ai/*' }, (tabs) => {
					if (tabs && tabs.length > 0) {
						let responseReceived = false;

						// Send relay message to the first Claude tab
						chrome.tabs.sendMessage(tabs[0].id, { action: 'refresh_usage' }, (response) => {
							responseReceived = true;
							refreshBtn.disabled = false;
							refreshBtn.classList.remove('pp-refresh--busy');
							if (response && response.success) {
								loadCachedData();
							}
						});

						// Timeout safety fallback
						setTimeout(() => {
							if (!responseReceived) {
								refreshBtn.disabled = false;
								refreshBtn.classList.remove('pp-refresh--busy');
							}
						}, 4000);
					} else {
						// No active Claude tab open to relay the fetch
						refreshBtn.disabled = false;
						refreshBtn.classList.remove('pp-refresh--busy');
						if (syncEl) {
							syncEl.textContent = 'Open claude.ai to refresh';
							syncEl.classList.add('stale');
						}
					}
				});
			});
		}

		// Listen for storage updates in real-time
		if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
			chrome.storage.onChanged.addListener((changes, areaName) => {
				if (areaName === 'local') {
					if (changes.pulse_usage_state) {
						const newState = changes.pulse_usage_state.newValue;
						if (newState && newState.usageState) {
							renderMetrics(newState.usageState, newState.lastUsageUpdateMs);
						}
					}
					if (changes.pulse_theme_mode) {
						const newMode = changes.pulse_theme_mode.newValue;
						if (newMode) {
							document.documentElement.setAttribute('data-mode', newMode);
						}
					}
				}
			});
		}
	}
})();
