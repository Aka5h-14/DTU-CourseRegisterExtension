// Helper function to send console messages to popup via background
function sendConsoleToPopup(message, type = 'log') {
  chrome.runtime.sendMessage({
    action: 'consoleLog',
    message: message,
    type: type
  }).catch(() => {
    // Background might not be listening, ignore errors
  });
}

// Override console methods to also send to popup
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

console.log = function(...args) {
  originalLog.apply(console, args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  sendConsoleToPopup(message, 'log');
};

console.error = function(...args) {
  originalError.apply(console, args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  sendConsoleToPopup(message, 'error');
};

console.warn = function(...args) {
  originalWarn.apply(console, args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  sendConsoleToPopup(message, 'warn');
};

console.info = function(...args) {
  originalInfo.apply(console, args);
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  sendConsoleToPopup(message, 'info');
};

// Capture unhandled errors
window.addEventListener('error', function(event) {
  sendConsoleToPopup(`Error: ${event.message} at ${event.filename}:${event.lineno}`, 'error');
});

window.addEventListener('unhandledrejection', function(event) {
  sendConsoleToPopup(`Unhandled Promise Rejection: ${event.reason}`, 'error');
});

async function checkAllSeats(courseIds) {
  // Get stored ETag from previous request
  const storage = await chrome.storage.local.get(['etag']);
  const storedEtag = storage.etag;
  
  // Prepare fetch options with If-None-Match header if we have a stored ETag
  const fetchOptions = { credentials: "include" };
  if (storedEtag) {
    fetchOptions.headers = {
      'If-None-Match': storedEtag
    };
  }
  
  // Fetch the latest HTML from the server (single request)
  const res = await fetch(window.location.href, fetchOptions);
  
  // If content hasn't changed (304 Not Modified), return empty result
  if (res.status === 304) {
    return { courses: [], unchanged: true };
  }
  
  // Content has changed, parse the new HTML
  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Extract and store the new ETag
  const newEtag = res.headers.get('ETag');
  if (newEtag) {
    await chrome.storage.local.set({ etag: newEtag });
  }

  // Check all courses in the fetched HTML
  const availableCourses = [];
  const rows = doc.querySelectorAll('table tbody tr');
  
  for (const row of rows) {
    const tds = row.querySelectorAll('td');
    if (tds.length === 6 && tds[5].querySelector('form')) {
      const form = tds[5].querySelector('form');
      const action = form.getAttribute('action');
      if (action) {
        const courseId = action.split('/').pop();
        // Check if this course is in our monitoring list
        if (courseIds.includes(courseId)) {
          const seats = parseInt(tds[4].textContent.trim(), 10);
          if (seats > 0) {
            availableCourses.push({
              courseId: courseId,
              seats: seats,
              action: action
            });
          }
        }
      }
    }
  }
  
  return { courses: availableCourses, unchanged: false };
}

// Keep old function for backward compatibility (not used anymore)
async function checkSeats(courseId) {
  const result = await checkAllSeats([courseId]);
  if (result.courses.length > 0) {
    const course = result.courses[0];
    return { seats: course.seats, action: course.action };
  }
  return { seats: null, action: null };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ ready: true });
    return true;
  }
  if (msg.action === 'checkAllSeats' && msg.courseIds) {
    checkAllSeats(msg.courseIds).then((result) => {
      sendResponse(result);
    }).catch(err => {
      console.error("Error checking seats:", err);
      sendResponse({ courses: [], error: err.toString() });
    });
    return true; // Keep the message channel open for async response
  }
  if (msg.action === 'checkSeats' && msg.courseId) {
    checkSeats(msg.courseId).then(({ seats, action }) => {
      sendResponse({ seats, action });
    }).catch(err => {
      console.error("Error checking seats:", err);
      sendResponse({ seats: null, action: null, error: err.toString() });
    });
    return true; // Keep the message channel open for async response
  }
  if (msg.action === 'registerCourse' && msg.actionUrl) {
    fetch(msg.actionUrl, {
      method: 'POST',
      credentials: 'include',
      redirect: 'manual'
    }).then(res => res.text())
      .then(data => {
        sendResponse({ success: true, data });
        setTimeout(() => {
          window.location.reload(); // Reload the main webpage after registration
        }, 800); // 800ms delay before reload
      })
      .catch(err => {
        console.error("Error registering course:", err);
        sendResponse({ success: false, error: err.toString() });
      });
    return true; // Keep the message channel open for async response
  }
});

// chrome.tabs.sendMessage(tabId, message, (response) => {
//   if (chrome.runtime.lastError) {
//     console.error('Message failed:', chrome.runtime.lastError.message);
//     window.location.reload(); // Reload the window if the error exists
//     return;
//   }
//   // handle response
// }); 