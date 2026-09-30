(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.DOM = Object.freeze({
		// claude.ai removed chat-menu-trigger (~Jun 2026); try newer anchors first
		CHAT_HEADER_ANCHORS: [
			'[data-testid="chat-title-split"]',
			'button:has(span.font-base-bold)',
			'button:has(span[class*="font-"])',
			'div[class*="sticky"] button[aria-haspopup="menu"]',
			'div[class*="sticky"] button:has(svg)',
			'div[class*="sticky"] div > button',
			'header button[aria-haspopup="menu"]',
			'header button[aria-label*="chat" i]',
			'[data-testid="chat-menu-trigger"]',
			'button[aria-label*="chat" i]',
			'button[aria-label*="menu" i]'
		],
		MODEL_SELECTOR_DROPDOWN: '[data-testid="model-selector-dropdown"]',
		MODEL_SELECTOR_ANCHORS: [
			'[data-testid="model-selector-dropdown"]',
			'button[aria-label^="Model:"]',
			'button[aria-haspopup="menu"][aria-label*="Sonnet" i]',
			'button[aria-haspopup="menu"][aria-label*="Opus" i]',
			'button[aria-haspopup="menu"][aria-label*="Haiku" i]',
			'[data-testid*="model-selector"]'
		],
		// Home + chat composer editor (Chat/Cowork merged composer, Aug 2026+)
		COMPOSER_EDITOR_ANCHORS: [
			'[contenteditable="true"][role="textbox"]',
			'div[contenteditable="true"]',
			'[data-testid="chat-input-grid-container"] [contenteditable="true"]',
			'.rounded-composer [contenteditable="true"]'
		],
		COMPOSER_SHELL_FALLBACKS: [
			'.rounded-composer',
			'[data-testid="chat-input-grid-container"]',
			'fieldset'
		],
		BRIDGE_SCRIPT_ID: 'cc-bridge-script'
	});

	CC.findHeaderAnchor = () => {
		const isExcluded = (el) => {
			if (!el) return true;
			if (el.classList?.contains('cc-header') || el.closest('.cc-header')) return true;
			return !!el.closest('nav, aside, [aria-label*="sidebar" i], .cc-usageRow, fieldset, form, footer');
		};

		// 1. Target the chat title container directly (the left sibling of data-header-spacer)
		try {
			const spacer = document.querySelector('[data-header-spacer]');
			if (spacer) {
				let prev = spacer.previousElementSibling;
				while (prev && isExcluded(prev)) {
					prev = prev.previousElementSibling;
				}
				if (prev) return prev;
			}
		} catch {}

		// 2. Target via session-title-split / chat-title-split container
		try {
			const split = document.querySelector('[data-testid*="title-split"]');
			if (split && !isExcluded(split)) {
				const group = split.closest('.font-base, [class*="title-row"], [class*="min-w-0"]') || split;
				return group;
			}
		} catch {}

		// 3. Fallback: Locate top bar from Share button and pick the title element before the spacer
		try {
			const buttons = Array.from(document.querySelectorAll('button'));
			const shareBtn = buttons.find((b) => {
				if (isExcluded(b)) return false;
				const txt = b.textContent?.trim().toLowerCase();
				return txt === 'share' || b.getAttribute('aria-label')?.toLowerCase()?.includes('share');
			});
			if (shareBtn) {
				let cur = shareBtn.parentElement;
				while (cur && cur !== document.body && cur !== document.documentElement) {
					const spacer = cur.querySelector('[data-header-spacer]');
					if (spacer) {
						let prev = spacer.previousElementSibling;
						while (prev && isExcluded(prev)) {
							prev = prev.previousElementSibling;
						}
						if (prev) return prev;
					}
					const split = cur.querySelector('[data-testid*="title-split"]');
					if (split && !isExcluded(split)) {
						return split.closest('.font-base, [class*="title-row"], [class*="min-w-0"]') || split;
					}
					cur = cur.parentElement;
				}
			}
		} catch {}

		// 4. Explicit selectors fallback
		for (const sel of CC.DOM.CHAT_HEADER_ANCHORS) {
			try {
				const matches = document.querySelectorAll(sel);
				for (const el of matches) {
					if (!isExcluded(el)) {
						const txt = el.textContent?.trim().toLowerCase();
						if (txt && txt !== 'share') return el;
					}
				}
			} catch {}
		}

		return null;
	};

	CC.findModelSelector = () => {
		for (const selector of CC.DOM.MODEL_SELECTOR_ANCHORS) {
			try {
				const el = document.querySelector(selector);
				if (el) return el;
			} catch {
				// ignore selector exceptions
			}
		}
		return null;
	};

	CC.findComposerEditor = () => {
		for (const selector of CC.DOM.COMPOSER_EDITOR_ANCHORS) {
			try {
				const el = document.querySelector(selector);
				if (el && el.getBoundingClientRect().height > 0) return el;
			} catch {
				// ignore selector exceptions
			}
		}
		return null;
	};

	// Claude's composer paints a rounded shell; Chat/Cowork + model controls are
	// absolutely positioned on an inner position:relative row. Walk from the
	// editor to that row, then out through single-child wrappers to the shell
	// that draws the box — so usage mounts outside the card, not inside the
	// absolute toolbar (which overlaps Chat/Cowork after the Aug 2026 redesign).
	CC.findComposerSurface = () => {
		const editor = CC.findComposerEditor();
		if (editor) {
			let row = null;
			let node = editor.parentElement;
			for (let hops = 0; node && hops < 10; hops++, node = node.parentElement) {
				if (window.getComputedStyle(node).position !== 'relative') continue;
				const ownsAbsoluteControls = [...node.querySelectorAll('button')].some((btn) => {
					for (let el = btn.parentElement; el && el !== node; el = el.parentElement) {
						if (window.getComputedStyle(el).position === 'absolute') return true;
					}
					return false;
				});
				if (ownsAbsoluteControls) {
					row = node;
					break;
				}
			}

			if (row) {
				let surface = row;
				for (let hops = 0; hops < 5; hops++) {
					const parent = surface.parentElement;
					if (!parent || parent === document.body || parent === document.documentElement) break;
					// Stop before climbing into page columns that also hold
					// disclaimer / sibling chrome — only unwrap single-child shells.
					if (parent.children.length !== 1) break;
					surface = parent;
				}
				return surface;
			}
		}

		for (const selector of CC.DOM.COMPOSER_SHELL_FALLBACKS) {
			try {
				const el = document.querySelector(selector);
				if (el) return el;
			} catch {
				// ignore selector exceptions
			}
		}

		// Last resort: climb from model selector, but never return an absolute
		// control group (that's what caused the overlap with Chat/Cowork).
		const model = CC.findModelSelector();
		if (!model) return null;
		let cur = model.parentElement;
		for (let hops = 0; cur && hops < 12; hops++, cur = cur.parentElement) {
			const style = window.getComputedStyle(cur);
			if (style.position === 'absolute' || style.display === 'contents') continue;
			if (style.position === 'relative' && cur.querySelector('button')) {
				let surface = cur;
				for (let i = 0; i < 5; i++) {
					const parent = surface.parentElement;
					if (!parent || parent.children.length !== 1) break;
					surface = parent;
				}
				return surface;
			}
		}
		return null;
	};

	// Finds the actual chat composer card (the rounded input box)
	CC.findComposerBox = () => {
		const editor = CC.findComposerEditor();
		if (editor) {
			const box = editor.closest('.rounded-composer, [data-testid="chat-input-grid-container"], fieldset, form');
			if (box) return box;
		}

		for (const selector of CC.DOM.COMPOSER_SHELL_FALLBACKS) {
			try {
				const el = document.querySelector(selector);
				if (el) return el;
			} catch {
				// ignore selector exceptions
			}
		}

		return CC.findComposerSurface();
	};

	CC.CONST = Object.freeze({
		CACHE_WINDOW_MS: 5 * 60 * 1000,
		CONTEXT_LIMIT_TOKENS: 200000
	});

	CC.COLORS = Object.freeze({
		PROGRESS_FILL_DARK: 'rgba(250, 249, 245, 0.72)',
		PROGRESS_FILL_LIGHT: 'rgba(20, 20, 19, 0.55)',
		PROGRESS_TRACK_DARK: 'rgba(250, 249, 245, 0.12)',
		PROGRESS_TRACK_LIGHT: 'rgba(20, 20, 19, 0.08)',
		PROGRESS_OUTLINE_DARK: 'transparent',
		PROGRESS_OUTLINE_LIGHT: 'transparent',
		PROGRESS_MARKER_DARK: 'rgba(250, 249, 245, 0.75)',
		PROGRESS_MARKER_LIGHT: 'rgba(20, 20, 19, 0.55)',
		AMBER_WARNING: '#d97706',
		CRITICAL_WARNING: '#ef4444',
		CACHE_ACTIVE_DARK: 'rgba(74, 222, 128, 0.8)',
		CACHE_ACTIVE_LIGHT: '#16a34a',
		BOLD_LIGHT: '#141413',
		BOLD_DARK: '#faf9f5'
	});
})();
