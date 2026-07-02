chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== 'local' || !changes.pulse_usage_state) return;

	const state = changes.pulse_usage_state.newValue;
	if (!state || !state.usageState || !state.usageState.five_hour) return;

	const fiveHour = state.usageState.five_hour;
	const utilization = fiveHour.utilization;
	const resetsAt = fiveHour.resets_at;

	if (utilization >= 100 && resetsAt) {
		const resetTimeMs = Date.parse(resetsAt);
		if (resetTimeMs > Date.now()) {
			chrome.alarms.get('pulse_limit_reset', (existingAlarm) => {
				// Only schedule if alarm doesn't exist or has a different target time
				if (!existingAlarm || existingAlarm.scheduledTime !== resetTimeMs) {
					chrome.alarms.create('pulse_limit_reset', { when: resetTimeMs });
					console.log(`[Claude Pulse] Scheduled limit reset alarm for ${resetsAt}`);
				}
			});
		}
	} else {
		// Clear pending alarm if utilization drops below 100%
		chrome.alarms.clear('pulse_limit_reset');
	}
});

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === 'pulse_limit_reset') {
		chrome.notifications.create('pulse_reset_notification', {
			type: 'basic',
			iconUrl: '/icons/icon128.png',
			title: 'Claude Pulse',
			message: 'Your 5-hour Claude usage limit has reset! You can start chatting again.',
			priority: 2
		}, () => {
			console.log('[Claude Pulse] Limit reset notification triggered.');
		});
	}
});
