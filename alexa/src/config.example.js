/**
 * Alexa Skill Configuration Template for Alexa-Hosted skills.
 * In Alexa-Hosted skills, environment variables can be loaded from config.js.
 */

const CONFIG = {
  // Cloudflare Worker backend API endpoint
  BACKEND_URL: 'https://phone-reader-api.akahiak4826bob.workers.dev',

  // Secret API token matching Cloudflare and Android app
  API_TOKEN: 'YOUR_SECRET_TOKEN',

  // Device ID UUID from Android app
  DEVICE_ID: '6485c3bd-152e-4b04-a78c-c0de96be3837',

  // Set 'true' to announce app names only without reading notification message bodies
  PRIVACY_MODE: 'false'
};

// Populate process.env so existing handlers find them transparently
for (const [key, val] of Object.entries(CONFIG)) {
  if (!process.env[key]) {
    process.env[key] = val;
  }
}

module.exports = CONFIG;
