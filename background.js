let intervalId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "startMonitoring") {
    if (intervalId) clearInterval(intervalId);
    chrome.storage.local.set({ monitoring: true });
    chrome.storage.local.get(['courseId'], function(result) {
      const courseId = result.courseId;
      intervalId = setInterval(() => {
        chrome.storage.local.get(['monitoring'], function(res) {
          if (!res.monitoring) {
            clearInterval(intervalId);
            intervalId = null;
            console.log("Monitoring stopped by flag.");
            return;
          }
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
                    console.log("Seats:",response.seats);
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
                        clearInterval(intervalId);
                      }
                    );
                  }
                }
              }
            );
          });
        });
      }, 5000);
    });
  }
  if (msg.action === "stopMonitoring") {
    chrome.storage.local.set({ monitoring: false });
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      console.log("Monitoring stopped by user or popup close.");
    }
  }
});
