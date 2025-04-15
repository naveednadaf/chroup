# Product Requirements Document: Upwork Job Feed Monitor & Notifier

**Version:** 1.2
**Date:** 2025-04-13

**1. Introduction**

This document outlines the requirements for a tool designed to monitor a user's Upwork job feed for new postings, even when the Upwork browser tab is not active. The tool will automatically refresh the job feed at randomized intervals, detect new jobs (regardless of their position on the page), and send the details of these new jobs to a user-defined API endpoint (such as a webhook URL or a custom API). It includes features for scheduling active monitoring times and aims to operate discreetly to minimize the chances of detection by Upwork. This tool is specifically targeted at Upwork job search result pages (`/nx/search/jobs/` or similar).

**2. Goals**

* **Timely Job Notifications:** Provide users with near real-time notifications for new jobs matching their Upwork search feed criteria.
* **Automation:** Eliminate the need for manual, constant refreshing of the Upwork job feed page.
* **Background Operation:** Allow monitoring to continue even when the user is working in other browser tabs or applications.
* **Stealth:** Operate in a manner that mimics human Browse patterns to avoid detection and potential account issues with Upwork.
* **User Control:** Provide users with control over the tool's active hours and notification endpoint.

**3. Functional Requirements**

* **FR1: Background Monitoring**
    * The tool must be able to monitor a specific Upwork job feed URL (e.g., search results page) even when the browser tab containing that URL is not the currently active tab or window.
    * It should ideally function as a browser extension or a background process capable of interacting with a browser instance.

* **FR2: Automated Refresh**
    * The tool shall automatically refresh the designated Upwork job feed page.
    * The refresh interval must be randomized, occurring every 4 to 7 minutes.

* **FR3: Scheduled Operation**
    * The tool shall have a default "inactive" period between 1:00 PM IST and 11:00 PM IST.
    * During the inactive period, the automatic refresh and notification functions will be paused.
    * The tool must be manually activatable/deactivatable by the user at any time, overriding the schedule.

* **FR4: Schedule Configuration UI**
    * A user interface (UI) must be provided to allow the user to:
        * View the current active/inactive schedule.
        * Modify the start and end times of the inactive period.
        * Specify the time zone for the schedule (defaulting to IST but changeable).
        * Save the new schedule settings.

* **FR5: New Job Detection**
    * After each refresh, the tool must parse the job listings on the page using the specific selectors defined in Section 7.
    * It must compare the current list of jobs (identified by their UIDs) with the list from the previous successful refresh.
    * It must identify any job postings present in the current list but *not* in the previous list. The `data-ev-job-uid` attribute on the main `<article>` tag serves as the unique identifier.
    * The tool must correctly identify new jobs even if they appear mid-list, not just at the very top.

* **FR6: API Notification**
    * When one or more new jobs are detected, the tool shall send the details of *each* new job to a user-configured API endpoint.
    * The payload sent to the API should contain comprehensive details of the job posting, extracted from the job tile's HTML using the selectors in Section 7 (e.g., Job Title, Link, UID, Description Snippet, Budget/Price, Experience Level, Skills, Client Info like Payment Status/Rating/Spend/Location, Proposal Count).
    * The payload format should ideally be JSON.

* **FR7: API Configuration UI**
    * The UI must provide a field for the user to input and save the target API endpoint URL for notifications.

* **FR8: Stealth Measures**
    * Implement randomized refresh intervals (as per FR2).
    * Ensure browser requests initiated by the tool mimic standard browser requests (e.g., include appropriate headers).
    * Avoid overly aggressive refresh rates or predictable patterns.
    * *Potentially:* Introduce minor, random delays *before* initiating a refresh.
    * *Potentially:* Vary browser User-Agent slightly if possible without breaking Upwork compatibility (use with caution).
    * The primary goal is to make the tool's activity statistically indistinguishable from an active human user Browse the site intermittently.

**4. Non-Functional Requirements**

* **NFR1: Performance:** The tool should consume minimal system resources (CPU, memory) to avoid impacting user workflow.
* **NFR2: Reliability:** The tool should run stably in the background. It should handle potential network errors or changes in Upwork page structure gracefully (e.g., log errors, potentially pause operation if the page structure changes significantly).
* **NFR3: Usability:** The configuration UI should be simple, intuitive, and easy to use. Status indication (e.g., Running, Stopped, Inactive-Scheduled) should be clear.
* **NFR4: Maintainability:** The code should be written clearly and structured logically, especially the HTML parsing component, anticipating that Upwork's site structure may change (See Section 7).
* **NFR5: Security/Privacy:** The tool should only interact with the specified Upwork page and the user-defined API endpoint. It should not capture or transmit unrelated user data. API credentials (if needed) should be handled securely.

**5. User Interface (UI) / User Experience (UX)**

* A simple control panel (e.g., browser extension popup) with:
    * Start/Stop button (Manual Override).
    * Status Indicator (e.g., "Active", "Inactive - Schedule", "Stopped", "Error").
    * Link or section for Settings.
* Settings Page/View:
    * API Endpoint URL input field.
    * Schedule section:
        * Inactive Start Time input.
        * Inactive End Time input.
        * Timezone selection dropdown.
        * Save Schedule button.
    * Display of last detected new job timestamp (optional).
    * Log/Error message display area (optional).

**6. API Integration Details**

* **Endpoint:** User-provided HTTP/S URL. This can be a webhook URL (e.g., for Zapier, Make.com, Slack, Discord) or a custom API endpoint.
* **Method:** POST
* **Tooling:** Standard HTTP client libraries should be used (e.g., `Workspace` API in JavaScript for browser extensions, `requests` library in Python for standalone scripts).
* **Payload:** JSON object containing details for *one* new job per request, or an array of job objects if multiple are found simultaneously. Example structure for a single job:
    ```json
    {
      "jobUid": "1911602700244483752",
      "title": "IPv6 Minecraft Server Configuration Expert Needed",
      "url": "[https://www.upwork.com/jobs/IPv6-Minecraft-Server-Configuration-Expert-Needed_~021911602700244483752/?referrer_url_path=/nx/search/jobs/](https://www.upwork.com/jobs/IPv6-Minecraft-Server-Configuration-Expert-Needed_~021911602700244483752/?referrer_url_path=/nx/search/jobs/)", // Absolute URL preferred
      "postedTimeAgo": "1 hour ago",
      "descriptionSnippet": "I am looking for an expert to help configure an IPv6 Minecraft server...",
      "jobType": "Fixed price",
      "experienceLevel": "Intermediate",
      "budget": "$20.00", // Or hourly rate details
      "skills": ["Linux System Administration", "Network Administration", "System Administration", "Java", "Linux"],
      "clientInfo": {
        "paymentVerified": false, // Based on "Payment unverified"
        "rating": 0.0,
        "feedbackCount": 0, // Inferred from "No feedback yet" or rating tooltip
        "totalSpent": "$0",
        "location": "Romania"
      },
      "proposals": "Less than 5",
      "timestampDetected": "2025-04-13T23:15:00Z" // ISO 8601 format UTC
    }
    ```
* **Authentication:** Assume no authentication initially, but consider adding support for basic auth or custom headers if the user's API requires it (configurable via UI).

**7. Technical Considerations & Implementation Notes**

* **Platform:** Likely a browser extension (Chrome, Firefox) for easier access to background tabs and DOM manipulation.
* **HTML Parsing & Selectors:** The tool's reliability is **highly dependent** on the stability of Upwork's HTML structure and the following selectors (derived from the provided HTML snippet). **These are hardcoded assumptions and WILL break if Upwork updates its website structure.** Robust error handling around parsing is essential.
    * **Job Container Selector:** `article.job-tile[data-test='JobTile']`
    * **Job UID Attribute:** `data-ev-job-uid` (on the job container)
    * **Title Selector:** `h2.job-tile-title a` (get text content)
    * **URL Selector:** `h2.job-tile-title a` (get `href` attribute, prepend `https://www.upwork.com` if relative)
    * **Posted Time Selector:** `small[data-test='job-pubilshed-date'] span:last-child` (get text content)
    * **Description Selector:** `div[data-test='UpCLineClamp JobDescription'] p` (get text content)
    * **Job Type Selector:** `ul[data-test='JobInfo'] li[data-test='job-type-label'] strong` (get text content)
    * **Experience Level Selector:** `ul[data-test='JobInfo'] li[data-test='experience-level'] strong` (get text content)
    * **Budget/Rate Selector:** `ul[data-test='JobInfo'] li[data-test='is-fixed-price'] strong:last-child` (get text content; may need adjustment for hourly jobs)
    * **Skills Selector:** `div[data-test='TokenClamp JobAttrs'] button[data-test='token'] span` (get text content of all matching elements)
    * **Payment Verified Selector:** `ul[data-test='JobInfoClient'] li[data-test='payment-verified']` (check inner text for "verified" / "unverified")
    * **Client Rating Selector:** `li[data-test='total-feedback'] div.air3-rating-value-text` (get text content, convert to float)
    * **Client Spent Selector:** `li[data-test='total-spent'] strong` (get text content)
    * **Client Location Selector:** `li[data-test='location'] div.air3-badge-tagline` (get text content, trim whitespace/icon text)
    * **Proposals Selector:** `li[data-test='proposals-tier'] strong` (get text content)
    * *(Note: Client feedback count might require parsing the rating tooltip text, which can be complex due to dynamic elements/potential invisibility. An alternative is inferring from the rating value.)*
* **State Management:** The tool needs to persistently store the list of job UIDs from the last successful check to compare against the next refresh. Browser extension storage (`chrome.storage` or `browser.storage`) is recommended.
* **Error Handling:** Implement retries for failed network requests (to Upwork or the notification API). Log errors clearly for troubleshooting. If parsing fails repeatedly (e.g., selectors don't find elements), indicate an error state and pause operation, notifying the user that Upwork's structure may have changed.

**8. Assumptions**

* The user is logged into Upwork in the browser instance being monitored.
* The user will provide a valid, working URL for the Upwork job feed they want to monitor (typically a search results page).
* The user will provide a valid, working API endpoint (webhook or custom API) capable of receiving POST requests with a JSON payload.
* The Upwork job search results page structure remains consistent with the selectors defined in Section 7.

**9. Development Phases (Example Breakdown)**

* **Phase 1: Core Monitoring & Parsing**
    * Set up basic browser extension structure.
    * Implement logic to load/refresh the target Upwork URL.
    * Develop the HTML parsing logic using the **specific selectors from Section 7** to reliably extract job UIDs and details.
    * Implement state management (`browser.storage`) to store/retrieve the list of seen job UIDs.
    * Implement the core comparison logic to detect new jobs.
    * *Goal:* Reliably detect new job UIDs appearing on refresh and log extracted details to the console. Add robust error handling if selectors fail.

* **Phase 2: API Notification**
    * Implement the function to format the extracted job details into the specified JSON payload (Section 6).
    * Integrate `Workspace` API to send POST requests.
    * Add basic UI element (popup/options page) to input the API endpoint URL.
    * Implement logic to send notifications for detected new jobs.
    * Basic error handling for API requests (log failures).
    * *Goal:* Successfully send new job details (using parsed data) to a test endpoint (e.g., webhook.site).

* **Phase 3: Scheduling & UI**
    * Implement the randomized refresh timer (4-7 minutes) using browser alarms/timers.
    * Implement the default IST schedule logic (active/inactive periods).
    * Develop the UI for configuring the schedule (start/end time, timezone).
    * Develop the UI for manual Start/Stop override.
    * Add status indicators to the UI.
    * Refine error handling and logging display in UI.
    * *Goal:* Tool operates on a schedule, refreshes randomly, notifies, and allows user configuration via UI.

* **Phase 4: Stealth & Refinement**
    * Review and implement stealth measures (random delays before refresh). Ensure standard headers are sent.
    * Thorough testing for reliability, resource usage, and parsing accuracy across different job types (fixed/hourly).
    * Improve robustness of HTML parsing against minor variations (if possible without making selectors too fragile).
    * Add documentation (user guide, setup instructions, **clear warning about ToS violation risk and parser fragility**).
    * *Goal:* Stable, usable tool incorporating stealth techniques and robust error handling.

**10. Open Questions**

* How should the tool handle Upwork login sessions expiring? (Recommendation: Detect logged-out state, stop monitoring, and notify user via UI).
* How to handle variations in job types (hourly vs. fixed) in selectors (e.g., budget/rate)? (Needs testing and potentially conditional logic in parser).
* Does the user's target API require specific authentication methods? (Consider adding UI options for Auth Header/Basic Auth in Phase 2 or 3).

**11. Future Considerations**

* Monitoring multiple distinct Upwork feeds simultaneously.
* Adding basic filtering options within the tool itself (e.g., only notify if budget > X).
* More sophisticated stealth techniques (though these increase complexity and risk).
* UI indication of *which* job(s) were newly detected on the Upwork page itself (e.g., highlighting).

**Disclaimer:** Automating interactions with websites like Upwork may violate their Terms of Service. This tool relies on specific HTML structures (selectors listed in Section 7) that **will likely change without notice**, breaking the tool's functionality. While this tool aims for discretion, Upwork employs bot detection mechanisms, and using such a tool carries the inherent risk of account warnings or suspension. The user assumes all responsibility for using this tool in compliance with Upwork's policies and for maintaining it when Upwork updates its website.