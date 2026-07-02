document.addEventListener('DOMContentLoaded', () => {
	loadUsageData();
	setupEventListeners();
});

function loadUsageData() {
	if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
		showEmptyState();
		return;
	}

	chrome.storage.local.get(['pulse_usage_state'], (result) => {
		const data = result.pulse_usage_state;
		if (!data || !data.usageState || !data.usageState.five_hour) {
			showEmptyState();
			return;
		}

		renderMetrics(data.usageState, data.lastUsageUpdateMs);
	});
}

function showEmptyState() {
	document.getElementById('active-state').classList.add('hidden');
	document.getElementById('empty-state').classList.remove('hidden');
}

function renderMetrics(usageState, lastUsageUpdateMs) {
	document.getElementById('empty-state').classList.add('hidden');
	document.getElementById('active-state').classList.remove('hidden');

	const fiveHour = usageState.five_hour;
	const utilization = Math.max(0, Math.min(100, Math.round(fiveHour.utilization)));

	// Update Ring percentage text
	document.getElementById('metrics-percentage').textContent = `${utilization}%`;

	// Update Ring stroke
	const ringFill = document.getElementById('progress-ring-fill');
	const radius = ringFill.r.baseVal.value;
	const circumference = 2 * Math.PI * radius;
	
	// Set initial values
	ringFill.style.strokeDasharray = `${circumference} ${circumference}`;
	const offset = circumference - (utilization / 100) * circumference;
	
	// Trigger layout reflow for animation transition
	ringFill.getBoundingClientRect();
	ringFill.style.strokeDashoffset = offset;

	// Set colors depending on threshold (Steve Jobs visual feedback detail)
	if (utilization >= 85) {
		ringFill.style.stroke = '#dc2626'; // critical red
	} else if (utilization >= 60) {
		ringFill.style.stroke = '#d97706'; // warning orange
	} else {
		ringFill.style.stroke = 'var(--accent-color)'; // default amber
	}

	// Update Reset Timer
	const resetLabel = document.getElementById('metrics-reset-label');
	if (fiveHour.resets_at) {
		const resetTimeMs = Date.parse(fiveHour.resets_at);
		
		const updateTimer = () => {
			const now = Date.now();
			const diff = resetTimeMs - now;

			if (diff <= 0) {
				resetLabel.textContent = 'Resetting now...';
				loadUsageData(); // Refresh if reset complete
				return;
			}

			const hours = Math.floor(diff / 3600000);
			const minutes = Math.floor((diff % 3600000) / 60000);
			const seconds = Math.floor((diff % 60000) / 1000);

			let timeString = '';
			if (hours > 0) {
				timeString = `${hours}h ${minutes}m`;
			} else if (minutes > 0) {
				timeString = `${minutes}m ${seconds}s`;
			} else {
				timeString = `${seconds}s`;
			}
			resetLabel.textContent = `Resets in ${timeString}`;
		};

		updateTimer();
		// Update every second for precise real-time countdown
		const intervalId = setInterval(() => {
			const diff = resetTimeMs - Date.now();
			if (diff <= 0) {
				clearInterval(intervalId);
			}
			updateTimer();
		}, 1000);
	} else {
		resetLabel.textContent = 'No upcoming resets';
	}

	// Update Last Synced Label
	const lastUpdated = document.getElementById('last-updated');
	const syncDiff = Date.now() - lastUsageUpdateMs;
	if (syncDiff < 60000) {
		lastUpdated.textContent = 'Synced: Just now';
		lastUpdated.classList.remove('stale');
	} else {
		const mins = Math.floor(syncDiff / 60000);
		if (mins < 60) {
			lastUpdated.textContent = `Synced: ${mins}m ago`;
		} else {
			const hrs = Math.floor(mins / 60);
			lastUpdated.textContent = `Synced: ${hrs}h ago`;
		}

		if (syncDiff >= 120000) {
			lastUpdated.classList.add('stale');
			lastUpdated.textContent += ' (Refresh Claude.ai page)';
		} else {
			lastUpdated.classList.remove('stale');
		}
	}
}

function setupEventListeners() {
	const openBtn = document.getElementById('btn-open-claude');
	if (openBtn) {
		openBtn.addEventListener('click', () => {
			if (typeof chrome === 'undefined' || !chrome.tabs) {
				window.open('https://claude.ai/', '_blank');
				window.close();
				return;
			}

			// Look for existing Claude.ai tab
			chrome.tabs.query({ url: "*://claude.ai/*" }, (tabs) => {
				if (tabs && tabs.length > 0) {
					// Focus the first Claude tab found
					const targetTab = tabs[0];
					chrome.tabs.update(targetTab.id, { active: true }, () => {
						chrome.windows.update(targetTab.windowId, { focused: true }, () => {
							window.close();
						});
					});
				} else {
					// Open new Claude tab
					chrome.tabs.create({ url: 'https://claude.ai/' }, () => {
						window.close();
					});
				}
			});
		});
	}
}
