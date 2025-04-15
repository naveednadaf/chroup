// Store for seen job UIDs and settings
let seenJobUIDs = new Set();
let apiEndpoint = null;
let isMonitoring = false;
let isAutoRefreshEnabled = false; // Added this state variable
let monitorUrl = '';
let nextRefreshTime = null; // Added to track next refresh time
let schedule = {
  timezone: 'Asia/Kolkata',
  inactiveStart: '13:00',
  inactiveEnd: '23:00'
};
let stealthSettings = {
  minRefreshInterval: 4,
  maxRefreshInterval: 7,
  preRefreshDelay: 5
};

// Function to show notification
async function showNotification(message) {
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.png'),
      title: 'New Upwork Jobs',
      message: message
    });
  } catch (error) {
    console.error('Error showing notification:', error);
  }
}

// Helper: Send log to content script overlay
function overlayLog(message, type = 'info') {
  try {
    const targetUrlPattern = monitorUrl ? monitorUrl.replace(/\/$/, '') + '*' : '<all_urls>'; // Fallback if no URL
    chrome.tabs.query({ url: targetUrlPattern }, function(tabs) {
      if (chrome.runtime.lastError) {
        console.warn('[overlayLog] Error querying tabs:', chrome.runtime.lastError.message);
        return; // Exit if error querying tabs
      }
      if (tabs && tabs.length > 0) {
        tabs.forEach(tab => {
          if (tab.id) { // Ensure tab ID is valid
            chrome.tabs.sendMessage(tab.id, { type: 'OVERLAY_LOG', logType: type, message }, (response) => {
              if (chrome.runtime.lastError) {
                // Don't log the common 'Receiving end does not exist' error loudly
                if (!chrome.runtime.lastError.message.includes('Receiving end does not exist')) {
                   console.warn(`[overlayLog] Error sending message to tab ${tab.id}:`, chrome.runtime.lastError.message);
                }
              }
            });
          } else {
             console.warn('[overlayLog] Found tab without ID, skipping.');
          }
        });
      } else {
        // console.log('[overlayLog] No matching tabs found for overlay message.'); // Optional: Log if no tabs match
      }
    });
  } catch (e) {
    console.error('[overlayLog] Unexpected error:', e);
  }
}

// Patch broadcastLog to also send overlay log
function broadcastLog(message, type = 'info') {
  console.log(`[${type.toUpperCase()}] ${message}`); // Log to background console first
  try { overlayLog(message, type); } catch(e){ console.error('Error invoking overlayLog:', e); }
  chrome.runtime.sendMessage({
    type: 'LOG',
    logType: type,
    message: message
  }).catch(error => {
    if (error.message !== 'Could not establish connection. Receiving end does not exist.') {
      console.error('Failed to broadcast log:', error);
    }
  });
}

// Function to initialize storage
async function initializeStorage() {
  try {
    const result = await chrome.storage.local.get([
      'seenJobUIDs',
      'apiEndpoint',
      'isMonitoring',
      'isAutoRefreshEnabled',
      'schedule',
      'stealthSettings',
      'monitorUrl',
      'nextRefreshTime',
      'openedMonitorTabId' // Added to track opened tabId
    ]);

    console.log('Retrieved from storage:', result); // Debug log

    if (result.seenJobUIDs) {
      seenJobUIDs = new Set(result.seenJobUIDs);
    }
    if (result.apiEndpoint) {
      apiEndpoint = result.apiEndpoint;
      broadcastLog(`Loaded API endpoint: ${apiEndpoint}`);
    }
    if (result.schedule) {
      schedule = result.schedule;
    }
    if (result.stealthSettings) {
      stealthSettings = result.stealthSettings;
    }
    if (result.monitorUrl) {
      monitorUrl = result.monitorUrl;
      broadcastLog(`Loaded monitor URL: ${monitorUrl}`);
    }
    isMonitoring = result.isMonitoring || false;
    isAutoRefreshEnabled = result.isAutoRefreshEnabled || false;
    nextRefreshTime = result.nextRefreshTime || null;

    // Send current state to any active popup
    updatePopupState();

    // If monitoring and auto-refresh are active, ensure alarm is set
    if (isMonitoring && isAutoRefreshEnabled && !isInInactivePeriod()) {
      if (!nextRefreshTime || nextRefreshTime < Date.now()) {
        setupRefreshAlarm();
      }
    }
  } catch (error) {
    console.error('Error initializing storage:', error);
  }
}

// Function to update popup with current state
function updatePopupState() {
  try {
    // Get the current state values
    const currentState = {
      isMonitoring,
      isAutoRefreshEnabled,
      nextRefreshTime,
      monitorUrl, // Ensure this is the up-to-date value
      isInInactivePeriod: isInInactivePeriod()
    };

    // Log the state being sent for debugging
    console.log('Sending STATE_UPDATE:', currentState);

    // Send to any listening popups/options pages
    chrome.runtime.sendMessage({
      type: 'STATE_UPDATE',
      state: currentState
    }).catch(error => {
      // This error is expected if no popup is open
      if (error.message !== "Could not establish connection. Receiving end does not exist.") {
        console.warn('Error sending state update via sendMessage:', error);
      }
    });

    // Additionally, attempt to send via active ports (if using connect)
    // You might need to manage active ports if you rely heavily on connect
    // For simplicity, relying on sendMessage might be sufficient if popup always sends GET_STATE on open

  } catch (error) {
    console.error('Error in updatePopupState:', error);
  }
}

// Function to check if current time is within inactive period
function isInInactivePeriod() {
  const now = new Date().toLocaleString('en-US', { timeZone: schedule.timezone });
  const currentTime = new Date(now);

  const [startHour, startMinute] = schedule.inactiveStart.split(':').map(Number);
  const [endHour, endMinute] = schedule.inactiveEnd.split(':').map(Number);

  const start = new Date(currentTime);
  start.setHours(startHour, startMinute, 0);

  const end = new Date(currentTime);
  end.setHours(endHour, endMinute, 0);

  return currentTime >= start && currentTime <= end;
}

// Function to update storage with new UIDs
async function updateStorage() {
  await chrome.storage.local.set({
    seenJobUIDs: Array.from(seenJobUIDs)
  });
}

// Function to send job notification to API with retry
async function sendJobNotification(job, retryCount = 0) {
  console.log('[sendJobNotification] Called with job:', job, 'retryCount:', retryCount);
  broadcastLog(`[sendJobNotification] Called with jobUid: ${job && (job.uid || job.jobUid)}, retryCount: ${retryCount}`);

  if (!apiEndpoint) {
    console.error('[sendJobNotification] No API endpoint configured');
    broadcastLog('[sendJobNotification] No API endpoint configured', 'error');
    chrome.runtime.sendMessage({ type: 'API_REQUEST_FAILED', error: 'No API endpoint configured' });
    return false;
  }

  // Transform job object to match expected API format
  const formattedJob = {
    jobUid: job.uid || job.jobUid || `job_${Date.now()}`,
    title: job.title || "Unknown Job",
    url: job.url || '',
    postedTimeAgo: job.postedTimeAgo || '',
    descriptionSnippet: job.descriptionSnippet || '',
    jobType: job.jobType || '',
    experienceLevel: job.experienceLevel || '',
    budget: job.budget || '',
    skills: job.skills || [],
    clientInfo: job.clientInfo || {},
    proposals: job.proposals || '',
    timestampDetected: job.timestampDetected || new Date().toISOString()
  };

  console.log('[sendJobNotification] Formatted job:', formattedJob);
  broadcastLog(`[sendJobNotification] Formatted job: ${JSON.stringify(formattedJob)}`);

  try {
    chrome.runtime.sendMessage({ type: 'API_REQUEST_SENDING', job: formattedJob });
    broadcastLog(`[sendJobNotification] Sending POST to ${apiEndpoint}`);
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formattedJob)
    });
    broadcastLog(`[sendJobNotification] Received response status: ${response.status}`);
    let respText = '';
    try {
      respText = await response.text();
      broadcastLog(`[sendJobNotification] Response text: ${respText}`);
    } catch (e) {
      broadcastLog(`[sendJobNotification] Could not read response text: ${e.message}`);
    }
    if (response.ok) {
      chrome.runtime.sendMessage({ type: 'API_REQUEST_SUCCESS', job: formattedJob });
      broadcastLog(`[sendJobNotification] Successfully sent to API: ${formattedJob.title}`, 'success');
      return true;
    } else {
      throw new Error(`API responded with status ${response.status}: ${respText}`);
    }
  } catch (error) {
    console.error('[sendJobNotification] Error:', error);
    broadcastLog(`[sendJobNotification] Error: ${error.message}`, 'error');
    if (retryCount < 2) {
      broadcastLog(`[sendJobNotification] Retrying... (${retryCount + 1})`);
      await new Promise(r => setTimeout(r, 1500 * (retryCount + 1)));
      return sendJobNotification(job, retryCount + 1);
    } else {
      broadcastLog('[sendJobNotification] Failed to send notification after all retries', 'error');
      const troubleshootingTips =
        'Troubleshooting tips:\n' +
        '1. Check if the API endpoint URL is correct\n' +
        '2. Ensure the endpoint accepts POST requests\n' +
        '3. Verify the endpoint can handle JSON payloads\n' +
        '4. Check if the endpoint is accessible (no firewall/CORS issues)\n' +
        '5. Verify if the endpoint requires authentication';
      broadcastLog(troubleshootingTips, 'info');
      chrome.runtime.sendMessage({ type: 'API_REQUEST_FAILED', error: error.message });
      return false;
    }
  }
}

// Function to handle new jobs
async function handleNewJobs(jobs) {
  console.log('[handleNewJobs] called with jobs:', jobs);
  broadcastLog(`[handleNewJobs] called with jobs: ${JSON.stringify(jobs)}`);
  console.log('[handleNewJobs] Current seenJobUIDs:', Array.from(seenJobUIDs));
  broadcastLog(`[handleNewJobs] Current seenJobUIDs: ${JSON.stringify(Array.from(seenJobUIDs))}`);

  // Handle both uid and jobUid properties
  const newJobs = jobs.filter(job => {
    const identifier = job.uid || job.jobUid;
    return identifier && !seenJobUIDs.has(identifier);
  });

  console.log(`[handleNewJobs] Filtered newJobs:`, newJobs);
  broadcastLog(`[handleNewJobs] Filtered newJobs: ${JSON.stringify(newJobs)}`);

  if (newJobs.length > 0) {
    broadcastLog(`Found ${newJobs.length} new job(s)`, 'info');
    await showNotification(`Found ${newJobs.length} new job(s)!`);
    for (const job of newJobs) {
      const identifier = job.uid || job.jobUid;
      broadcastLog(`[handleNewJobs] Processing job: ${identifier} (${job.title})`);
      const sent = await sendJobNotification(job);
      broadcastLog(`[handleNewJobs] sendJobNotification result for ${identifier}: ${sent}`);
      if (sent) {
        if (identifier) {
          seenJobUIDs.add(identifier);
          await updateStorage();
          broadcastLog(`Successfully processed job: ${job.title}`, 'success');
        } else {
          broadcastLog(`Warning: Job has no identifier, cannot mark as seen: ${job.title}`, 'warning');
        }
      } else {
        broadcastLog(`Failed to process job: ${job.title}, will retry on next check`, 'warning');
      }
    }
  } else {
    console.log('[handleNewJobs] No new jobs to process');
    broadcastLog('[handleNewJobs] No new jobs to process');
  }
}

// Function to refresh active Upwork tab with robust matching
async function refreshUpworkTab() {
  broadcastLog('Refresh request received', 'info');

  if (!isMonitoring) {
    broadcastLog('Not refreshing: monitoring is turned off', 'info');
    chrome.runtime.sendMessage({
      type: 'REFRESH_STATUS',
      status: 'CANCELLED',
      reason: 'Monitoring is turned off'
    });
    return;
  }

  if (isInInactivePeriod()) {
    broadcastLog('Not refreshing: in inactive period', 'info');
    chrome.runtime.sendMessage({
      type: 'REFRESH_STATUS',
      status: 'CANCELLED',
      reason: 'In scheduled inactive period'
    });
    return;
  }

  if (!monitorUrl) {
    broadcastLog('No monitor URL configured', 'error');
    chrome.runtime.sendMessage({
      type: 'REFRESH_STATUS',
      status: 'ERROR',
      reason: 'No monitor URL configured'
    });
    return;
  }

  try {
    // Notify that refresh is starting
    broadcastLog('Starting refresh process', 'info');
    chrome.runtime.sendMessage({
      type: 'REFRESH_STATUS',
      status: 'STARTING'
    });

    // Add random pre-refresh delay
    const delay = Math.random() * (stealthSettings.preRefreshDelay * 1000);
    broadcastLog(`Waiting ${Math.round(delay / 1000)}s before refresh...`, 'info');
    await new Promise(resolve => setTimeout(resolve, delay));

    // CRITICAL DEBUG: Log the exact monitor URL we're using
    const normalizedMonitorUrl = monitorUrl.replace(/\/$/, '');
    broadcastLog(`[TAB DEBUG] Monitor URL: ${monitorUrl}`, 'debug');
    broadcastLog(`[TAB DEBUG] Normalized URL: ${normalizedMonitorUrl}`, 'debug');

    // Get the stored tab ID first
    let openedTabId = null;
    try {
      const result = await chrome.storage.local.get(['openedMonitorTabId']);
      openedTabId = result.openedMonitorTabId;
      broadcastLog(`[TAB DEBUG] Retrieved stored tab ID: ${openedTabId}`, 'debug');
    } catch (e) {
      broadcastLog(`[TAB DEBUG] Error retrieving stored tab ID: ${e.message}`, 'warning');
      openedTabId = null;
    }

    // Query ALL tabs first to see what's available
    const allTabs = await chrome.tabs.query({});
    broadcastLog(`[TAB DEBUG] Found ${allTabs.length} total tabs`, 'debug');
    
    // Log all tabs with URLs containing upwork for debugging
    const upworkTabs = allTabs.filter(tab => tab.url && tab.url.includes('upwork.com'));
    broadcastLog(`[TAB DEBUG] Found ${upworkTabs.length} Upwork tabs:`, 'debug');
    upworkTabs.forEach(tab => {
      broadcastLog(`[TAB DEBUG] Tab ID: ${tab.id}, URL: ${tab.url}`, 'debug');
    });

    // STEP 1: Try to find the exact tab we previously opened
    let targetTab = null;
    if (openedTabId) {
      // Find by ID first
      const storedTab = allTabs.find(tab => tab.id === openedTabId);
      if (storedTab) {
        broadcastLog(`[TAB DEBUG] Found stored tab ID ${openedTabId} with URL: ${storedTab.url}`, 'debug');
        targetTab = storedTab;
      } else {
        broadcastLog(`[TAB DEBUG] Stored tab ID ${openedTabId} no longer exists`, 'debug');
      }
    }

    // STEP 2: If we couldn't find the stored tab, look for ANY tab with our URL
    if (!targetTab) {
      broadcastLog(`[TAB DEBUG] Looking for any tab containing our URL`, 'debug');
      // Use a more flexible matching approach - just check if the URL contains our base URL
      for (const tab of allTabs) {
        if (tab.url && tab.url.includes(normalizedMonitorUrl)) {
          broadcastLog(`[TAB DEBUG] Found matching tab ID ${tab.id} with URL: ${tab.url}`, 'debug');
          targetTab = tab;
          break;
        }
      }
    }

    // STEP 3: Take action based on whether we found a tab
    if (targetTab) {
      broadcastLog(`[TAB DEBUG] Will refresh existing tab ID: ${targetTab.id}`, 'debug');
      broadcastLog(`Refreshing tab with id ${targetTab.id} and url ${targetTab.url}`, 'info');
      
      // Save this tab ID for future refreshes
      await chrome.storage.local.set({ openedMonitorTabId: targetTab.id });
      
      // Reload the tab
      await chrome.tabs.reload(targetTab.id);
      
      broadcastLog('Tab refreshed successfully', 'success');
      chrome.runtime.sendMessage({
        type: 'REFRESH_STATUS',
        status: 'COMPLETED',
        tabId: targetTab.id
      });
    } else {
      broadcastLog(`[TAB DEBUG] No matching tab found, will create new tab`, 'debug');
      broadcastLog('No matching tab found, opening new tab', 'info');
      
      // Create a new tab in the background
      const newTab = await chrome.tabs.create({ 
        url: monitorUrl, 
        active: false // Open in background
      });
      
      // Save the new tab ID
      await chrome.storage.local.set({ openedMonitorTabId: newTab.id });
      
      broadcastLog(`New tab opened with ID: ${newTab.id}`, 'success');
      chrome.runtime.sendMessage({
        type: 'REFRESH_STATUS',
        status: 'NEW_TAB_OPENED',
        tabId: newTab.id
      });
    }

    // Schedule next refresh if auto-refresh is enabled
    if (isAutoRefreshEnabled) {
      setupRefreshAlarm();
    }
  } catch (error) {
    console.error('Error in refreshUpworkTab:', error);
    broadcastLog(`Error refreshing tab: ${error.message}`, 'error');
    chrome.runtime.sendMessage({
      type: 'REFRESH_STATUS',
      status: 'ERROR',
      error: error.message
    });
  }
}

// Set up refresh alarm with randomized interval
function setupRefreshAlarm() {
  // Validate stealth settings
  if (!stealthSettings || typeof stealthSettings.minRefreshInterval !== 'number' || typeof stealthSettings.maxRefreshInterval !== 'number') {
    broadcastLog('Invalid stealth settings, using defaults', 'warning');
    stealthSettings = {
      minRefreshInterval: 4,
      maxRefreshInterval: 7,
      preRefreshDelay: 5
    };
  }

  // Random interval between min and max refresh times (in minutes)
  const minInterval = Math.max(1, stealthSettings.minRefreshInterval); // Ensure minimum of 1 minute
  const maxInterval = Math.max(minInterval + 1, stealthSettings.maxRefreshInterval); // Ensure maxInterval > minInterval

  console.log('Using stealthSettings in setupRefreshAlarm:', stealthSettings);
  console.log('minInterval:', minInterval, 'maxInterval:', maxInterval);

  const randomInterval = Math.floor(Math.random() * (maxInterval - minInterval + 1)) + minInterval;
  console.log('Calculated randomInterval:', randomInterval);
  // chrome.alarms.clear('refreshUpwork');

  if (!isMonitoring || !isAutoRefreshEnabled) {
    broadcastLog('Not setting up refresh alarm: monitoring or auto-refresh is disabled', 'info');
    return;
  }

  if (isInInactivePeriod()) {
    broadcastLog('Not setting up refresh alarm: in inactive period', 'info');
    return;
  }

  if (!monitorUrl) {
    broadcastLog('Not setting up refresh alarm: no monitor URL configured', 'error');
    return;
  }


  chrome.alarms.create('refreshUpwork', {
    delayInMinutes: randomInterval
  });

  nextRefreshTime = Date.now() + (randomInterval * 60 * 1000);

  // Store the next refresh time
  chrome.storage.local.set({ nextRefreshTime });

  // Notify the popup
  chrome.runtime.sendMessage({
    type: 'REFRESH_SCHEDULED',
    nextRefreshTime: nextRefreshTime
  });

  broadcastLog(`Next refresh scheduled in ${randomInterval} minutes`, 'info');
}

// Handle alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'refreshUpwork') {
    broadcastLog('Refresh alarm triggered', 'info');

    // Clear the current alarm
    await chrome.alarms.clear('refreshUpwork');

    if (!isInInactivePeriod() && isMonitoring) {
      await refreshUpworkTab();
    } else {
      broadcastLog('Skipping refresh: inactive period or monitoring disabled', 'info');
      // Set up next alarm if auto-refresh is still enabled
      if (isAutoRefreshEnabled) {
        setupRefreshAlarm();
      }
    }
  }
});

// Function to handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Background received message:', message);

  // Handle async operations
  const handleMessage = async () => {
    try {
      let response = { success: true };
      switch (message.type) {
        case 'NEW_JOBS':
          if (isMonitoring && !isInInactivePeriod()) {
            // Log detailed message structure for debugging
            console.log('Processing NEW_JOBS message:', {
              messageType: message.type,
              jobsArray: message.jobs,
              isArray: Array.isArray(message.jobs),
              jobsLength: message.jobs?.length,
              firstJob: message.jobs?.[0]
            });
            await handleNewJobs(message.jobs);
            response.message = 'Jobs processed successfully';
          } else {
            response.message = 'Jobs not processed: monitoring inactive or in inactive period';
          }
          break;

        case 'API_ENDPOINT_UPDATED':
          apiEndpoint = message.endpoint;
          await chrome.storage.local.set({ apiEndpoint });
          broadcastLog(`API endpoint updated to: ${apiEndpoint}`, 'info');
          break;

        case 'SCHEDULE_UPDATED':
          schedule = message.schedule;
          await chrome.storage.local.set({ schedule });
          setupRefreshAlarm(); // Reset alarm to account for new schedule
          broadcastLog('Schedule updated', 'info');
          break;

        case 'STEALTH_SETTINGS_UPDATED':
          stealthSettings = message.settings;
          await chrome.storage.local.set({ stealthSettings });
          setupRefreshAlarm(); // Reset alarm with new intervals
          broadcastLog('Stealth settings updated', 'info');
          break;

        case 'START_MONITORING':
          isMonitoring = true;
          await chrome.storage.local.set({ isMonitoring });
          if (isAutoRefreshEnabled) {
            setupRefreshAlarm();
          }
          broadcastLog('Monitoring started', 'success');
          updatePopupState(); // Ensure popup gets updated state
          break;

        case 'STOP_MONITORING':
          isMonitoring = false;
          nextRefreshTime = null;
          await chrome.alarms.clear('refreshUpwork');
          await chrome.storage.local.set({ isMonitoring, nextRefreshTime });
          broadcastLog('Monitoring stopped', 'info');
          updatePopupState(); // Ensure popup gets updated state
          break;

        case 'MANUAL_API_REQUEST':
          await sendJobNotification(message.job);
          break;

        case 'MONITOR_URL_UPDATED':
          monitorUrl = message.url;
          await chrome.storage.local.set({ monitorUrl }); // Save the new URL
          broadcastLog(`Monitor URL updated: ${monitorUrl}`, 'info');
          updatePopupState(); // <<<--- ADD THIS LINE: Explicitly send updated state
          break;

        case 'REFRESH_NOW':
          await refreshUpworkTab();
          break;

        case 'TOGGLE_AUTO_REFRESH':
          isAutoRefreshEnabled = message.enabled;
          await chrome.storage.local.set({ isAutoRefreshEnabled });

          if (isAutoRefreshEnabled && isMonitoring) {
            setupRefreshAlarm();
          } else {
            await chrome.alarms.clear('refreshUpwork');
            await chrome.storage.local.remove('nextRefreshTime');
            nextRefreshTime = null;
          }

          broadcastLog(`Auto-refresh ${isAutoRefreshEnabled ? 'enabled' : 'disabled'}`, 'info');
          break;

        case 'GET_STATE':
          updatePopupState();
          break;

        case 'NEW_JOBS_FOUND':
          if (message.jobs && message.jobs.length > 0) {
            broadcastLog(`[Job Monitor] Received ${message.jobs.length} new jobs after refresh`, 'info');
            // Use the existing handleNewJobs function to process and send notifications
            await handleNewJobs(message.jobs);
          }
          break;

      }
    } catch (error) {
      console.error('Error handling message:', error);
      broadcastLog(`Error handling message: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
    return response;
  };

  // Execute handleMessage and send response
  handleMessage()
    .then(response => sendResponse(response))
    .catch(error => sendResponse({
      success: false,
      error: error.message
    }));

  // Return true to indicate we will send a response asynchronously
  return true;
}
);

// Initialize when extension loads
initializeStorage();

// Check schedule periodically
setInterval(() => {
  const currentInactive = isInInactivePeriod();

  if (isMonitoring) {
    if (currentInactive) {
      chrome.alarms.clear('refreshUpwork');
      broadcastLog('Monitoring paused due to scheduled inactive period', 'info');
    } else if (isAutoRefreshEnabled && !nextRefreshTime) {
      setupRefreshAlarm();
      broadcastLog('Monitoring resumed after inactive period', 'info');
    }
  }

  // Update popup with current state periodically
  updatePopupState();
}, 60000); // Check every minute

// Additional listener for runtime connection
chrome.runtime.onConnect.addListener((port) => {
  console.log('Connection established with:', port.name);

  // Send current state when a connection is established
  if (port.name === 'popup') {
    port.postMessage({
      type: 'STATE_UPDATE',
      state: {
        isMonitoring,
        isAutoRefreshEnabled,
        nextRefreshTime,
        monitorUrl,
        isInInactivePeriod: isInInactivePeriod()
      }
    });

    port.onDisconnect.addListener(() => {
      console.log('Popup disconnected');
    });
  }
});