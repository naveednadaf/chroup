// Get DOM elements
const statusDiv = document.getElementById('status');
const toggleButton = document.getElementById('toggleMonitor');
const logDiv = document.getElementById('log');
const refreshStatus = document.getElementById('refreshStatus');
const countdownSpan = document.getElementById('countdown');
const toggleAutoRefreshButton = document.getElementById('toggleAutoRefresh');
const refreshNowButton = document.getElementById('refreshNow');
const monitorUrlInput = document.getElementById('monitorUrl');

// State variables
let isMonitoring = false;
let isAutoRefreshEnabled = false;
let countdownInterval = null;
let nextRefreshTime = null;
let monitorUrl = '';
let port = null; // For persistent connection

// Connect to background script
// function connectToBackground() {
//   // Disconnect any existing port
//   if (port) {
//     port.disconnect();
//   }
  
//   // Create a new connection
//   port = chrome.runtime.connect({ name: 'popup' });
  
//   port.onMessage.addListener((message) => {
//     console.log('Port message received:', message);
//     if (message.type === 'STATE_UPDATE') {
//       handleStateUpdate(message.state);
//     }
//   });
  
//   port.onDisconnect.addListener(() => {
//     console.log('Port disconnected, attempting to reconnect...');
//     setTimeout(connectToBackground, 1000); // Try to reconnect after a delay
//   });
// }

// Function to handle state updates
function handleStateUpdate(state) {
  console.log('Popup received STATE_UPDATE:', state); // Add detailed log

  // Update internal variables
  isMonitoring = state.isMonitoring;
  isAutoRefreshEnabled = state.isAutoRefreshEnabled;
  nextRefreshTime = state.nextRefreshTime;
  monitorUrl = state.monitorUrl || ''; // Use || '' to handle potential null/undefined

  // --- Update UI Elements ---
  // Update URL input field *reliably*
  if (monitorUrlInput.value !== monitorUrl) {
     console.log('Updating monitorUrlInput value to:', monitorUrl);
     monitorUrlInput.value = monitorUrl;
  }

  // Update Status Div
  updateUI(isMonitoring, state.isInInactivePeriod ? 'INACTIVE_SCHEDULED' : null);

  // Update Refresh Status section
  updateRefreshStatus(); // This updates text and button enabled states

  // Update Countdown
  if (isAutoRefreshEnabled && nextRefreshTime) {
    startCountdown();
  } else {
    stopCountdown();
  }
  console.log('Popup UI updated based on state.');
}


// Function to format time in user's timezone
function formatTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: true,
    timeZoneName: 'short'
  }).format(date);
}

// Function to format countdown
function formatCountdown(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

// Function to update countdown display
function updateCountdown() {
  if (!nextRefreshTime || !isAutoRefreshEnabled) {
    countdownSpan.textContent = '--:--';
    return;
  }

  const now = Date.now();
  const timeLeft = nextRefreshTime - now;
  
  if (timeLeft <= 0) {
    countdownSpan.textContent = 'Refreshing...';
  } else {
    countdownSpan.textContent = formatCountdown(timeLeft);
  }
}

// Function to start countdown
function startCountdown() {
  stopCountdown(); // Clear any existing countdown
  
  countdownInterval = setInterval(updateCountdown, 1000);
  updateCountdown(); // Update immediately
}

// Function to stop countdown
function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownSpan.textContent = '--:--';
}

// Function to update refresh status
function updateRefreshStatus() {
  refreshStatus.textContent = isAutoRefreshEnabled ? 'Enabled' : 'Disabled';
  toggleAutoRefreshButton.textContent = isAutoRefreshEnabled ? 'Disable Auto-refresh' : 'Enable Auto-refresh';
  
  refreshNowButton.disabled = !isMonitoring || !monitorUrl;
  toggleAutoRefreshButton.disabled = !isMonitoring || !monitorUrl;
}

// Function to update UI
function updateUI(active, scheduleStatus = null) {
  isMonitoring = active;
  
  let statusText = '';
  let statusClass = '';
  
  if (active) {
    if (scheduleStatus === 'INACTIVE_SCHEDULED') {
      statusText = 'Monitoring paused (scheduled inactive period)';
      statusClass = 'status inactive';
    } else {
      statusText = 'Actively monitoring for new jobs';
      statusClass = 'status active';
    }
  } else {
    statusText = 'Monitoring stopped';
    statusClass = 'status';
  }
  
  statusDiv.textContent = statusText;
  statusDiv.className = statusClass;
  toggleButton.textContent = active ? 'Stop Monitoring' : 'Start Monitoring';
  
  // Update refresh button states - only enable if monitoring is active AND URL is set
  const enableRefreshButtons = active && monitorUrl;
  refreshNowButton.disabled = !enableRefreshButtons;
  toggleAutoRefreshButton.disabled = !enableRefreshButtons;
}

// Function to add log entry
function addLogEntry(message, isError = false) {
  const entry = document.createElement('div');
  entry.textContent = `${formatTime(new Date())}: ${message}`;
  if (isError) {
    entry.style.color = '#660000';
  }
  logDiv.insertBefore(entry, logDiv.firstChild);
  
  // Keep only last 50 log entries
  while (logDiv.children.length > 50) {
    logDiv.removeChild(logDiv.lastChild);
  }
}

// Function to check API endpoint configuration
async function checkApiEndpoint() {
  try {
    const result = await chrome.storage.local.get(['apiEndpoint']);
    if (!result.apiEndpoint) {
      statusDiv.textContent = 'API endpoint not configured';
      statusDiv.className = 'status error';
      toggleButton.disabled = true;
      addLogEntry('Warning: Configure API endpoint in extension settings', true);
      
      // Add settings link
      const settingsLink = document.createElement('a');
      settingsLink.href = '#';
      settingsLink.textContent = 'Open Settings';
      settingsLink.onclick = () => chrome.runtime.openOptionsPage();
      statusDiv.appendChild(document.createElement('br'));
      statusDiv.appendChild(settingsLink);
      return false;
    }
    return true;
  } catch (error) {
    console.error('Error checking API endpoint:', error);
    addLogEntry(`Error checking API endpoint: ${error.message}`, true);
    return false;
  }
}

// Initialize popup state when opened
async function initializePopup() {
  console.log('Initializing popup...'); // Log start

  // Clear previous logs? Optional.
  // logDiv.innerHTML = '';

  // --- REMOVE or COMMENT OUT the direct storage read ---
  /*
  try {
    const result = await chrome.storage.local.get({ ... });
    // ... processing result ...
  } catch (error) {
      console.error('Error initializing popup from storage:', error);
      addLogEntry(`Error initializing popup from storage: ${error.message}`, true);
  }
  */
  // --- END OF REMOVED BLOCK ---

  // Check API endpoint configuration (keep this)
  const apiConfigured = await checkApiEndpoint();
  if (!apiConfigured) {
    console.log('API not configured, stopping init.');
    return; // Stop initialization if API not set
  }

  // --- ONLY send GET_STATE to background ---
  console.log('Sending GET_STATE to background script...');
  try {
      chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
          if (chrome.runtime.lastError) {
              console.error('Error sending GET_STATE:', chrome.runtime.lastError.message);
              addLogEntry(`Error contacting background script: ${chrome.runtime.lastError.message}`, true);
          } else {
              console.log('GET_STATE message sent successfully.');
              // Optional: Handle immediate response if background sends one,
              // but primary state update comes via STATE_UPDATE message.
          }
      });
  } catch (error) {
      console.error('Exception sending GET_STATE:', error);
      addLogEntry(`Exception contacting background script: ${error.message}`, true);
  }

  // State will be updated via the 'STATE_UPDATE' listener below
  addLogEntry('Popup requesting state from background...'); // Log request
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Popup received message:', message);
  
  switch (message.type) {
    case 'LOG':
      addLogEntry(`${message.message}`, message.logType === 'error');
      break;
      
    case 'NEW_JOBS':
      addLogEntry(`Found ${message.jobs.length} new job(s)`);
      break;
    
    case 'API_REQUEST_SENDING':
      addLogEntry(`Sending job to API: ${message.job.title}`);
      break;

    case 'API_REQUEST_SUCCESS':
      addLogEntry(`Successfully sent to API: ${message.job.title}`, false);
      break;

    case 'API_REQUEST_FAILED':
      addLogEntry(`Failed to send to API: ${message.error}`, true);
      break;
    
    case 'ERROR':
      addLogEntry(`Error: ${message.error}`, true);
      statusDiv.className = 'status error';
      break;
      
    case 'REFRESH_STATUS':
      switch (message.status) {
        case 'STARTING':
          addLogEntry('Starting page refresh...');
          break;
        case 'COMPLETED':
          addLogEntry('Page refreshed successfully');
          break;
        case 'NEW_TAB_OPENED':
          addLogEntry('New tab opened with monitor URL');
          break;
        case 'CANCELLED':
          addLogEntry(`Refresh cancelled: ${message.reason}`);
          break;
        case 'ERROR':
          addLogEntry(`Refresh error: ${message.error}`, true);
          break;
      }
      break;
      
    case 'STATE_UPDATE':
      handleStateUpdate(message.state);
      break;
      
    case 'REFRESH_SCHEDULED':
      nextRefreshTime = message.nextRefreshTime;
      
      // Start or update countdown
      if (isAutoRefreshEnabled) {
        startCountdown();
      }
      
      addLogEntry(`Next refresh scheduled for ${formatTime(new Date(nextRefreshTime))}`, false);
      break;
  }
});

// Handle toggle monitoring button click
toggleButton.addEventListener('click', async () => {
  try {
    const apiConfigured = await checkApiEndpoint();
    if (!apiConfigured) return;

    const newState = !isMonitoring;
    
    // Update local state
    isMonitoring = newState;
    
    // Save to storage directly in addition to sending message
    chrome.storage.local.set({ isMonitoring: newState });
    
    // Send message to background script
    chrome.runtime.sendMessage({
      type: newState ? 'START_MONITORING' : 'STOP_MONITORING'
    });

    // Update UI immediately
    updateUI(newState);
    
    // Wait for state update from background script
    addLogEntry(`Requesting to ${newState ? 'start' : 'stop'} monitoring...`);
  } catch (error) {
    console.error('Error toggling monitoring:', error);
    addLogEntry(`Error toggling monitoring: ${error.message}`, true);
  }
});

// Handle toggle auto-refresh button click
toggleAutoRefreshButton.addEventListener('click', () => {
  try {
    isAutoRefreshEnabled = !isAutoRefreshEnabled;
    
    // Save to storage directly in addition to sending message
    chrome.storage.local.set({ isAutoRefreshEnabled });
    
    chrome.runtime.sendMessage({
      type: 'TOGGLE_AUTO_REFRESH',
      enabled: isAutoRefreshEnabled
    });
    
    updateRefreshStatus();
    
    if (isAutoRefreshEnabled) {
      addLogEntry('Auto-refresh enabled, scheduling first refresh');
      // Next refresh will be scheduled by background script
    } else {
      stopCountdown();
      addLogEntry('Auto-refresh disabled');
    }
  } catch (error) {
    console.error('Error toggling auto-refresh:', error);
    addLogEntry(`Error toggling auto-refresh: ${error.message}`, true);
  }
});

// Handle refresh now button click
refreshNowButton.addEventListener('click', () => {
  try {
    if (!monitorUrl) {
      addLogEntry('Please enter a URL to monitor first', true);
      return;
    }
    
    chrome.runtime.sendMessage({ type: 'REFRESH_NOW' });
    addLogEntry('Manual refresh requested');
  } catch (error) {
    console.error('Error requesting refresh:', error);
    addLogEntry(`Error requesting refresh: ${error.message}`, true);
  }
});

// Handle monitor URL changes
// Handle monitor URL changes
monitorUrlInput.addEventListener('input', () => {
  try {
    const url = monitorUrlInput.value.trim();
    handleUrlUpdate(url);
  } catch (error) {
    console.error('Error updating monitor URL:', error);
    addLogEntry(`Error updating monitor URL: ${error.message}`, true);
  }
});

monitorUrlInput.addEventListener('change', () => {
  try {
    const url = monitorUrlInput.value.trim();
    handleUrlUpdate(url);
  } catch (error) {
    console.error('Error updating monitor URL:', error);
    addLogEntry(`Error updating monitor URL: ${error.message}`, true);
  }
});

// Inside popup.js
// In popup.js

// Function to handle URL updates
function handleUrlUpdate(url) {
  try { // Wrap in try-catch for better error handling during update
    if (url && url.startsWith('https://www.upwork.com/')) {
      monitorUrl = url; // Update local variable for immediate UI feedback if needed

      // Send message to background script to handle the update and persistence
      chrome.runtime.sendMessage({
        type: 'MONITOR_URL_UPDATED',
        url: monitorUrl
      });

      // Use the correct function name: addLogEntry
      addLogEntry(`Monitor URL update sent to background: ${monitorUrl}`); // Corrected function name

      // Enable buttons if monitoring is active (UI update based on current popup state)
      if (isMonitoring) {
        refreshNowButton.disabled = false;
        toggleAutoRefreshButton.disabled = false;
      }
    } else if (url === '') {
        // Handle empty URL if necessary, maybe disable buttons
        addLogEntry('Monitor URL cleared.'); // Corrected function name
        refreshNowButton.disabled = true;
        toggleAutoRefreshButton.disabled = true;
    } else {
      // Use the correct function name: addLogEntry
      addLogEntry('Please enter a valid Upwork URL', true); // Corrected function name
      // Optionally restore previous valid URL visually or clear the input
      // monitorUrlInput.value = monitorUrl; // Example: Restore previous valid URL
    }
  } catch (error) {
      console.error('Error in handleUrlUpdate:', error);
      // Use the correct function name: addLogEntry
      addLogEntry(`Error processing URL update: ${error.message}`, true); // Corrected function name
  }
}

initializePopup();

// Handle settings button click
document.getElementById('openSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  addLogEntry('Opening settings page');
});

// Add warning about ToS
const warning = document.createElement('div');
warning.className = 'warning';
warning.innerHTML = `
  <small>
    <strong>Note:</strong> This tool may violate Upwork's Terms of Service. 
    Use at your own risk.
  </small>
`;
document.body.appendChild(warning);