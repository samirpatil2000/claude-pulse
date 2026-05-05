(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	const ROOT_MESSAGE_ID = '00000000-0000-4000-8000-000000000000';

	function stableStringify(value) {
		const seen = new WeakSet();

		const normalize = (v) => {
			if (v === null || typeof v !== 'object') return v;
			if (seen.has(v)) return '[Circular]';
			seen.add(v);

			if (Array.isArray(v)) return v.map(normalize);

			const out = {};
			for (const key of Object.keys(v).sort()) {
				out[key] = normalize(v[key]);
			}
			return out;
		};

		try {
			return JSON.stringify(normalize(value));
		} catch {
			return '';
		}
	}

	function getTokenizer() {
		return globalThis.GPTTokenizer_o200k_base || null;
	}

	function countTokens(text) {
		if (!text) return 0;
		const tokenizer = getTokenizer();
		if (!tokenizer?.countTokens) return 0;
		try {
			return tokenizer.countTokens(text);
		} catch {
			return 0;
		}
	}

	function buildTrunk(conversation) {
		const messages = Array.isArray(conversation?.chat_messages) ? conversation.chat_messages : [];
		const byId = new Map();
		for (const msg of messages) {
			if (msg?.uuid) byId.set(msg.uuid, msg);
		}

		const leaf = conversation?.current_leaf_message_uuid;
		if (!leaf) return [];

		const trunk = [];
		let currentId = leaf;
		while (currentId && currentId !== ROOT_MESSAGE_ID) {
			const msg = byId.get(currentId);
			if (!msg) break;
			trunk.push(msg);
			currentId = msg.parent_message_uuid;
		}

		trunk.reverse();
		return trunk;
	}

	function isCountableContentItem(item) {
		if (!item || typeof item !== 'object') return false;
		if (typeof item.type !== 'string') return false;
		if (item.type === 'thinking' || item.type === 'redacted_thinking') return false;
		if (item.type === 'image' || item.type === 'document') return false;
		return true;
	}

	function stringifyCountableContentItem(item) {
		if (!isCountableContentItem(item)) return '';

		if (item.type === 'text' && typeof item.text === 'string') return item.text;

		if (item.type === 'tool_use') {
			const minimal = { id: item.id, name: item.name, input: item.input };
			return stableStringify(minimal);
		}

		if (item.type === 'tool_result') {
			const minimal = { tool_use_id: item.tool_use_id, is_error: item.is_error, content: item.content };
			return stableStringify(minimal);
		}

		const minimal = {};
		if (typeof item.text === 'string') minimal.text = item.text;
		if (typeof item.title === 'string') minimal.title = item.title;
		if (typeof item.url === 'string') minimal.url = item.url;
		if (typeof item.content === 'string') minimal.content = item.content;
		if (Array.isArray(item.content)) minimal.content = item.content;
		if (Object.keys(minimal).length === 0) return '';
		return stableStringify(minimal);
	}

	// ── Readable content extraction (for copy) ──

	function readableContentItem(item) {
		if (!item || typeof item !== 'object') return '';
		if (item.type === 'thinking' || item.type === 'redacted_thinking') return '';
		if (item.type === 'text' && typeof item.text === 'string') return item.text;
		if (item.type === 'tool_use') return `[Tool call: ${item.name || 'unknown'}]`;
		if (item.type === 'tool_result') {
			const body = typeof item.content === 'string'
				? item.content
				: Array.isArray(item.content)
					? item.content.map(readableContentItem).filter(Boolean).join('\n')
					: '';
			return body ? `[Tool result]\n${body}` : '[Tool result]';
		}
		if (item.type === 'image') return '[Image]';
		if (item.type === 'document') return `[Document: ${item.title || item.file_name || 'file'}]`;
		if (typeof item.text === 'string') return item.text;
		return '';
	}

	function readableMessageBody(message) {
		const parts = [];
		const content = Array.isArray(message?.content) ? message.content : [];
		for (const item of content) {
			const s = readableContentItem(item);
			if (s) parts.push(s);
		}
		const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
		for (const a of attachments) {
			if (a?.file_name) parts.push(`[Attachment: ${a.file_name}]`);
		}
		return parts.join('\n');
	}

	function senderLabel(sender) {
		if (sender === 'human') return 'Human';
		if (sender === 'assistant') return 'Assistant';
		return sender || 'Unknown';
	}

	function formatTrunkAsText(trunk) {
		const lines = [];
		for (const msg of trunk) {
			const label = senderLabel(msg.sender);
			const body = readableMessageBody(msg);
			lines.push(`${label}:\n${body}`);
		}
		return lines.join('\n\n---\n\n');
	}

	function formatTrunkAsMarkdown(trunk) {
		const lines = [];
		for (const msg of trunk) {
			const label = senderLabel(msg.sender);
			const body = readableMessageBody(msg);
			lines.push(`## ${label}\n\n${body}`);
		}
		return lines.join('\n\n---\n\n');
	}

	function stringifyMessageCountables(message) {
		const parts = [];

		const content = Array.isArray(message?.content) ? message.content : [];
		for (const item of content) {
			const s = stringifyCountableContentItem(item);
			if (s) parts.push(s);
		}

		const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
		for (const a of attachments) {
			if (typeof a?.extracted_content === 'string' && a.extracted_content) {
				parts.push(a.extracted_content);
			}
		}

		return parts.join('\n');
	}

	function stringifyMessageThinking(message) {
		const parts = [];
		const content = Array.isArray(message?.content) ? message.content : [];
		for (const item of content) {
			if (item?.type === 'thinking' && typeof item.thinking === 'string') {
				parts.push(item.thinking);
			}
		}
		return parts.join('\n');
	}

	async function hashString(str) {
		if (!CC.bridge?.requestHash) return null;
		try {
			const res = await CC.bridge.requestHash(str);
			if (res?.hash) return res.hash;
		} catch {
			// no local hashing fallback
		}
		return null;
	}

	async function fingerprint(text) {
		if (!text) return null;
		const hash = await hashString(text);
		if (!hash) return null;
		return `${text.length}:${hash}`;
	}

	class TokenCache {
		constructor() {
			this._byMessageId = new Map();
		}

		async getMessageTokens(messageId, messageText, thinkingText) {
			const fp = await fingerprint(messageText);
			const thinking = thinkingText ? countTokens(thinkingText) : 0;
			if (!fp) return { tokens: countTokens(messageText), thinking };
			const cached = this._byMessageId.get(messageId);
			if (cached && cached.fp === fp) return { tokens: cached.tokens, thinking: cached.thinking };

			const tokens = countTokens(messageText);
			this._byMessageId.set(messageId, { fp, tokens, thinking });
			return { tokens, thinking };
		}

		pruneToMessageIds(keepIds) {
			const keep = new Set(keepIds);
			for (const id of this._byMessageId.keys()) {
				if (!keep.has(id)) this._byMessageId.delete(id);
			}
		}
	}

	const tokenCache = new TokenCache();

	async function computeConversationMetrics(conversation) {
		const trunk = buildTrunk(conversation);
		const trunkIds = trunk.map((m) => m.uuid).filter(Boolean);
		tokenCache.pruneToMessageIds(trunkIds);

		let totalTokens = 0;
		let thinkingTokens = 0;
		let lastAssistantMs = null;

		for (const msg of trunk) {
			if (msg?.sender === 'assistant' && msg?.created_at) {
				const msgMs = Date.parse(msg.created_at);
				if (!lastAssistantMs || msgMs > lastAssistantMs) {
					lastAssistantMs = msgMs;
				}
			}

			const msgText = stringifyMessageCountables(msg);
			const thinkingText = stringifyMessageThinking(msg);
			if (msg?.uuid) {
				const result = await tokenCache.getMessageTokens(msg.uuid, msgText, thinkingText);
				totalTokens += result.tokens;
				thinkingTokens += result.thinking;
			} else {
				totalTokens += countTokens(msgText);
				if (thinkingText) thinkingTokens += countTokens(thinkingText);
			}
		}

		const cachedUntil = lastAssistantMs ? lastAssistantMs + CC.CONST.CACHE_WINDOW_MS : null;

		return { trunkMessageCount: trunk.length, totalTokens, thinkingTokens, lastAssistantMs, cachedUntil };
	}

	CC.tokens = { computeConversationMetrics, buildTrunk, formatTrunkAsText, formatTrunkAsMarkdown };
})();
