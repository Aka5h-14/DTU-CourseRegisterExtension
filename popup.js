// ...existing code...
let allOptions = []; // store fetched options globally for filtering

document.getElementById('fetchBtn').onclick = async function() {
  document.getElementById('status').textContent = "Fetching courses...";
  chrome.tabs.query({active: true, currentWindow: true}, async function(tabs) {
    const url = tabs[0].url;
    const match = url.match(/courseRegistration\/([a-f0-9]+)/);
    if (match) {
      const uniqueId = match[1];
      chrome.storage.local.set({ uniqueId });
      const courseRes = await fetch(`https://reg-exam.dtu.ac.in/student/courseRegistration/${uniqueId}`, { credentials: "include" });
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

      // save to global and render
      allOptions = options;

      const select = document.getElementById('courseSelect');

      function renderOptions(list) {
        if (!list.length) {
          select.innerHTML = `<option disabled>No matches</option>`;
          return;
        }
        select.innerHTML = list.map(o =>
          `<option value="${o.id || ''}" ${!o.available ? 'disabled' : ''}>
            ${o.code} - ${o.name}${!o.available ? ' (0 SEATS)' : ' (AVAILABLE)'}
          </option>`
        ).join('');
      }

      // initial render with all options
      renderOptions(allOptions);

      document.getElementById('coursesSection').style.display = '';
      document.getElementById('status').textContent = "Select a course and start monitoring.";
    } else {
      document.getElementById('status').textContent = "Please open the course registration page in your browser.";
    }
  });
};

document.getElementById('startBtn').onclick = function() {
  const courseId = document.getElementById('courseSelect').value;
  if (!courseId) {
    document.getElementById('status').textContent = "Please select a valid available course.";
    return;
  }
  const intervalTime = parseFloat(document.getElementById('intervalInput').value) || 5;
  chrome.storage.local.set({ courseId, monitoring: true, intervalTime, intervalCount: 0 });
  chrome.runtime.sendMessage({ action: "startMonitoring", courseId, intervalTime });
  document.getElementById('status').textContent = "Monitoring started!";
  document.getElementById('intervalCount').textContent = '0';
};

document.getElementById('stopBtn').onclick = function() {
  chrome.storage.local.set({ monitoring: false });
  chrome.runtime.sendMessage({ action: "stopMonitoring" });
  document.getElementById('status').textContent = "Monitoring stopped.";
};

// Listen for intervalCount changes and update the UI
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'local' && changes.intervalCount) {
    document.getElementById('intervalCount').textContent = changes.intervalCount.newValue;
  }
});

// add search/filter functionality
document.getElementById('searchInput').addEventListener('input', function(e) {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q ? allOptions.filter(o => o.code.toLowerCase().includes(q)) : allOptions;
  const select = document.getElementById('courseSelect');
  if (!filtered.length) {
    select.innerHTML = `<option disabled>No matches</option>`;
    return;
  }
  select.innerHTML = filtered.map(o =>
    `<option value="${o.id || ''}" ${!o.available ? 'disabled' : ''}>
      ${o.code} - ${o.name}${!o.available ? ' (0 SEATS)' : ' (AVAILABLE)'}
    </option>`
  ).join('');
});

window.addEventListener('unload', function() {
  chrome.storage.local.set({ monitoring: false });
  chrome.runtime.sendMessage({ action: "stopMonitoring" });
});