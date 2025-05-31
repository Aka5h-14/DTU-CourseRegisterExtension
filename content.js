async function checkSeats(courseId) {
  // Fetch the latest HTML from the server
  const res = await fetch(window.location.href, { credentials: "include" });
  const html = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

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
  if (msg.action === 'checkSeats' && msg.courseId) {
    checkSeats(msg.courseId).then(({ seats, action }) => {
      sendResponse({ seats, action });
    });
    return true; // Keep the message channel open for async response
  }
  if (msg.action === 'registerCourse' && msg.actionUrl) {
    fetch(msg.actionUrl, {
      method: 'POST',
      credentials: 'include'
    }).then(res => res.text())
      .then(data => sendResponse({ success: true, data }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    return true; // Keep the message channel open for async response
  }
}); 