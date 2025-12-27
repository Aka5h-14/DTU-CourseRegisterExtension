async function checkSeats(courseId) {
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
  
  // Fetch the latest HTML from the server
  const res = await fetch(window.location.href, fetchOptions);
  
  // If content hasn't changed (304 Not Modified), return cached result
  if (res.status === 304) {
    // Content unchanged, no need to parse
    return { seats: null, action: null, unchanged: true };
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

  const rows = doc.querySelectorAll('table tbody tr');
  for (const row of rows) {
    const tds = row.querySelectorAll('td');
    if (tds.length === 6 && tds[5].querySelector('form')) {
      const form = tds[5].querySelector('form');
      const action = form.getAttribute('action');
      if (action && action.endsWith(`/${courseId}`)) {
        const seats = parseInt(tds[4].textContent.trim(), 10);
        return { seats, action };
      }
    }
  }
  return { seats: null, action: null };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'ping') {
    sendResponse({ ready: true });
    return true;
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
        window.location.reload(); // Reload the main webpage after registration
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