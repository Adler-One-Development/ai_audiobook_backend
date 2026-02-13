import WebSocket from 'ws';

// Configuration
const HOST = 'ws://localhost:8083';
const PROJECT_ID = '610e2401-a2f7-47e1-b96a-ac6dc976bd64';
const CHAPTER_ID = 'SW33iI9Whtofpt78qu8h';
const ACCESS_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjFmYWY5N2IyLTM4NjQtNDQwZi1hNGE1LTQ3MmE2MzI1OTdjMCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2hza2FxdmpydXF6bWdyd3hteHhkLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI3YWQyMDFhZS1iY2M1LTRhYWUtOWQ0Yy02Y2NiZjM2MGFhMDgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzcwOTk0Nzc0LCJpYXQiOjE3NzA5OTExNzQsImVtYWlsIjoibmxhemFydXNAdGV4YXNncm93dGhmYWN0b3J5LmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJubGF6YXJ1c0B0ZXhhc2dyb3d0aGZhY3RvcnkuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiN2FkMjAxYWUtYmNjNS00YWFlLTlkNGMtNmNjYmYzNjBhYTA4In0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3NzA5OTExNzR9XSwic2Vzc2lvbl9pZCI6ImRkNWE5ZjgzLWY2MTctNGM3My1iYzA5LTg0OWMyM2JhMjllZiIsImlzX2Fub255bW91cyI6ZmFsc2V9.wm7KU4Z_pEcprvz5oCBxO_AWMTjH396d6IYPvfei2MHJ9NWlTHib9cAggV4wdzHkLBbT14edw870XYppiefJ-Q'; // User's JWT
const ELEVEN_LABS_API_KEY = 'sk_d545137c23e3098d622e593988bc4e2691554f05a701b0e8';

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
