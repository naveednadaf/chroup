// Get DOM elements
const apiEndpointInput = document.getElementById('apiEndpoint');
const saveEndpointButton = document.getElementById('saveEndpoint');
const testEndpointButton = document.getElementById('testEndpoint');
const endpointStatus = document.getElementById('endpointStatus');
const testResult = document.getElementById('testResult');
const logContainer = document.getElementById('logContainer');

// Get DOM elements for stealth settings
const minRefreshInput = document.getElementById('minRefreshInterval');
const maxRefreshInput = document.getElementById('maxRefreshInterval');
const preRefreshDelayInput = document.getElementById('preRefreshDelay');
const saveStealthButton = document.getElementById('saveStealthSettings');
const stealthStatus = document.getElementById('stealthStatus');

// Save stealth settings
saveStealthButton.addEventListener('click', async () => {
  const minRefreshInterval = parseInt(minRefreshInput.value, 10);
  const maxRefreshInterval = parseInt(maxRefreshInput.value, 10);
  const preRefreshDelay = parseInt(preRefreshDelayInput.value, 10);

  // Basic validation
  if (isNaN(minRefreshInterval) || isNaN(maxRefreshInterval) || isNaN(preRefreshDelay) ||
      minRefreshInterval <= 0 || maxRefreshInterval <= 0 || minRefreshInterval > maxRefreshInterval || preRefreshDelay < 0) {
    showStatus(stealthStatus, 'Invalid input values. Min/Max must be positive numbers, Min must be <= Max, Delay >= 0.', true);
    return;
  }

  try {
    const stealthSettings = {
      minRefreshInterval,
      maxRefreshInterval,
      preRefreshDelay
    };
    await chrome.storage.local.set({ stealthSettings });

    // Notify background script of stealth settings update
    chrome.runtime.sendMessage({
      type: 'STEALTH_SETTINGS_UPDATED',
      settings: stealthSettings
    });

    showStatus(stealthStatus, 'Stealth settings saved successfully');
    addLog('Stealth settings saved and background notified', 'success'); // Optional logging

  } catch (error) {
    showStatus(stealthStatus, `Failed to save stealth settings: ${error.message}`, true);
  }
});

// --- End of block to add ---

// Function to add log entry
function addLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
  logContainer.insertBefore(entry, logContainer.firstChild);
  
  // Keep only last 100 entries
  while (logContainer.children.length > 100) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

// Load saved settings
async function loadSettings() {
  try {
    const result = await chrome.storage.local.get([
      'apiEndpoint',
      'schedule',
      'stealthSettings'
    ]);

    addLog('Retrieved stored settings:', 'info');
    addLog(`API Endpoint: ${result.apiEndpoint ? 'Present' : 'Not set'}`, 'info');
    addLog(`Schedule: ${result.schedule ? 'Present' : 'Not set'}`, 'info');
    addLog(`Stealth Settings: ${result.stealthSettings ? 'Present' : 'Not set'}`, 'info');

    if (result.apiEndpoint) {
      apiEndpointInput.value = result.apiEndpoint;
      addLog(`Loaded saved endpoint: ${result.apiEndpoint}`, 'info');
    }

    if (result.schedule) {
      document.getElementById('timezone').value = result.schedule.timezone || 'Asia/Kolkata';
      document.getElementById('inactiveStart').value = result.schedule.inactiveStart || '13:00';
      document.getElementById('inactiveEnd').value = result.schedule.inactiveEnd || '23:00';
      updateCurrentSchedule(result.schedule);
      addLog('Loaded saved schedule settings', 'info');
    }

    if (result.stealthSettings) {
      const settings = result.stealthSettings;
      minRefreshInput.value = settings.minRefreshInterval || 4;
      maxRefreshInput.value = settings.maxRefreshInterval || 7;
      preRefreshDelayInput.value = settings.preRefreshDelay || 5;
      addLog(`Loaded stealth settings - Min: ${minRefreshInput.value}, Max: ${maxRefreshInput.value}, Delay: ${preRefreshDelayInput.value}`, 'info');
    }
  } catch (error) {
    addLog(`Error loading settings: ${error.message}`, 'error');
    console.error('Failed to load settings:', error);
  }
}

// Function to validate URL
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// Function to show status
function showStatus(element, message, isError = false) {
  element.textContent = message;
  element.className = `status ${isError ? 'error' : 'success'}`;
  addLog(message, isError ? 'error' : 'success');
}

// Function to test endpoint with sample data
async function testEndpoint(url) {
  addLog(`Testing endpoint: ${url}`, 'info');
  const testPayload = {
    jobUid: "test_1234567890",
    title: "Test Job Posting",
    url: "https://www.upwork.com/jobs/test-job",
    postedTimeAgo: "Just now",
    descriptionSnippet: "This is a test job posting to verify the API endpoint.",
    jobType: "Fixed price",
    experienceLevel: "Intermediate",
    budget: "$100.00",
    skills: ["API Testing", "Quality Assurance"],
    clientInfo: {
      paymentVerified: true,
      rating: 4.5,
      feedbackCount: 10,
      totalSpent: "$1,000",
      location: "Test Location"
    },
    proposals: "Less than 5",
    timestampDetected: new Date().toISOString()
  };

  try {
    addLog('Sending test request...', 'info');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testPayload)
    });

    const responseText = await response.text();
    addLog(`Response status: ${response.status}`, response.ok ? 'success' : 'error');
    addLog(`Response body: ${responseText}`, response.ok ? 'success' : 'error');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${responseText || 'No response details available'}`);
    }

    testResult.style.display = 'block';
    testResult.textContent = `Test successful!\nEndpoint: ${url}\nResponse: ${responseText}`;
    return true;
  } catch (error) {
    console.error('Detailed error:', error);
    addLog(`Error: ${error.message}`, 'error');
    testResult.style.display = 'block';
    testResult.textContent = `Test failed!\nEndpoint: ${url}\nError: ${error.message}\n\nTroubleshooting tips:\n` +
      '1. Check if the webhook URL is correct\n' +
      '2. Ensure the endpoint accepts POST requests\n' +
      '3. Verify the endpoint can handle JSON payloads\n' +
      '4. Check if the endpoint is accessible (no firewall/CORS issues)\n' +
      '5. Verify if the endpoint requires authentication';
    return false;
  }
}

// Save endpoint
saveEndpointButton.addEventListener('click', async () => {
  const url = apiEndpointInput.value.trim();
  addLog(`Attempting to save endpoint: ${url}`, 'info');
  
  if (!url) {
    showStatus(endpointStatus, 'Please enter an API endpoint URL', true);
    return;
  }

  if (!isValidUrl(url)) {
    showStatus(endpointStatus, 'Please enter a valid URL', true);
    return;
  }

  try {
    await chrome.storage.local.set({ apiEndpoint: url });
    showStatus(endpointStatus, 'API endpoint saved successfully');
    
    // Notify background script of new endpoint
    chrome.runtime.sendMessage({
      type: 'API_ENDPOINT_UPDATED',
      endpoint: url
    });
    addLog('Notified background script of new endpoint', 'success');
  } catch (error) {
    showStatus(endpointStatus, `Failed to save endpoint: ${error.message}`, true);
  }
});

// Test endpoint
testEndpointButton.addEventListener('click', async () => {
  const url = apiEndpointInput.value.trim();
  
  if (!url) {
    showStatus(endpointStatus, 'Please enter an API endpoint URL', true);
    return;
  }

  if (!isValidUrl(url)) {
    showStatus(endpointStatus, 'Please enter a valid URL', true);
    return;
  }

  showStatus(endpointStatus, 'Testing endpoint...');
  const success = await testEndpoint(url);
  showStatus(endpointStatus, success ? 'Endpoint test successful!' : 'Endpoint test failed! Check details below.', !success);
});

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case 'NEW_JOBS':
      addLog(`Found ${message.jobs.length} new job(s)`, 'success');
      break;
    case 'JOB_NOTIFIED':
      addLog(`Sent notification for job: ${message.job.title}`, 'success');
      break;
    case 'ERROR':
      addLog(`Error: ${message.error}`, 'error');
      break;
    case 'PAGE_REFRESHED':
      addLog('Page refreshed', 'info');
      break;
  }
});

// Save schedule settings
document.getElementById('saveSchedule').addEventListener('click', async () => {
  const timezone = document.getElementById('timezone').value;
  const inactiveStart = document.getElementById('inactiveStart').value;
  const inactiveEnd = document.getElementById('inactiveEnd').value;
  const scheduleStatus = document.getElementById('scheduleStatus');

  try {
    const schedule = { timezone, inactiveStart, inactiveEnd };
    await chrome.storage.local.set({ schedule });

    // Notify background script of schedule update
    chrome.runtime.sendMessage({
      type: 'SCHEDULE_UPDATED',
      schedule
    });

    showStatus(scheduleStatus, 'Schedule settings saved successfully');
    updateCurrentSchedule(schedule);
  } catch (error) {
    showStatus(scheduleStatus, `Failed to save schedule: ${error.message}`, true);
  }
});

// Load settings when page opens
loadSettings();

// Function to update current schedule display
function updateCurrentSchedule(schedule) {
  const scheduleStatus = document.getElementById('scheduleStatus');
  const formattedTime = (time) => {
    const [hours, minutes] = time.split(':');
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${period}`;
  };

  const message = `Current Schedule: Inactive from ${formattedTime(schedule.inactiveStart)} to ${formattedTime(schedule.inactiveEnd)} (${schedule.timezone})`;
  showStatus(scheduleStatus, message);
}