const fs = require('fs');
const path = require('path');

// Path to the JSON file
const logFilePath = path.join(__dirname, 'bot_interactions.json');

// Initialize the log file if it doesn't exist
if (!fs.existsSync(logFilePath)) {
    fs.writeFileSync(logFilePath, JSON.stringify({}, null, 2));
}

// Function to log interactions
async function logInteraction(phone, interaction) {
    try {
        // Read existing log data
        const logData = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));

        // Append the new interaction
        if (!logData[phone]) {
            logData[phone] = [];
        }
        logData[phone].push(interaction);

        // Write updated log data to the file
        fs.writeFileSync(logFilePath, JSON.stringify(logData, null, 2));
    } catch (error) {
        console.error("Error logging interaction:", error);
    }
}

module.exports = { logInteraction };
