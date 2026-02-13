import WebSocket from 'ws';

// Configuration
const HOST = 'ws://localhost:8083';
const PROJECT_ID = '';
const CHAPTER_ID = '';
const ACCESS_TOKEN = ''; // User's JWT
const ELEVEN_LABS_API_KEY = '';

if (PROJECT_ID === 'YOUR_PROJECT_ID') {
    console.error('Please update the configuration constants in test-client.js before running.');
    process.exit(1);
}

const ws = new WebSocket(HOST);

ws.on('open', function open() {
    console.log('Connected to WebSocket server');

    const payload = {
        project_id: PROJECT_ID,
        chapter_id: CHAPTER_ID,
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
