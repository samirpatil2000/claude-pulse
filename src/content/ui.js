(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	// ── Formatting helpers ──

	function formatSeconds(totalSeconds) {
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes}:${String(seconds).padStart(2, '0')}`;
	}

	function formatResetCountdown(timestampMs) {
		const diffMs = timestampMs - Date.now();
		if (diffMs <= 0) return '0s';

		const totalSeconds = Math.floor(diffMs / 1000);
		if (totalSeconds < 60) return `${totalSeconds}s`;

		const totalMinutes = Math.round(totalSeconds / 60);
		if (totalMinutes < 60) return `${totalMinutes}m`;

		const hours = Math.floor(totalMinutes / 60);
		const minutes = totalMinutes % 60;
		if (hours < 24) return `${hours}h ${minutes}m`;

		const days = Math.floor(hours / 24);
		const remHours = hours % 24;
		return `${days}d ${remHours}h`;
	}

	function formatTokens(count) {
		if (count >= 1000) {
			const k = count / 1000;
			const formatted = k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '');
			return `~${formatted}k`;
		}
		return `~${count}`;
	}

	// ── Tooltip system ──

	function setupTooltip(element, tooltip, { topOffset = 10 } = {}) {
		if (!element || !tooltip) return;
		if (element.hasAttribute('data-tooltip-setup')) return;
		element.setAttribute('data-tooltip-setup', 'true');
		element.classList.add('cc-tooltipTrigger');

		let pressTimer;
		let hideTimer;

		const show = () => {
			const rect = element.getBoundingClientRect();
			tooltip.classList.add('cc-tooltip--visible');
			// Force reflow so we can measure
			tooltip.style.opacity = '1';
			const tipRect = tooltip.getBoundingClientRect();

			let left = rect.left + rect.width / 2;
			if (left + tipRect.width / 2 > window.innerWidth) left = window.innerWidth - tipRect.width / 2 - 10;
			if (left - tipRect.width / 2 < 0) left = tipRect.width / 2 + 10;

			let top = rect.top - tipRect.height - topOffset;
			if (top < 10) top = rect.bottom + 10;

			tooltip.style.left = `${left}px`;
			tooltip.style.top = `${top}px`;
			tooltip.style.transform = 'translateX(-50%)';
		};

		const hide = () => {
			tooltip.classList.remove('cc-tooltip--visible');
			tooltip.style.opacity = '0';
			tooltip.style.transform = 'translateX(-50%) translateY(4px)';
			clearTimeout(hideTimer);
		};

		element.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'touch' || e.pointerType === 'pen') {
				pressTimer = setTimeout(() => {
					show();
					hideTimer = setTimeout(hide, 3000);
				}, 500);
			}
		});

		element.addEventListener('pointerup', () => clearTimeout(pressTimer));
		element.addEventListener('pointercancel', () => {
			clearTimeout(pressTimer);
			hide();
		});

		element.addEventListener('pointerenter', (e) => {
			if (e.pointerType === 'mouse') show();
		});

		element.addEventListener('pointerleave', (e) => {
			if (e.pointerType === 'mouse') hide();
		});
	}

	function makeTooltip(text) {
		const tip = document.createElement('div');
		tip.className = 'cc-tooltip';
		tip.textContent = text;
		document.body.appendChild(tip);
		return tip;
	}

	// ── Main UI class ──

	class CounterUI {
		constructor({ onUsageRefresh, onCopyChat } = {}) {
			this.onUsageRefresh = onUsageRefresh || null;
			this.onCopyChat = onCopyChat || null;

			this.headerContainer = null;
			this.headerDisplay = null;
			this.lengthGroup = null;
			this.lengthDisplay = null;
			this.cachedDisplay = null;
			this.lengthBar = null;
			this.lengthTooltip = null;
			this.lastCachedUntilMs = null;
			this.pendingCache = false;

			this.usageLine = null;
			this.sessionUsageSpan = null;
			this.weeklyUsageSpan = null;
			this.sessionBar = null;
			this.sessionBarFill = null;
			this.weeklyBar = null;
			this.weeklyBarFill = null;
			this.sessionResetMs = null;
			this.weeklyResetMs = null;
			this.sessionMarker = null;
			this.weeklyMarker = null;
			this.sessionWindowStartMs = null;
			this.weeklyWindowStartMs = null;
			this.refreshingUsage = false;

			this.domObserver = null;
		}

		_isDark() {
			const root = document.documentElement;
			return root.dataset?.mode === 'dark';
		}

		getProgressChrome() {
			const isDark = this._isDark();

			return {
				strokeColor: isDark ? CC.COLORS.PROGRESS_OUTLINE_DARK : CC.COLORS.PROGRESS_OUTLINE_LIGHT,
				trackColor: isDark ? CC.COLORS.PROGRESS_TRACK_DARK : CC.COLORS.PROGRESS_TRACK_LIGHT,
				fillColor: isDark ? CC.COLORS.PROGRESS_FILL_DARK : CC.COLORS.PROGRESS_FILL_LIGHT,
				markerColor: isDark ? CC.COLORS.PROGRESS_MARKER_DARK : CC.COLORS.PROGRESS_MARKER_LIGHT,
				boldColor: isDark ? CC.COLORS.BOLD_DARK : CC.COLORS.BOLD_LIGHT,
				cacheColor: isDark ? CC.COLORS.CACHE_ACTIVE_DARK : CC.COLORS.CACHE_ACTIVE_LIGHT
			};
		}

		refreshProgressChrome() {
			const { strokeColor, trackColor, fillColor, markerColor } = this.getProgressChrome();

			const applyBarChrome = (bar, { fillWarn, fillCritical } = {}) => {
				if (!bar) return;
				bar.style.setProperty('--cc-stroke', strokeColor);
				bar.style.setProperty('--cc-track', trackColor);
				bar.style.setProperty('--cc-fill', fillColor);
				bar.style.setProperty('--cc-fill-warn', fillWarn ?? fillColor);
				bar.style.setProperty('--cc-fill-critical', fillCritical ?? fillWarn ?? fillColor);
				bar.style.setProperty('--cc-marker', markerColor);
			};

			applyBarChrome(this.lengthBar, { fillWarn: fillColor });
			applyBarChrome(this.sessionBar, { fillWarn: CC.COLORS.AMBER_WARNING, fillCritical: CC.COLORS.CRITICAL_WARNING });
			applyBarChrome(this.weeklyBar, { fillWarn: CC.COLORS.AMBER_WARNING, fillCritical: CC.COLORS.CRITICAL_WARNING });
		}

		initialize() {
			this.headerContainer = document.createElement('div');
			this.headerContainer.className = 'text-text-500 text-xs !px-1 cc-header';

			this.headerDisplay = document.createElement('span');
			this.headerDisplay.className = 'cc-headerItem';

			this.logoContainer = document.createElement('span');
			this.logoContainer.className = 'cc-logo';
			this.logoContainer.innerHTML = `
				<svg width="13" height="13" viewBox="0 0 300 300" fill="none" xmlns="http://www.w3.org/2000/svg">
					<rect x="40" y="38" width="210" height="210" rx="48" fill="currentColor" fill-opacity="0.1"/>
					<path d="M64 143 L112 143 L132 88 L152 198 L167 143 L226 143" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
				</svg>
			`;

			this.lengthGroup = document.createElement('span');
			this.lengthGroup.className = 'cc-tooltipTrigger';
			this.lengthDisplay = document.createElement('span');
			this.cachedDisplay = document.createElement('span');
			this.cacheTimeSpan = null;

			this.lengthGroup.appendChild(this.lengthDisplay);
			this.headerDisplay.appendChild(this.lengthGroup);

			this._initCopyButton();
			this._initUsageLine();
			this._setupTooltips();
			this._observeDom();
			this._observeTheme();
		}

		_observeTheme() {
			const observer = new MutationObserver(() => this.refreshProgressChrome());
			observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
		}

		_observeDom() {
			let usageReattachPending = false;
			let headerReattachPending = false;

			this.domObserver = new MutationObserver(() => {
				const usageMissing = this.usageLine && !document.contains(this.usageLine);
				const headerMissing = !document.contains(this.headerContainer);

				if (usageMissing && !usageReattachPending) {
					usageReattachPending = true;
					CC.waitForElement(CC.DOM.MODEL_SELECTOR_DROPDOWN, 60000).then((el) => {
						usageReattachPending = false;
						if (el) this.attachUsageLine();
					});
				}

				if (headerMissing && !headerReattachPending) {
					headerReattachPending = true;
					CC.waitForElement(CC.DOM.CHAT_MENU_TRIGGER, 60000).then((el) => {
						headerReattachPending = false;
						if (el) this.attachHeader();
					});
				}
			});
			this.domObserver.observe(document.body, { childList: true, subtree: true });
		}

		_initUsageLine() {
			this.usageLine = document.createElement('div');
			this.usageLine.className =
				'text-text-400 text-[11px] cc-usageRow cc-hidden flex flex-row items-center gap-3 w-full';

			this.sessionUsageSpan = document.createElement('span');
			this.sessionUsageSpan.className = 'cc-usageText';

			this.sessionBar = document.createElement('div');
			this.sessionBar.className = 'cc-bar cc-bar--usage';
			this.sessionBarFill = document.createElement('div');
			this.sessionBarFill.className = 'cc-bar__fill';
			this.sessionMarker = document.createElement('div');
			this.sessionMarker.className = 'cc-bar__marker cc-hidden';
			this.sessionMarker.style.left = '0%';
			this.sessionBar.appendChild(this.sessionBarFill);
			this.sessionBar.appendChild(this.sessionMarker);

			this.weeklyUsageSpan = document.createElement('span');
			this.weeklyUsageSpan.className = 'cc-usageText';

			this.weeklyBar = document.createElement('div');
			this.weeklyBar.className = 'cc-bar cc-bar--usage';
			this.weeklyBarFill = document.createElement('div');
			this.weeklyBarFill.className = 'cc-bar__fill';
			this.weeklyMarker = document.createElement('div');
			this.weeklyMarker.className = 'cc-bar__marker cc-hidden';
			this.weeklyMarker.style.left = '0%';
			this.weeklyBar.appendChild(this.weeklyBarFill);
			this.weeklyBar.appendChild(this.weeklyMarker);

			this.sessionGroup = document.createElement('div');
			this.sessionGroup.className = 'cc-usageGroup';
			this.sessionGroup.appendChild(this.sessionUsageSpan);
			this.sessionGroup.appendChild(this.sessionBar);

			this.weeklyGroup = document.createElement('div');
			this.weeklyGroup.className = 'cc-usageGroup cc-usageGroup--weekly';
			this.weeklyGroup.appendChild(this.weeklyBar);
			this.weeklyGroup.appendChild(this.weeklyUsageSpan);

			this.usageLine.appendChild(this.sessionGroup);
			this.usageLine.appendChild(this.weeklyGroup);

			this.refreshProgressChrome();

			this.usageLine.addEventListener('click', async () => {
				if (!this.onUsageRefresh || this.refreshingUsage) return;
				this.refreshingUsage = true;
				this.usageLine.classList.add('cc-usageRow--dim');

				// Spin logo on refresh
				this.logoContainer.classList.add('cc-logo--spinning');
				try {
					await this.onUsageRefresh();
				} finally {
					this.usageLine.classList.remove('cc-usageRow--dim');
					this.logoContainer.classList.remove('cc-logo--spinning');
					this.refreshingUsage = false;
				}
			});
		}

		_setupTooltips() {
			this.lengthTooltip = makeTooltip(
				"Approximate token count · excludes system prompt\n200k context limit · compacts before reaching it\nGeneric tokenizer — may differ slightly from Claude's"
			);
			setupTooltip(this.lengthGroup, this.lengthTooltip, { topOffset: 8 });

			setupTooltip(
				this.cachedDisplay,
				makeTooltip('Messages sent while cached cost significantly less.'),
				{ topOffset: 8 }
			);

			this._copyTooltip = makeTooltip('Export chat history');
			setupTooltip(this.copyButton, this._copyTooltip, { topOffset: 8 });

			this._sessionTooltip = makeTooltip('5-hour session window\nBar = usage · Line = time position\nClick to refresh');
			setupTooltip(this.sessionGroup, this._sessionTooltip, { topOffset: 8 });

			this._weeklyTooltip = makeTooltip('7-day rolling window\nBar = usage · Line = time position\nClick to refresh');
			setupTooltip(this.weeklyGroup, this._weeklyTooltip, { topOffset: 8 });
		}

		attach() {
			this.attachHeader();
			this.attachUsageLine();
			this.refreshProgressChrome();
		}

		attachHeader() {
			const chatMenu = document.querySelector(CC.DOM.CHAT_MENU_TRIGGER);
			if (!chatMenu) return;
			const anchor = chatMenu.closest(CC.DOM.CHAT_PROJECT_WRAPPER) || chatMenu.parentElement;
			if (!anchor) return;
			if (anchor.nextElementSibling !== this.headerContainer) {
				anchor.after(this.headerContainer);
			}
			this._renderHeader();
			this.refreshProgressChrome();
		}

		attachUsageLine() {
			if (!this.usageLine) return;
			const modelSelector = document.querySelector(CC.DOM.MODEL_SELECTOR_DROPDOWN);
			if (!modelSelector) return;

			const gridContainer = modelSelector.closest('[data-testid="chat-input-grid-container"]');
			const gridArea = modelSelector.closest('[data-testid="chat-input-grid-area"]');

			const findToolbarRow = (el, stopAt) => {
				let cur = el;
				while (cur && cur !== document.body) {
					if (stopAt && cur === stopAt) break;
					if (cur !== el && cur.nodeType === 1) {
						const style = window.getComputedStyle(cur);
						if (style.display === 'flex' && style.flexDirection === 'row') {
							const buttons = cur.querySelectorAll('button').length;
							if (buttons > 1) return cur;
						}
					}
					cur = cur.parentElement;
				}
				return null;
			};

			const toolbarRow =
				(gridContainer ? findToolbarRow(modelSelector, gridArea || gridContainer) : null) ||
				findToolbarRow(modelSelector) ||
				modelSelector.parentElement?.parentElement?.parentElement;
			if (!toolbarRow) return;

			if (toolbarRow.nextElementSibling !== this.usageLine) {
				toolbarRow.after(this.usageLine);
			}
			this.refreshProgressChrome();
		}

		setPendingCache(pending) {
			this.pendingCache = pending;
			if (this.cacheTimeSpan) {
				if (pending) {
					this.cacheTimeSpan.style.color = '';
				} else {
					const { cacheColor } = this.getProgressChrome();
					this.cacheTimeSpan.style.color = cacheColor;
				}
			}
		}

		setConversationMetrics({ totalTokens, cachedUntil } = {}) {
			this.pendingCache = false;

			if (typeof totalTokens !== 'number') {
				this.lengthDisplay.textContent = '';
				this.cachedDisplay.textContent = '';
				this.lastCachedUntilMs = null;
				this._renderHeader();
				return;
			}

			const pct = Math.max(0, Math.min(100, (totalTokens / CC.CONST.CONTEXT_LIMIT_TOKENS) * 100));
			this.lengthDisplay.textContent = `${formatTokens(totalTokens)} tokens`;

			const isFull = pct >= 99.5;
			if (isFull) {
				this.lengthDisplay.style.opacity = '0.5';
				this.lengthBar = null;
				this.lengthGroup.replaceChildren(this.lengthDisplay);
				if (this.lengthTooltip) {
					this.lengthTooltip.textContent =
						"Token count invalid after context compaction\nGeneric tokenizer · excludes system prompt";
				}
			} else {
				this.lengthDisplay.style.opacity = '';
				const bar = document.createElement('div');
				bar.className = 'cc-bar cc-bar--mini';
				this.lengthBar = bar;
				const fill = document.createElement('div');
				fill.className = 'cc-bar__fill';
				fill.style.width = `${pct}%`;
				bar.appendChild(fill);
				this.refreshProgressChrome();

				const barContainer = document.createElement('span');
				barContainer.className = 'inline-flex items-center';
				barContainer.appendChild(bar);

				this.lengthGroup.replaceChildren(
					this.lengthDisplay,
					document.createTextNode('  '),
					barContainer
				);
			}

			const now = Date.now();
			if (typeof cachedUntil === 'number' && cachedUntil > now) {
				this.lastCachedUntilMs = cachedUntil;
				const secondsLeft = Math.max(0, Math.ceil((cachedUntil - now) / 1000));
				const { cacheColor } = this.getProgressChrome();
				this.cacheTimeSpan = Object.assign(document.createElement('span'), {
					className: 'cc-cacheTime',
					textContent: formatSeconds(secondsLeft)
				});
				this.cacheTimeSpan.style.color = cacheColor;

				const cacheWrapper = document.createElement('span');
				cacheWrapper.className = 'cc-cacheActive';
				cacheWrapper.appendChild(document.createTextNode('cached '));
				cacheWrapper.appendChild(this.cacheTimeSpan);
				this.cachedDisplay.replaceChildren(cacheWrapper);
			} else {
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
				this.cachedDisplay.textContent = '';
			}

			this._renderHeader();
		}

		_renderHeader() {
			this.headerContainer.replaceChildren();

			const hasTokens = !!this.lengthDisplay.textContent;
			const hasCache = !!this.cachedDisplay.textContent;

			if (!hasTokens) return;

			const items = [this.logoContainer, this.lengthGroup];
			if (hasCache) {
				const sep = document.createElement('span');
				sep.className = 'cc-sep';
				sep.textContent = '·';
				items.push(sep, this.cachedDisplay);
			}

			// Add copy button separator and button
			const copySep = document.createElement('span');
			copySep.className = 'cc-sep';
			copySep.textContent = '·';
			items.push(copySep, this.copyButton);

			this.headerDisplay.replaceChildren(...items);
			this.headerContainer.appendChild(this.headerDisplay);
		}

		setUsage(usage) {
			this.refreshProgressChrome();
			const session = usage?.five_hour || null;
			const weekly = usage?.seven_day || null;
			const hasAnyUsage =
				!!(session && typeof session.utilization === 'number') ||
				!!(weekly && typeof weekly.utilization === 'number');
			this.usageLine?.classList.toggle('cc-hidden', !hasAnyUsage);

			if (session && typeof session.utilization === 'number') {
				const rawPct = session.utilization;
				const pct = Math.round(rawPct * 10) / 10;
				this.sessionResetMs = session.resets_at ? Date.parse(session.resets_at) : null;
				this.sessionWindowStartMs = this.sessionResetMs ? this.sessionResetMs - 5 * 60 * 60 * 1000 : null;

				// Compact label: "5h 42.3%"
				this.sessionUsageSpan.textContent = `5h ${pct}%`;

				// Update tooltip with reset info
				if (this._sessionTooltip && this.sessionResetMs) {
					this._sessionTooltip.textContent = `5-hour session window\nBar = usage · Line = time position\nResets in ${formatResetCountdown(this.sessionResetMs)}\nClick to refresh`;
				}

				const width = Math.max(0, Math.min(100, rawPct));
				this.sessionBarFill.style.width = `${width}%`;
				this.sessionBarFill.classList.toggle('cc-warn', width >= 80 && width < 95);
				this.sessionBarFill.classList.toggle('cc-critical', width >= 95);
				this.sessionBarFill.classList.remove('cc-full');
				if (width >= 99.5) this.sessionBarFill.classList.add('cc-full');
			} else {
				this.sessionUsageSpan.textContent = '';
				this.sessionBarFill.style.width = '0%';
				this.sessionBarFill.classList.remove('cc-warn', 'cc-critical', 'cc-full');
				this.sessionResetMs = null;
				this.sessionWindowStartMs = null;
			}

			const hasWeekly = weekly && typeof weekly.utilization === 'number';
			this.weeklyGroup?.classList.toggle('cc-hidden', !hasWeekly);
			this.sessionGroup?.classList.toggle('cc-usageGroup--single', !hasWeekly);

			if (hasWeekly) {
				this.weeklyUsageSpan.classList.remove('cc-hidden');
				this.weeklyBar.classList.remove('cc-hidden');

				const rawPct = weekly.utilization;
				const pct = Math.round(rawPct * 10) / 10;
				this.weeklyResetMs = weekly.resets_at ? Date.parse(weekly.resets_at) : null;
				this.weeklyWindowStartMs = this.weeklyResetMs ? this.weeklyResetMs - 7 * 24 * 60 * 60 * 1000 : null;

				// Compact label: "7d 18.2%"
				this.weeklyUsageSpan.textContent = `7d ${pct}%`;

				// Update tooltip with reset info
				if (this._weeklyTooltip && this.weeklyResetMs) {
					this._weeklyTooltip.textContent = `7-day rolling window\nBar = usage · Line = time position\nResets in ${formatResetCountdown(this.weeklyResetMs)}\nClick to refresh`;
				}

				const width = Math.max(0, Math.min(100, rawPct));
				this.weeklyBarFill.style.width = `${width}%`;
				this.weeklyBarFill.classList.toggle('cc-warn', width >= 80 && width < 95);
				this.weeklyBarFill.classList.toggle('cc-critical', width >= 95);
				this.weeklyBarFill.classList.remove('cc-full');
				if (width >= 99.5) this.weeklyBarFill.classList.add('cc-full');
			} else {
				this.weeklyUsageSpan.classList.add('cc-hidden');
				this.weeklyBar.classList.add('cc-hidden');
				this.weeklyResetMs = null;
				this.weeklyWindowStartMs = null;
				this.weeklyBarFill.classList.remove('cc-warn', 'cc-critical', 'cc-full');
			}

			this._updateMarkers();
		}

		_updateMarkers() {
			const now = Date.now();

			if (this.sessionMarker && this.sessionWindowStartMs && this.sessionResetMs) {
				const total = this.sessionResetMs - this.sessionWindowStartMs;
				const elapsed = Math.max(0, Math.min(total, now - this.sessionWindowStartMs));
				const ratio = total > 0 ? elapsed / total : 0;
				const pct = Math.max(0, Math.min(100, ratio * 100));
				this.sessionMarker.classList.remove('cc-hidden');
				this.sessionMarker.style.left = `${pct}%`;
			} else if (this.sessionMarker) {
				this.sessionMarker.classList.add('cc-hidden');
			}

			if (this.weeklyMarker && this.weeklyWindowStartMs && this.weeklyResetMs) {
				const total = this.weeklyResetMs - this.weeklyWindowStartMs;
				const elapsed = Math.max(0, Math.min(total, now - this.weeklyWindowStartMs));
				const ratio = total > 0 ? elapsed / total : 0;
				const pct = Math.max(0, Math.min(100, ratio * 100));
				this.weeklyMarker.classList.remove('cc-hidden');
				this.weeklyMarker.style.left = `${pct}%`;
			} else if (this.weeklyMarker) {
				this.weeklyMarker.classList.add('cc-hidden');
			}
		}

		tick() {
			const now = Date.now();

			if (this.lastCachedUntilMs && this.lastCachedUntilMs > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.lastCachedUntilMs - now) / 1000));
				if (this.cacheTimeSpan) {
					this.cacheTimeSpan.textContent = formatSeconds(secondsLeft);
				}
			} else if (this.lastCachedUntilMs && this.lastCachedUntilMs <= now) {
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
				this.pendingCache = false;
				this.cachedDisplay.textContent = '';
				this._renderHeader();
			}

			// Update tooltip reset countdown (progressive disclosure)
			if (this._sessionTooltip && this.sessionResetMs) {
				this._sessionTooltip.textContent = `5-hour session window\nBar = usage · Line = time position\nResets in ${formatResetCountdown(this.sessionResetMs)}\nClick to refresh`;
			}

			if (this._weeklyTooltip && this.weeklyResetMs) {
				this._weeklyTooltip.textContent = `7-day rolling window\nBar = usage · Line = time position\nResets in ${formatResetCountdown(this.weeklyResetMs)}\nClick to refresh`;
			}

			this._updateMarkers();
		}

		// ── Copy button + dropdown ──

		_initCopyButton() {
			this.copyButton = document.createElement('span');
			this.copyButton.className = 'cc-copyBtn cc-tooltipTrigger';
			this.copyButton.innerHTML = `
				<svg class="cc-copyBtn__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
					<polyline points="16 6 12 2 8 6"></polyline>
					<line x1="12" y1="2" x2="12" y2="15"></line>
				</svg>
				<svg class="cc-copyBtn__check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="20 6 9 17 4 12"></polyline>
				</svg>
			`;

			// Dropdown
			this.copyDropdown = document.createElement('div');
			this.copyDropdown.className = 'cc-copyDropdown';

			const makeOption = (label, format) => {
				const btn = document.createElement('button');
				btn.className = 'cc-copyDropdown__item';
				btn.textContent = label;
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					this._doCopy(format);
				});
				return btn;
			};

			this.copyDropdown.appendChild(makeOption('Copy as Text', 'text'));
			this.copyDropdown.appendChild(makeOption('Copy as Markdown', 'markdown'));
			document.body.appendChild(this.copyDropdown);

			// Toggle dropdown on button click
			this.copyButton.addEventListener('click', (e) => {
				e.stopPropagation();
				this._toggleCopyDropdown();
			});

			// Close dropdown on outside click
			document.addEventListener('click', () => {
				this._closeCopyDropdown();
			});
		}

		_toggleCopyDropdown() {
			const isOpen = this.copyDropdown.classList.contains('cc-copyDropdown--open');
			if (isOpen) {
				this._closeCopyDropdown();
				return;
			}

			const rect = this.copyButton.getBoundingClientRect();
			this.copyDropdown.style.top = `${rect.bottom + 6}px`;
			this.copyDropdown.style.left = `${rect.left}px`;
			this.copyDropdown.classList.add('cc-copyDropdown--open');
		}

		_closeCopyDropdown() {
			this.copyDropdown.classList.remove('cc-copyDropdown--open');
		}

		async _doCopy(format) {
			this._closeCopyDropdown();
			if (!this.onCopyChat) return;

			try {
				const text = await this.onCopyChat(format);
				if (!text) return;
				await navigator.clipboard.writeText(text);
				this._showCopySuccess();
			} catch (err) {
				console.warn('[Claude Pulse] Copy failed:', err);
			}
		}

		_showCopySuccess() {
			this.copyButton.classList.add('cc-copyBtn--done');
			setTimeout(() => {
				this.copyButton.classList.remove('cc-copyBtn--done');
			}, 1500);
		}
	}

	CC.ui = { CounterUI };
})();
