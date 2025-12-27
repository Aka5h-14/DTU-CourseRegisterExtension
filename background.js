let intervalId = null;
let intervalCount = 0;
let isRegistering = false; // Flag to prevent race conditions

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "startMonitoring") {
    if (intervalId) clearInterval(intervalId);
    const courseIds = msg.courseIds || [];
    if (courseIds.length === 0) {
      console.error("No courses to monitor.");
      return;
    }
    // Clear previous data and start fresh
    chrome.storage.local.remove(['registeredCourses', 'courseDetailsMap', 'intervalCount', 'etag'], function() {
      chrome.storage.local.set({ 
        monitoring: true, 
        intervalCount: 0, 
        etag: null,
        courseIds: courseIds,
        registeredCourses: []
      });
    });
    isRegistering = false; // Reset registration flag
    chrome.storage.local.get(['intervalTime'], function(result) {
      const intervalTime = (msg.intervalTime || result.intervalTime || 5) * 1000;
      intervalCount = 0;
      intervalId = setInterval(() => {
        chrome.storage.local.get(['monitoring', 'courseIds', 'registeredCourses'], function(res) {
          if (!res.monitoring) {
            clearInterval(intervalId);
            intervalId = null;
            console.log("Monitoring stopped by flag.");
            return;
          }
          
          const courseIds = res.courseIds || [];
          const registeredCourses = res.registeredCourses || [];
          
          // Filter out already registered courses
          const remainingCourses = courseIds.filter(id => !registeredCourses.includes(id));
          
          if (remainingCourses.length === 0) {
            // All courses registered
            clearInterval(intervalId);
            intervalId = null;
            chrome.storage.local.set({ monitoring: false, intervalCount: 0, etag: null });
            chrome.notifications.create({
              type: "basic",
              iconUrl: "icon.png",
              title: "All Courses Registered!",
              message: "All selected courses have been registered."
            });
            return;
          }
          
          // Skip if already registering (prevent race conditions)
          if (isRegistering) {
            intervalCount++;
            return;
          }
          
          // Update courseIds to only include remaining ones
          chrome.storage.local.set({ courseIds: remainingCourses });
          
          chrome.storage.local.set({ intervalCount });
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (!tabs || tabs.length === 0) {
              console.error("No active tab found.");
              return;
            }
            const tab = tabs[0];
            // Verify the tab URL matches the content script pattern
            if (!tab.url || !tab.url.match(/https:\/\/reg-exam\.dtu\.ac\.in\/student\/courseRegistration\/.+/)) {
              console.error("Active tab is not a course registration page.");
              clearInterval(intervalId);
              intervalId = null;
              chrome.storage.local.set({ monitoring: false, intervalCount: 0, etag: null });
              return;
            }
            
            // Check if content script is loaded, inject if needed
            function ensureContentScript(callback) {
              chrome.tabs.sendMessage(tab.id, { action: "ping" }, function(response) {
                if (chrome.runtime.lastError) {
                  // Content script not loaded, inject it
                  chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                  }).then(() => {
                    setTimeout(callback, 100); // Wait for script to initialize
                  }).catch(err => {
                    console.error("Failed to inject content script:", err);
                    callback();
                  });
                } else {
                  callback();
                }
              });
            }
            
            // Check all courses in parallel
            ensureContentScript(() => {
              let completedChecks = 0;
              let foundAvailable = false;
              
              remainingCourses.forEach(courseId => {
                chrome.tabs.sendMessage(
                  tab.id,
                  { action: "checkSeats", courseId: courseId },
                  function(response) {
                    completedChecks++;
                    
                    // If we already registered for another course, skip
                    if (foundAvailable || isRegistering) {
                      if (completedChecks === remainingCourses.length) {
                        intervalCount++;
                      }
                      return;
                    }
                    
                    if (response && typeof response.seats === 'number' && response.seats > 0 && response.action) {
                      // Found available seat - register immediately
                      foundAvailable = true;
                      isRegistering = true;
                      
                      chrome.tabs.sendMessage(
                        tab.id,
                        { action: "registerCourse", actionUrl: response.action },
                        function(registerResponse) {
                          isRegistering = false;
                          
                          if (chrome.runtime.lastError) {
                            console.error("Error sending registration message:", chrome.runtime.lastError.message);
                            if (completedChecks === remainingCourses.length) {
                              intervalCount++;
                            }
                            return;
                          }
                          
                          // Add to registered courses
                          chrome.storage.local.get(['registeredCourses', 'courseIds'], function(regResult) {
                            const registered = regResult.registeredCourses || [];
                            const allCourseIds = regResult.courseIds || [];
                            
                            if (!registered.includes(courseId)) {
                              registered.push(courseId);
                              chrome.storage.local.set({ registeredCourses: registered });
                            }
                            
                            // Remove from courseIds list
                            const updatedCourseIds = allCourseIds.filter(id => id !== courseId);
                            chrome.storage.local.set({ courseIds: updatedCourseIds });
                            
                            // Reset etag for next check cycle
                            chrome.storage.local.set({ etag: null });
                            
                            chrome.notifications.create({
                              type: "basic",
                              iconUrl: "icon.png",
                              title: registerResponse && registerResponse.success ? "Course Registered!" : "Registration Failed",
                              message: registerResponse && registerResponse.success 
                                ? `Course ${courseId} registered! Continuing with remaining courses...` 
                                : `Could not register for course ${courseId}.`
                            });
                          });
                          
                          if (completedChecks === remainingCourses.length) {
                            intervalCount++;
                          }
                        }
                      );
                    } else {
                      // No seats available for this course
                      if (completedChecks === remainingCourses.length) {
                        intervalCount++;
                      }
                    }
                  }
                );
              });
            });
          });
        });
      }, intervalTime);
    });
  }
  if (msg.action === "stopMonitoring") {
    chrome.storage.local.set({ monitoring: false, intervalCount: 0, etag: null });
    isRegistering = false;
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log("Monitoring stopped by user or popup close.");
    }
  }
});
