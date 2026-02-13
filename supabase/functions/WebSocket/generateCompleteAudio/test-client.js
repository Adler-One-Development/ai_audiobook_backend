import WebSocket from 'ws';

// Configuration (Update these values before running)
const HOST = 'ws://localhost:8085';
const PROJECT_ID = ''; // Enter your project ID
const ACCESS_TOKEN = ''; // Enter your Supabase Access Token
const ELEVEN_LABS_API_KEY = ''; // Enter your ElevenLabs API Key

if (!PROJECT_ID || !ACCESS_TOKEN || !ELEVEN_LABS_API_KEY) {
    console.error('Please update the configuration constants in test-client.js before running.');
    // process.exit(1); // Commented out to allow running and failing gracefully if empty
}

const ws = new WebSocket(HOST);

ws.on('open', function open() {
    console.log('Connected to WebSocket server');

    const payload = {
        project_id: PROJECT_ID,
        access_token: ACCESS_TOKEN,
        eleven_labs_api_key: ELEVEN_LABS_API_KEY
    };

    console.log('Sending payload:', payload);
    ws.send(JSON.stringify(payload));
});

ws.on('message', function message(data) {
    const response = JSON.parse(data.toString());
    console.log('Received:', JSON.stringify(response, null, 2));

    if (response.status === 'complete' || response.status === 'error') {
        ws.close();
    }
});

ws.on('close', () => {
    console.log('Disconnected');
});

ws.on('error', (error) => {
    console.error('WebSocket error:', error);
});
