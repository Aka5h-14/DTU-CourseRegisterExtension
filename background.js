let intervalId = null;
let intervalCount = 0;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "startMonitoring") {
    if (intervalId) clearInterval(intervalId);
    chrome.storage.local.set({ monitoring: true, intervalCount: 0 });
    chrome.storage.local.get(['courseId', 'intervalTime'], function(result) {
      const courseId = result.courseId;
      const intervalTime = (msg.intervalTime || result.intervalTime || 5) * 1000;
      intervalCount = 0;
      intervalId = setInterval(() => {
        chrome.storage.local.get(['monitoring'], function(res) {
          if (!res.monitoring) {
            clearInterval(intervalId);
            intervalId = null;
            console.log("Monitoring stopped by flag.");
            return;
          }
          chrome.storage.local.set({ intervalCount });
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (!tabs || tabs.length === 0) {
              console.error("No active tab found.");
              return;
            }
            chrome.tabs.sendMessage(
              tabs[0].id,
              { action: "checkSeats", courseId },
              function(response) {
                if (response && typeof response.seats === 'number') {
                  if (response.seats > 0 && response.action) {
                    // Register for the course
                    // console.log("Seats:",response.seats);
                    chrome.tabs.sendMessage(
                      tabs[0].id,
                      { action: "registerCourse", actionUrl: response.action },
                      function(registerResponse) {
                        chrome.notifications.create({
                          type: "basic",
                          iconUrl: "icon.png",
                          title: registerResponse && registerResponse.success ? "Course Registered!" : "Registration Failed",
                          message: registerResponse && registerResponse.success ? "Seat was available and registration attempted." : "Could not register for the course."
                        });
                      }
                    );
                    intervalCount++;
                    clearInterval(intervalId);
                    chrome.storage.local.set({ monitoring: false, intervalCount: 0 });
                  }
                  intervalCount++;
                }
              }
            );
          });
        });
      }, intervalTime);
    });
  }
  if (msg.action === "stopMonitoring") {
    chrome.storage.local.set({ monitoring: false, intervalCount: 0 });
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log("Monitoring stopped by user or popup close.");
    }
  }
});
