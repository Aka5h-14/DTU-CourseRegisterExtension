document.getElementById('fetchBtn').onclick = async function() {
  document.getElementById('status').textContent = "Fetching courses...";
  chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
    const url = tabs[0].url;
    const match = url.match(/courseRegistration\/([a-f0-9]+)/);
    if (match) {
      const uniqueId = match[1];
      chrome.storage.local.set({ uniqueId });
      const courseRes = await fetch(`https://reg.exam.dtu.ac.in/student/courseRegistration/${uniqueId}`, { credentials: "include" });
      const html = await courseRes.text();
      // Parse courses
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const options = [];
      const electiveTable = Array.from(doc.querySelectorAll("h4"))
        .find(h4 => h4.textContent.includes("Elective Courses"))
        ?.nextElementSibling;
      if (electiveTable) {
        electiveTable.querySelectorAll("tbody tr").forEach(row => {
          const tds = row.querySelectorAll("td");
          if (tds.length === 6 && tds[1].textContent.trim()) {
            const form = tds[5].querySelector("form");
            const action = form ? form.getAttribute("action") : null;
            options.push({
              code: tds[1].textContent.trim(),
              name: tds[0].textContent.trim(),
              id: action ? action.split("/").pop() : null,
              available: !!action // true if form/action exists, false otherwise
            });
          }
        });
      }
      const select = document.getElementById('courseSelect');
      select.innerHTML = options.map(o =>
        `<option value="${o.id || ''}" ${!o.available ? 'disabled' : ''}>
          ${o.code} - ${o.name}${!o.available ? ' (Unavailable)' : ''}
        </option>`
      ).join('');
      document.getElementById('coursesSection').style.display = '';
      document.getElementById('status').textContent = "Select a course and start monitoring.";
    } else {
      document.getElementById('status').textContent = "Please open the course registration page in your browser.";
    }
  });
};

document.getElementById('startBtn').onclick = function() {
  const courseId = document.getElementById('courseSelect').value;
  chrome.storage.local.set({ courseId, monitoring: true });
  chrome.runtime.sendMessage({ action: "startMonitoring", courseId });
  document.getElementById('status').textContent = "Monitoring started!";
};

document.getElementById('stopBtn').onclick = function() {
  chrome.storage.local.set({ monitoring: false });
  chrome.runtime.sendMessage({ action: "stopMonitoring" });
  document.getElementById('status').textContent = "Monitoring stopped.";
};

window.addEventListener('unload', function() {
  chrome.storage.local.set({ monitoring: false });
  chrome.runtime.sendMessage({ action: "stopMonitoring" });
});
