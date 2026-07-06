(() => {
	'use strict';

	const CC = (globalThis.ClaudeCounter = globalThis.ClaudeCounter || {});

	CC.format = {
		formatSeconds(totalSeconds) {
			const minutes = Math.floor(totalSeconds / 60);
			const seconds = totalSeconds % 60;
			return `${minutes}:${String(seconds).padStart(2, '0')}`;
		},

		formatResetCountdown(timestampMs) {
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
		},

		formatUsageStripText(rawPct, resetMs) {
			const used = Math.round(rawPct * 10) / 10;
			const parts = [`${used}% used`];
			if (resetMs != null && Number.isFinite(resetMs)) {
				parts.push(`resets in ${this.formatResetCountdown(resetMs)}`);
			}
			return parts.join(' · ');
		}
	};
})();
