// Selectors from Section 7 of requirements
const SELECTORS = {
  jobContainer: "article.job-tile[data-test='JobTile']",
  jobUID: "data-ev-job-uid", // attribute
  title: "h2.job-tile-title a",
  url: "h2.job-tile-title a", // href attribute
  postedTime: "small[data-test='job-pubilshed-date'] span:last-child",
  description: "div[data-test='UpCLineClamp JobDescription'] p",
  jobType: "ul[data-test='JobInfo'] li[data-test='job-type-label'] strong",
  experienceLevel: "ul[data-test='JobInfo'] li[data-test='experience-level'] strong",
  budget: "ul[data-test='JobInfo'] li[data-test='is-fixed-price'] strong:last-child",
  skills: "div[data-test='TokenClamp JobAttrs'] button[data-test='token'] span",
  paymentVerified: "ul[data-test='JobInfoClient'] li[data-test='payment-verified']",
  clientRating: "li[data-test='total-feedback'] div.air3-rating-value-text",
  clientSpent: "li[data-test='total-spent'] strong",
  clientLocation: "li[data-test='location'] div.air3-badge-tagline",
  proposals: "li[data-test='proposals-tier'] strong"
};

// Function to convert posted time to minutes
function getMinutesFromPostedTime(timeText) {
  const matches = timeText.match(/(\d+)\s+(minute|hour|day|month|year)s?\s+ago/i);
  if (!matches) return Number.MAX_SAFE_INTEGER;

  const [_, number, unit] = matches;
  const value = parseInt(number);

  switch (unit.toLowerCase()) {
    case 'minute':
      return value;
    case 'hour':
      return value * 60;
    case 'day':
      return value * 24 * 60;
    case 'month':
      return value * 30 * 24 * 60;
    case 'year':
      return value * 365 * 24 * 60;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

// Function to safely get text content
function getTextContent(element, selector) {
  const el = element.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

// Function to get all text content from matching elements
function getAllTextContent(element, selector) {
  return Array.from(element.querySelectorAll(selector))
    .map(el => el.textContent.trim());
}

// Function to parse a job container element
function parseJobContainer(container) {
  try {
    const jobUid = container.getAttribute(SELECTORS.jobUID);
    if (!jobUid) return null;

    const titleElement = container.querySelector(SELECTORS.title);
    const url = titleElement ? 
      new URL(titleElement.getAttribute('href'), 'https://www.upwork.com').href : '';

    // Parse payment verification status
    const paymentVerifiedEl = container.querySelector(SELECTORS.paymentVerified);
    const paymentVerified = paymentVerifiedEl ? 
      !paymentVerifiedEl.textContent.toLowerCase().includes('unverified') : false;

    // Parse client rating
    const ratingText = getTextContent(container, SELECTORS.clientRating);
    const rating = ratingText ? parseFloat(ratingText) : 0.0;

    // Get posted time
    const postedTimeText = getTextContent(container, SELECTORS.postedTime);
    const minutesAgo = getMinutesFromPostedTime(postedTimeText);

    return {
      uid: jobUid,
      title: getTextContent(container, SELECTORS.title),
      url: url,
      postedTimeAgo: postedTimeText,
      minutesAgo: minutesAgo, // Add this for sorting
      descriptionSnippet: getTextContent(container, SELECTORS.description),
      jobType: getTextContent(container, SELECTORS.jobType),
      experienceLevel: getTextContent(container, SELECTORS.experienceLevel),
      budget: getTextContent(container, SELECTORS.budget),
      skills: getAllTextContent(container, SELECTORS.skills),
      clientInfo: {
        paymentVerified: paymentVerified,
        rating: rating,
        feedbackCount: rating > 0 ? 1 : 0, // Simplified for Phase 1
        totalSpent: getTextContent(container, SELECTORS.clientSpent),
        location: getTextContent(container, SELECTORS.clientLocation)
      },
      proposals: getTextContent(container, SELECTORS.proposals),
      timestampDetected: new Date().toISOString()
    };
  } catch (error) {
    console.error('Error parsing job container:', error);
    return null;
  }
}

// Function to scan the page for jobs
function scanJobs() {
  try {
    const jobContainers = document.querySelectorAll(SELECTORS.jobContainer);
    const jobs = Array.from(jobContainers)
      .map(parseJobContainer)
      .filter(job => job !== null);

    // Sort jobs by minutes ago (most recent first)
    jobs.sort((a, b) => a.minutesAgo - b.minutesAgo);

    if (jobs.length > 0) {
      // Send only the most recent jobs (those posted within the last scan)
      const mostRecentTime = jobs[0].minutesAgo;
      const recentJobs = jobs.filter(job => job.minutesAgo === mostRecentTime);

      if (recentJobs.length > 0) {
        // Send jobs to background script
        chrome.runtime.sendMessage({
          type: 'NEW_JOBS',
          jobs: recentJobs
        });
      }
    }
  } catch (error) {
    console.error('Error scanning jobs:', error);
  }
}

// Run initial scan when content script loads
scanJobs();

// Set up mutation observer to detect dynamic content updates
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      // Wait a short moment for any dynamic content to settle
      setTimeout(scanJobs, 500);
      break;
    }
  }
});

// Start observing the job feed container
const jobFeedContainer = document.querySelector('div[data-test="JobFeedContainer"]');
if (jobFeedContainer) {
  observer.observe(jobFeedContainer, {
    childList: true,
    subtree: true
  });
}

// Flag to track if we've sent a test job after page load
let sentTestJobAfterLoad = false;

// Store previously seen jobs to compare after refresh
let previousJobs = [];

// Function to extract jobs from the page with time-based identification
function extractJobs() {
  // Check if we're on a job search page
  if (!window.location.href.includes('/search/jobs')) {
    return [];
  }

  const jobCards = document.querySelectorAll('[data-test="job-tile-list"] [data-test="job-tile"]');
  if (!jobCards || jobCards.length === 0) {
    console.log('[Upwork Job Monitor] No job cards found on page');
    return [];
  }

  console.log(`[Upwork Job Monitor] Found ${jobCards.length} job cards`);
  const extractedJobs = [];

  jobCards.forEach((card, index) => {
    try {
      // Extract job details
      const titleElement = card.querySelector('[data-test="job-title"]');
      const title = titleElement ? titleElement.textContent.trim() : 'Unknown Job';
      
      const urlElement = titleElement ? titleElement.closest('a') : null;
      const url = urlElement ? urlElement.href : '';
      
      // Generate a unique ID for the job
      const jobUid = url ? url.split('/').pop() : `job_${Date.now()}_${index}`;
      
      // Extract other job details
      const postedTimeElement = card.querySelector('[data-test="job-tile-timeposted"]');
      const postedTimeAgo = postedTimeElement ? postedTimeElement.textContent.trim() : '';
      
      // Get the timestamp data attribute for precise time comparison
      const timeDataAttribute = postedTimeElement ? postedTimeElement.getAttribute('data-v-6e74a038') : '';
      
      const descElement = card.querySelector('[data-test="job-description-text"]');
      const descriptionSnippet = descElement ? descElement.textContent.trim() : '';
      
      const jobTypeElement = card.querySelector('[data-test="job-type"]');
      const jobType = jobTypeElement ? jobTypeElement.textContent.trim() : '';
      
      const expLevelElement = card.querySelector('[data-test="contractor-tier"]');
      const experienceLevel = expLevelElement ? expLevelElement.textContent.trim() : '';
      
      const budgetElement = card.querySelector('[data-test="budget"]');
      const budget = budgetElement ? budgetElement.textContent.trim() : '';
      
      const proposalsElement = card.querySelector('[data-test="proposals"]');
      const proposals = proposalsElement ? proposalsElement.textContent.trim() : '';
      
      // Extract skills
      const skillElements = card.querySelectorAll('[data-test="skill-tag"]');
      const skills = Array.from(skillElements).map(el => el.textContent.trim());
      
      // Extract client info
      const clientCountryElement = card.querySelector('[data-test="client-country"]');
      const clientRatingElement = card.querySelector('[data-test="client-feedback"]');
      const clientSpentElement = card.querySelector('[data-test="client-spendings"]');
      
      const clientInfo = {
        country: clientCountryElement ? clientCountryElement.textContent.trim() : '',
        rating: clientRatingElement ? clientRatingElement.textContent.trim() : '',
        spent: clientSpentElement ? clientSpentElement.textContent.trim() : ''
      };
      
      const job = {
        jobUid,
        title,
        url,
        postedTimeAgo,
        timeDataAttribute, // Store the time data attribute for comparison
        descriptionSnippet,
        jobType,
        experienceLevel,
        budget,
        skills,
        clientInfo,
        proposals,
        timestampDetected: new Date().toISOString()
      };
      
      extractedJobs.push(job);
    } catch (error) {
      console.error('[Upwork Job Monitor] Error extracting job details:', error);
    }
  });
  
  return extractedJobs;
}

// Function to find new jobs by comparing with previous jobs
function findNewJobs(currentJobs) {
  if (!previousJobs.length) {
    // First run, store jobs but don't report any as new
    console.log('[Upwork Job Monitor] First run, storing jobs for future comparison');
    previousJobs = [...currentJobs];
    return [];
  }
  
  // Find jobs that weren't in the previous set
  const newJobs = currentJobs.filter(current => {
    // First try to match by URL (most reliable)
    const urlMatch = previousJobs.find(prev => prev.url === current.url);
    if (!urlMatch) return true; // If URL doesn't match any previous job, it's new
    
    // If URL matches, check the time data attribute if available
    if (current.timeDataAttribute && urlMatch.timeDataAttribute !== current.timeDataAttribute) {
      return true; // Same URL but different time attribute means it's been updated
    }
    
    // If no time attribute, fall back to comparing the posted time text
    if (current.postedTimeAgo && urlMatch.postedTimeAgo !== current.postedTimeAgo) {
      return true; // Same URL but different posted time text means it's been updated
    }
    
    return false; // Not new
  });
  
  // Update previous jobs for next comparison
  previousJobs = [...currentJobs];
  
  return newJobs;
}

// Run extraction when content script loads and set up mutation observer
setTimeout(() => {
  const jobs = extractJobs();
  if (jobs.length > 0) {
    // Store jobs but don't send on first load
    previousJobs = [...jobs];
    console.log('[Upwork Job Monitor] Stored initial jobs:', previousJobs.length);
  }
  
  // Set up mutation observer to detect new jobs
  observeJobChanges();
}, 2000);

// Function to handle DOM changes and check for new jobs
function observeJobChanges() {
  // Create a mutation observer to watch for changes to the job list
  const observer = new MutationObserver((mutations) => {
    // Debounce to avoid multiple rapid checks
    clearTimeout(window.__upworkJobObserverTimeout);
    window.__upworkJobObserverTimeout = setTimeout(() => {
      const currentJobs = extractJobs();
      if (currentJobs.length === 0) return;
      
      // Find truly new jobs
      const newJobs = findNewJobs(currentJobs);
      if (newJobs.length > 0) {
        console.log(`[Upwork Job Monitor] Found ${newJobs.length} new jobs:`, newJobs);
        // Send new jobs to background script for notification
        chrome.runtime.sendMessage({
          type: 'NEW_JOBS_FOUND',
          jobs: newJobs
        });
      }
    }, 1000);
  });
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// --- LOG OVERLAY INJECT ---
(function injectLogOverlay() {
  if (window.__upworkJobMonitorLogOverlayInjected) return;
  window.__upworkJobMonitorLogOverlayInjected = true;

  console.log('[Upwork Job Monitor] Injecting log overlay');

  const overlay = document.createElement('div');
  overlay.id = 'upwork-job-monitor-log-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = '24px';
  overlay.style.right = '24px';
  overlay.style.width = 'min(96vw, 370px)';
  overlay.style.maxWidth = '98vw';
  overlay.style.maxHeight = '40vh';
  overlay.style.overflowY = 'auto';
  overlay.style.zIndex = '999999';
  overlay.style.background = '#f3f6fa'; // subtle light background
  overlay.style.backdropFilter = '';
  overlay.style.boxShadow = '0 8px 32px 0 rgba(31,38,135,0.12), 0 1.5px 5px 0 rgba(25, 118, 210, 0.08)';
  overlay.style.border = 'none';
  overlay.style.borderRadius = '16px';
  overlay.style.fontFamily = 'system-ui,Segoe UI,Roboto,sans-serif';
  overlay.style.fontSize = '14px';
  overlay.style.padding = '18px 16px 14px 14px';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column-reverse';
  overlay.style.gap = '10px';
  overlay.style.pointerEvents = 'none';
  overlay.style.transition = 'opacity 0.5s';
  overlay.style.opacity = '1';

  document.body.appendChild(overlay);

  // Add CSS for log types with solid fill backgrounds and white text
  const style = document.createElement('style');
  style.textContent = `
    #upwork-job-monitor-log-overlay .log-entry {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      border-radius: 8px;
      background: #1976d2; /* default info */
      margin-bottom: 0;
      padding: 8px 16px 8px 12px;
      position: relative;
      min-height: 32px;
      font-size: 14px;
      line-height: 1.5;
      word-break: break-word;
      color: #fff;
      font-weight: 500;
      box-shadow: 0 1px 4px rgba(25,118,210,0.07);
      border-left: none;
      animation: fadeIn 0.5s;
    }
    #upwork-job-monitor-log-overlay .log-entry.info    { background: #1976d2; color: #fff; }
    #upwork-job-monitor-log-overlay .log-entry.success { background: #388e3c; color: #fff; }
    #upwork-job-monitor-log-overlay .log-entry.warning { background: #f9a825; color: #fff; }
    #upwork-job-monitor-log-overlay .log-entry.error   { background: #d32f2f; color: #fff; font-weight: bold; }
    #upwork-job-monitor-log-overlay .log-entry .log-time {
      flex-shrink: 0;
      font-size: 12px;
      color: #e3e3e3;
      margin-right: 10px;
      margin-top: 2px;
      font-family: monospace;
      opacity: 0.8;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);

  // Add initialization message
  const initEntry = document.createElement('div');
  initEntry.className = 'log-entry info';
  const timestamp = new Date().toLocaleTimeString();
  initEntry.innerHTML = `<span class="log-time">${timestamp}</span> Overlay initialized (v1.0)`;
  overlay.appendChild(initEntry);

  // Overlay auto-hide logic
  let overlayHideTimeout = null;
  function showOverlayTemporarily() {
    overlay.style.display = 'flex';
    overlay.style.opacity = '1';
    if (overlayHideTimeout) clearTimeout(overlayHideTimeout);
    overlayHideTimeout = setTimeout(() => {
      overlay.style.opacity = '0';
    }, 5000); // 5 seconds
  }
  // When fade-out transition ends, hide overlay completely
  overlay.addEventListener('transitionend', function() {
    if (overlay.style.opacity === '0') {
      overlay.style.display = 'none';
    }
  });
  showOverlayTemporarily(); // Show on init

  // Listen for log messages from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'OVERLAY_LOG') {
      const entry = document.createElement('div');
      entry.className = `log-entry ${msg.logType || 'info'}`;
      entry.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> ${msg.message}`;
      overlay.appendChild(entry);
      // Limit to last 50 entries
      while (overlay.children.length > 50) overlay.removeChild(overlay.firstChild);
      
      showOverlayTemporarily(); // Reset timer and show overlay
      
      // Optional: send acknowledgment back
      if (sendResponse) {
        try {
          sendResponse({received: true});
        } catch (e) {
          // Ignore errors in sending response
        }
      }
    }
  });
  
  // Also log to console that overlay was initialized
  console.log('[Upwork Job Monitor] Log overlay initialized at', timestamp);
})();
