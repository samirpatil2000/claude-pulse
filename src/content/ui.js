(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	// ── Formatting helpers ──

	function formatTokens(count) {
		if (count >= 1000) {
			const k = count / 1000;
			const formatted = k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '');
			return `~${formatted}k`;
		}
		return `~${count}`;
	}

	const LENGTH_TOOLTIP_DEFAULT = 'Estimated tokens (~)';

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
			this.sessionPctSpan = null;
			this.sessionRemainSpan = null;
			this.weeklyPctSpan = null;
			this.weeklyRemainSpan = null;
			this._sessionUtilPct = null;
			this._weeklyUtilPct = null;
			this.sessionRing = null;
			this.sessionRingFill = null;
			this.weeklyRing = null;
			this.weeklyRingFill = null;
			this.sessionResetMs = null;
			this.weeklyResetMs = null;
			this.refreshingUsage = false;

			this.usageMetaGroup = null;
			this.usageRefreshBtn = null;

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

			const applyChrome = (el, { fillWarn, fillCritical } = {}) => {
				if (!el) return;
				el.style.setProperty('--cc-stroke', strokeColor);
				el.style.setProperty('--cc-track', trackColor);
				el.style.setProperty('--cc-fill', fillColor);
				el.style.setProperty('--cc-fill-warn', fillWarn ?? fillColor);
				el.style.setProperty('--cc-fill-critical', fillCritical ?? fillWarn ?? fillColor);
				el.style.setProperty('--cc-marker', markerColor);
			};

			applyChrome(this.lengthBar, { fillWarn: fillColor });
			applyChrome(this.sessionRing, {
				fillWarn: CC.COLORS.AMBER_WARNING,
				fillCritical: CC.COLORS.CRITICAL_WARNING
			});
			applyChrome(this.weeklyRing, {
				fillWarn: CC.COLORS.AMBER_WARNING,
				fillCritical: CC.COLORS.CRITICAL_WARNING
			});
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
			const saveTheme = () => {
				const mode = this._isDark() ? 'dark' : 'light';
				if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
					try {
						chrome.storage.local.set({ pulse_theme_mode: mode });
					} catch (e) {
						// ignore context invalidation
					}
				}
			};

			saveTheme();

			const observer = new MutationObserver(() => {
				this.refreshProgressChrome();
				saveTheme();
			});
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
					const waitFn = CC.waitForComposerBox || CC.waitForComposerSurface;
					waitFn(60000).then((el) => {
						usageReattachPending = false;
						if (el) this.attachUsageLine();
					});
				}

				if (headerMissing && !headerReattachPending) {
					headerReattachPending = true;
					CC.waitForHeaderAnchor(60000).then((el) => {
						headerReattachPending = false;
						if (el) this.attachHeader();
					});
				}
			});
			this.domObserver.observe(document.body, { childList: true, subtree: true });
		}

		_buildMeter(label) {
			const RING_R = 7;
			const CIRC = 2 * Math.PI * RING_R;

			const meter = document.createElement('div');
			meter.className = 'cc-meter cc-tooltipTrigger';

			const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			ring.setAttribute('class', 'cc-meter__ring');
			ring.setAttribute('viewBox', '0 0 18 18');
			ring.setAttribute('aria-hidden', 'true');

			const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			track.setAttribute('class', 'cc-meter__ringTrack');
			track.setAttribute('cx', '9');
			track.setAttribute('cy', '9');
			track.setAttribute('r', String(RING_R));

			const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
			fill.setAttribute('class', 'cc-meter__ringFill');
			fill.setAttribute('cx', '9');
			fill.setAttribute('cy', '9');
			fill.setAttribute('r', String(RING_R));
			fill.style.strokeDasharray = String(CIRC);
			fill.style.strokeDashoffset = String(CIRC);

			ring.appendChild(track);
			ring.appendChild(fill);

			const labelEl = document.createElement('span');
			labelEl.className = 'cc-meter__label';
			labelEl.textContent = label;

			const pct = document.createElement('span');
			pct.className = 'cc-meter__pct';

			const remain = document.createElement('span');
			remain.className = 'cc-meter__remain';

			meter.appendChild(ring);
			meter.appendChild(labelEl);
			meter.appendChild(pct);
			meter.appendChild(remain);

			return { meter, labelEl, pct, remain, ring, fill, circ: CIRC };
		}

		_setRingProgress(fill, circ, pct) {
			if (!fill) return;
			const clamped = Math.max(0, Math.min(100, pct));
			fill.style.strokeDashoffset = String(circ * (1 - clamped / 100));
		}

		_initUsageLine() {
			this.usageLine = document.createElement('div');
			this.usageLine.className = 'text-text-300 cc-usageRow';
			this.usageLine.setAttribute('role', 'group');
			this.usageLine.setAttribute('aria-label', 'Claude usage limits');

			const session = this._buildMeter('5h');
			this.sessionGroup = session.meter;
			this.sessionPctSpan = session.pct;
			this.sessionRemainSpan = session.remain;
			this.sessionRing = session.ring;
			this.sessionRingFill = session.fill;
			this._sessionRingCirc = session.circ;

			const weekly = this._buildMeter('7d');
			this.weeklyGroup = weekly.meter;
			this.weeklyGroup.classList.add('cc-hidden');
			this.weeklyPctSpan = weekly.pct;
			this.weeklyRemainSpan = weekly.remain;
			this.weeklyRing = weekly.ring;
			this.weeklyRingFill = weekly.fill;
			this._weeklyRingCirc = weekly.circ;

			this.usageLine.appendChild(this.sessionGroup);
			this.usageLine.appendChild(this.weeklyGroup);

			this.usageMetaGroup = document.createElement('div');
			this.usageMetaGroup.className = 'cc-usageMeta';

			this.usageRefreshBtn = document.createElement('button');
			this.usageRefreshBtn.type = 'button';
			this.usageRefreshBtn.className = 'cc-usageRefresh cc-tooltipTrigger';
			this.usageRefreshBtn.setAttribute('aria-label', 'Refresh usage');
			this.usageRefreshBtn.innerHTML = `
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M23 4v6h-6"></path>
					<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
				</svg>
			`;
			this.usageRefreshBtn.addEventListener('click', (e) => {
				e.preventDefault();
				e.stopPropagation();
				this._refreshUsage();
			});

			this.usageMetaGroup.appendChild(this.usageRefreshBtn);
			this.usageLine.appendChild(this.usageMetaGroup);

			this.setUsage({ five_hour: { utilization: 0, resets_at: null }, seven_day: null });
			this.refreshProgressChrome();
		}

		async _refreshUsage() {
			if (!this.onUsageRefresh || this.refreshingUsage) return;
			this.refreshingUsage = true;
			this.usageRefreshBtn.disabled = true;
			this.usageRefreshBtn.classList.add('cc-usageRefresh--busy');
			this.usageMetaGroup?.classList.add('cc-usageMeta--busy');
			try {
				await this.onUsageRefresh();
			} finally {
				this.usageRefreshBtn.disabled = false;
				this.usageRefreshBtn.classList.remove('cc-usageRefresh--busy');
				this.usageMetaGroup?.classList.remove('cc-usageMeta--busy');
				this.refreshingUsage = false;
			}
		}

		_setupTooltips() {
			this.lengthTooltip = makeTooltip(LENGTH_TOOLTIP_DEFAULT);
			setupTooltip(this.lengthGroup, this.lengthTooltip, { topOffset: 8 });

			setupTooltip(this.cachedDisplay, makeTooltip('Prompt cache'), { topOffset: 8 });

			this._copyTooltip = makeTooltip('Copy chat');
			setupTooltip(this.copyButton, this._copyTooltip, { topOffset: 8 });

			this._sessionTooltip = makeTooltip('5-hour session');
			setupTooltip(this.sessionGroup, this._sessionTooltip, { topOffset: 8 });

			this._weeklyTooltip = makeTooltip('7-day limit');
			setupTooltip(this.weeklyGroup, this._weeklyTooltip, { topOffset: 8 });

			this._usageRefreshTooltip = makeTooltip('Refresh usage');
			setupTooltip(this.usageRefreshBtn, this._usageRefreshTooltip, { topOffset: 8 });
		}

		attach() {
			this.attachHeader();
			this.attachUsageLine();
			this.refreshProgressChrome();
		}

		attachHeader() {
			const anchor = CC.findHeaderAnchor();
			if (!anchor) return;
			if (anchor.nextElementSibling !== this.headerContainer) {
				anchor.after(this.headerContainer);
			}
			this._renderHeader();
			this.refreshProgressChrome();
		}

		attachUsageLine() {
			if (!this.usageLine) return;
			const box = CC.findComposerBox ? CC.findComposerBox() : CC.findComposerSurface();
			if (!box) return;

			if (box.lastElementChild !== this.usageLine) {
				box.appendChild(this.usageLine);
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

			if (typeof totalTokens !== 'number' || totalTokens <= 0) {
				this.lengthDisplay.textContent = '';
				this.lengthBar = null;
				this.cachedDisplay.textContent = '';
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
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
					this.lengthTooltip.textContent = 'Unavailable after compaction';
				}
			} else {
				this.lengthDisplay.style.opacity = '';
				if (this.lengthTooltip) this.lengthTooltip.textContent = LENGTH_TOOLTIP_DEFAULT;
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
					textContent: CC.format.formatSeconds(secondsLeft)
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

			const hasTokens = !!this.lengthDisplay?.textContent;
			const hasCache = !!this.cachedDisplay?.textContent;
			const hasCopy = !!this.copyButton;

			if (!hasTokens && !hasCopy) return;

			const items = [];
			if (hasTokens) {
				items.push(this.logoContainer, this.lengthGroup);
				if (hasCache) {
					const sep = document.createElement('span');
					sep.className = 'cc-sep';
					sep.textContent = '·';
					items.push(sep, this.cachedDisplay);
				}
			} else {
				// While tokens are computing or if empty, still show logo
				items.push(this.logoContainer);
			}

			if (hasCopy) {
				const copySep = document.createElement('span');
				copySep.className = 'cc-sep';
				copySep.textContent = '·';
				items.push(copySep, this.copyButton);
			}

			this.headerDisplay.replaceChildren(...items);
			this.headerContainer.appendChild(this.headerDisplay);
		}

		_applyMeterLevel(fill, pctEl, meterEl, width) {
			const warn = width >= 80 && width < 95;
			const critical = width >= 95;
			fill?.classList.toggle('cc-warn', warn);
			fill?.classList.toggle('cc-critical', critical);
			pctEl?.classList.toggle('cc-meter__pct--warn', warn);
			pctEl?.classList.toggle('cc-meter__pct--critical', critical);
			meterEl?.classList.toggle('cc-meter--warn', warn);
			meterEl?.classList.toggle('cc-meter--critical', critical);
		}

		setUsage(usage) {
			this.refreshProgressChrome();
			const isStale = !!usage?.isStale;
			this._isStale = isStale;
			const session = usage?.five_hour || null;
			const weekly = usage?.seven_day || null;

			this.usageLine?.classList.remove('cc-hidden');

			if (isStale) {
				this._sessionUtilPct = null;
				this.sessionResetMs = null;
				this._setRingProgress(this.sessionRingFill, this._sessionRingCirc, 0);
				this._applyMeterLevel(this.sessionRingFill, this.sessionPctSpan, this.sessionGroup, 0);
				if (this._sessionTooltip) {
					this._sessionTooltip.textContent = '5-hour session · Limit unverified (syncs on next message)';
				}
			} else if (session && typeof session.utilization === 'number') {
				const rawPct = session.utilization;
				this._sessionUtilPct = rawPct;
				this.sessionResetMs = session.resets_at ? Date.parse(session.resets_at) : null;

				const width = Math.max(0, Math.min(100, rawPct));
				this._setRingProgress(this.sessionRingFill, this._sessionRingCirc, width);
				this._applyMeterLevel(this.sessionRingFill, this.sessionPctSpan, this.sessionGroup, width);
				if (this._sessionTooltip) {
					this._sessionTooltip.textContent = '5-hour session';
				}
			} else {
				this._sessionUtilPct = 0;
				this.sessionResetMs = null;
				this._setRingProgress(this.sessionRingFill, this._sessionRingCirc, 0);
				this._applyMeterLevel(this.sessionRingFill, this.sessionPctSpan, this.sessionGroup, 0);
				if (this._sessionTooltip) {
					this._sessionTooltip.textContent = '5-hour session';
				}
			}

			if (usage?.accountTier === 'free' && this._usageRefreshTooltip) {
				this._usageRefreshTooltip.textContent = 'Free plan · Updates when messages are sent';
			} else if (this._usageRefreshTooltip) {
				this._usageRefreshTooltip.textContent = 'Refresh usage';
			}

			const hasWeekly = !isStale && weekly && typeof weekly.utilization === 'number';
			this.weeklyGroup?.classList.toggle('cc-hidden', !hasWeekly);

			if (hasWeekly) {
				const rawPct = weekly.utilization;
				this._weeklyUtilPct = rawPct;
				this.weeklyResetMs = weekly.resets_at ? Date.parse(weekly.resets_at) : null;

				const width = Math.max(0, Math.min(100, rawPct));
				this._setRingProgress(this.weeklyRingFill, this._weeklyRingCirc, width);
				this._applyMeterLevel(this.weeklyRingFill, this.weeklyPctSpan, this.weeklyGroup, width);
			} else {
				this._weeklyUtilPct = null;
				this.weeklyResetMs = null;
				if (this.weeklyPctSpan) this.weeklyPctSpan.textContent = '';
				if (this.weeklyRemainSpan) this.weeklyRemainSpan.textContent = '';
				this._setRingProgress(this.weeklyRingFill, this._weeklyRingCirc, 0);
				this._applyMeterLevel(this.weeklyRingFill, this.weeklyPctSpan, this.weeklyGroup, 0);
			}

			this._renderUsageStripText();
		}

		_fillMeterText(pctEl, remainEl, pct, resetMs, isStale) {
			if (pctEl) {
				if (isStale) {
					pctEl.textContent = '—%';
					pctEl.classList.add('cc-meter__pct--stale');
				} else {
					pctEl.classList.remove('cc-meter__pct--stale');
					pctEl.textContent = typeof pct === 'number' ? CC.format.formatUsagePct(pct) : '0%';
				}
			}
			if (remainEl) {
				if (isStale) {
					remainEl.textContent = '· unverified';
					remainEl.classList.add('cc-meter__remain--stale');
				} else {
					remainEl.classList.remove('cc-meter__remain--stale');
					const remaining = CC.format.formatRemaining(resetMs);
					remainEl.textContent = remaining ? `· ${remaining} left` : '';
				}
			}
		}

		_renderUsageStripText() {
			this._fillMeterText(
				this.sessionPctSpan,
				this.sessionRemainSpan,
				this._sessionUtilPct,
				this.sessionResetMs,
				this._isStale
			);
			this._fillMeterText(
				this.weeklyPctSpan,
				this.weeklyRemainSpan,
				this._weeklyUtilPct,
				this.weeklyResetMs,
				false
			);
		}

		tick() {
			const now = Date.now();

			if (this.lastCachedUntilMs && this.lastCachedUntilMs > now) {
				const secondsLeft = Math.max(0, Math.ceil((this.lastCachedUntilMs - now) / 1000));
				if (this.cacheTimeSpan) {
					this.cacheTimeSpan.textContent = CC.format.formatSeconds(secondsLeft);
				}
			} else if (this.lastCachedUntilMs && this.lastCachedUntilMs <= now) {
				this.lastCachedUntilMs = null;
				this.cacheTimeSpan = null;
				this.pendingCache = false;
				this.cachedDisplay.textContent = '';
				this._renderHeader();
			}

			this._renderUsageStripText();
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
