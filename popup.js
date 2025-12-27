let allOptions = []; // store fetched options globally for filtering

// Console logging system
const consoleOutput = document.getElementById('consoleOutput');
const maxConsoleLines = 100; // Limit console output to prevent memory issues

function addConsoleLog(message, type = 'log') {
  const timestamp = new Date().toLocaleTimeString();
  const logEntry = document.createElement('div');
  logEntry.className = `console-${type}`;
  logEntry.textContent = `[${timestamp}] ${message}`;
  consoleOutput.appendChild(logEntry);
  
  // Keep only last maxConsoleLines entries
  while (consoleOutput.children.length > maxConsoleLines) {
    consoleOutput.removeChild(consoleOutput.firstChild);
  }
  
  // Auto-scroll to bottom
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

// Override console methods in popup context
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
const originalInfo = console.info;

console.log = function(...args) {
  originalLog.apply(console, args);
  addConsoleLog(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '), 'log');
};

console.error = function(...args) {
  originalError.apply(console, args);
  addConsoleLog(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '), 'error');
};

console.warn = function(...args) {
  originalWarn.apply(console, args);
  addConsoleLog(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '), 'warn');
};

console.info = function(...args) {
  originalInfo.apply(console, args);
  addConsoleLog(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '), 'info');
};

// Listen for console messages from background and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'consoleLog') {
    addConsoleLog(msg.message, msg.type || 'log');
  }
});

// Clear console button
document.getElementById('clearConsoleBtn').onclick = function() {
  consoleOutput.innerHTML = '';
};

// Capture global errors
window.addEventListener('error', function(event) {
  addConsoleLog(`Error: ${event.message} at ${event.filename}:${event.lineno}`, 'error');
});

window.addEventListener('unhandledrejection', function(event) {
  addConsoleLog(`Unhandled Promise Rejection: ${event.reason}`, 'error');
});

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
              slot: tds[3].textContent.trim(),
              id: action ? action.split("/").pop() : null,
              available: !!action // true if form/action exists, false otherwise
            });
          }
        });
      }

      // save to global and render
      allOptions = options;
      renderCourseList(allOptions);

      // Preserve course details for already registered courses
      chrome.storage.local.get(['registeredCourses', 'courseDetailsMap'], function(storageResult) {
        const registered = storageResult.registeredCourses || [];
        const existingDetailsMap = storageResult.courseDetailsMap || {};
        const updatedDetailsMap = { ...existingDetailsMap };
        
        // Update course details for registered courses if they're in the new options
        registered.forEach(courseId => {
          const course = options.find(o => o.id === courseId);
          if (course && !updatedDetailsMap[courseId]) {
            updatedDetailsMap[courseId] = {
              code: course.code,
              name: course.name,
              slot: course.slot,
              id: course.id
            };
          }
        });
        
        if (Object.keys(updatedDetailsMap).length > 0) {
          chrome.storage.local.set({ courseDetailsMap: updatedDetailsMap });
        }
      });

      document.getElementById('coursesSection').style.display = '';
      document.getElementById('status').textContent = "Select courses and start monitoring.";
      
      // Update registered courses display
      updateRegisteredCourses();
    } else {
      document.getElementById('status').textContent = "Please open the course registration page in your browser.";
    }
  });
};

function renderCourseList(list) {
  const courseList = document.getElementById('courseList');
  if (!list.length) {
    courseList.innerHTML = `<div>No courses found</div>`;
    return;
  }
  courseList.innerHTML = list.map(o => {
    const checkboxId = `course-${o.id}`;
    return `
      <div class="course-item">
        <label>
          <input type="checkbox" id="${checkboxId}" value="${o.id || ''}" ${!o.available ? 'disabled' : ''}>
          <span>${o.code} - ${o.name} - ${o.slot}</span>
        </label>
      </div>
    `;
  }).join('');
}

document.getElementById('startBtn').onclick = function() {
  const checkboxes = document.querySelectorAll('#courseList input[type="checkbox"]:checked:not(:disabled)');
  const courseIds = Array.from(checkboxes).map(cb => cb.value).filter(id => id);
  
  if (courseIds.length === 0) {
    document.getElementById('status').textContent = "Please select at least one available course.";
    return;
  }
  
  // Clear all previous data to start fresh
  chrome.storage.local.remove(['registeredCourses', 'courseDetailsMap', 'courseIds', 'intervalCount', 'etag'], function() {
    // Store course details mapping for later reference
    const courseDetailsMap = {};
    courseIds.forEach(courseId => {
      const course = allOptions.find(o => o.id === courseId);
      if (course) {
        courseDetailsMap[courseId] = {
          code: course.code,
          name: course.name,
          slot: course.slot,
          id: course.id
        };
      }
    });
    
    const intervalTime = parseFloat(document.getElementById('intervalInput').value) || 5;
    chrome.storage.local.set({ 
      courseIds: courseIds, 
      monitoring: true, 
      intervalTime, 
      intervalCount: 0,
      registeredCourses: [], // Track registered courses
      courseDetailsMap: courseDetailsMap // Store course details for display
    });
    chrome.runtime.sendMessage({ action: "startMonitoring", courseIds, intervalTime });
    document.getElementById('status').textContent = `Monitoring ${courseIds.length} course(s)!`;
    document.getElementById('intervalCount').textContent = '0';
    updateMonitoringStatus();
    updateRegisteredCourses();
  });
};

document.getElementById('stopBtn').onclick = function() {
  chrome.storage.local.set({ monitoring: false });
  chrome.runtime.sendMessage({ action: "stopMonitoring" });
  document.getElementById('status').textContent = "Monitoring stopped.";
};

// Listen for storage changes and update the UI
chrome.storage.onChanged.addListener(function(changes, area) {
  if (area === 'local') {
    if (changes.intervalCount) {
      document.getElementById('intervalCount').textContent = changes.intervalCount.newValue;
    }
    if (changes.registeredCourses || changes.courseIds) {
      updateMonitoringStatus();
      updateRegisteredCourses();
    }
  }
});

// Clear previous data when popup opens if not actively monitoring
chrome.storage.local.get(['monitoring'], function(result) {
  if (!result.monitoring) {
    // Not monitoring, clear all previous data for fresh start
    chrome.storage.local.remove(['registeredCourses', 'courseDetailsMap', 'courseIds', 'intervalCount', 'etag'], function() {
      document.getElementById('registeredSection').style.display = 'none';
    });
  } else {
    // Actively monitoring, show current status
    updateMonitoringStatus();
    updateRegisteredCourses();
  }
});

// Select All / Deselect All buttons
document.getElementById('selectAllBtn').onclick = function() {
  document.querySelectorAll('#courseList input[type="checkbox"]:not(:disabled)').forEach(cb => cb.checked = true);
};

document.getElementById('deselectAllBtn').onclick = function() {
  document.querySelectorAll('#courseList input[type="checkbox"]').forEach(cb => cb.checked = false);
};

// add search/filter functionality
document.getElementById('searchInput').addEventListener('input', function(e) {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q ? allOptions.filter(o => o.code.toLowerCase().includes(q)) : allOptions;
  renderCourseList(filtered);
});

function updateMonitoringStatus() {
  chrome.storage.local.get(['courseIds', 'registeredCourses'], function(result) {
    const statusDiv = document.getElementById('monitoringStatus');
    if (!result.courseIds || result.courseIds.length === 0) {
      statusDiv.innerHTML = '';
      return;
    }
    
    let html = '<strong>Monitoring Status:</strong><br>';
    const registered = result.registeredCourses || [];
    
    result.courseIds.forEach(courseId => {
      const course = allOptions.find(o => o.id === courseId);
      if (course) {
        if (registered.includes(courseId)) {
          html += `<span class="registered-course"> ${course.code} - Registered</span><br>`;
        } else {
          html += `<span class="monitoring-course"> ${course.code} - Checking...</span><br>`;
        }
      }
    });
    
    statusDiv.innerHTML = html;
  });
}

function updateRegisteredCourses() {
  chrome.storage.local.get(['registeredCourses', 'courseDetailsMap'], function(result) {
    const registeredSection = document.getElementById('registeredSection');
    const registeredList = document.getElementById('registeredCoursesList');
    const registered = result.registeredCourses || [];
    const courseDetailsMap = result.courseDetailsMap || {};
    
    if (registered.length === 0) {
      registeredSection.style.display = 'none';
      return;
    }
    
    registeredSection.style.display = 'block';
    
    let html = '';
    registered.forEach(courseId => {
      const courseDetails = courseDetailsMap[courseId];
      if (courseDetails) {
        html += `
          <div class="registered-course-item">
            <span>${courseDetails.code} - ${courseDetails.name} - ${courseDetails.slot}</span>
          </div>
        `;
      } else {
        // Fallback if course details not found
        html += `
          <div class="registered-course-item">
            <span>✓ Course ID: ${courseId}</span>
          </div>
        `;
      }
    });
    
    registeredList.innerHTML = html;
  });
}

window.addEventListener('unload', function() {
  chrome.storage.local.set({ monitoring: false });
  chrome.runtime.sendMessage({ action: "stopMonitoring" });
});