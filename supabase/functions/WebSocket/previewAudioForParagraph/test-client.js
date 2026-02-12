import WebSocket from 'ws';

// Configuration (Update these values before running)
const HOST = 'ws://localhost:8084';
const PROJECT_ID = '610e2401-a2f7-47e1-b96a-ac6dc976bd64';
const CHAPTER_ID = 'SW33iI9Whtofpt78qu8h';
const BLOCK_ID = '28LYWXv8PaCicsye4FwL';

// Retrieve valid tokens from environment or input manually
// Note: Tokens expire, so you may need to refresh them.
const ACCESS_TOKEN='eyJhbGciOiJFUzI1NiIsImtpZCI6IjFmYWY5N2IyLTM4NjQtNDQwZi1hNGE1LTQ3MmE2MzI1OTdjMCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2hza2FxdmpydXF6bWdyd3hteHhkLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI3YWQyMDFhZS1iY2M1LTRhYWUtOWQ0Yy02Y2NiZjM2MGFhMDgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzcwOTIzOTUzLCJpYXQiOjE3NzA5MjAzNTMsImVtYWlsIjoibmxhemFydXNAdGV4YXNncm93dGhmYWN0b3J5LmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJubGF6YXJ1c0B0ZXhhc2dyb3d0aGZhY3RvcnkuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiN2FkMjAxYWUtYmNjNS00YWFlLTlkNGMtNmNjYmYzNjBhYTA4In0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3NzA5MjAzNTN9XSwic2Vzc2lvbl9pZCI6IjQxOTA0MjkwLWE4MGItNGRhMC1hZjU3LThmNWMzNWZjOGM3ZiIsImlzX2Fub255bW91cyI6ZmFsc2V9.MY8A0ipS2YYnkRd6-aH3KlP25vY94PWBwnhc0k5j1Pxc_MfsQtnOga1DnT_-P6Gtq1TmPLiz_nf1Cob0CfKK4g';
const ELEVEN_LABS_API_KEY = 'sk_d545137c23e3098d622e593988bc4e2691554f05a701b0e8';

async function runTest() {
    console.log(`Connecting to ${HOST}...`);
    const ws = new WebSocket(HOST);

    ws.on('open', () => {
        console.log('Connected!');
        
        const payload = {
            project_id: PROJECT_ID,
            chapter_id: CHAPTER_ID,
            block_id: BLOCK_ID,
            access_token: ACCESS_TOKEN,
            eleven_labs_api_key: ELEVEN_LABS_API_KEY
        };

        console.log('Sending payload:', JSON.stringify(payload, null, 2));
        ws.send(JSON.stringify(payload));
    });

    ws.on('message', (data) => {
        try {
            const response = JSON.parse(data.toString());
            console.log(`Received: [${response.status}] ${response.message}`);
            
            if (response.status === 'complete') {
                console.log('Data:', JSON.stringify(response.data, null, 2));
                ws.close();
            } else if (response.status === 'error') {
                console.error('Error:', response.message);
                ws.close();
            }
        } catch (e) {
            console.error('Failed to parse message:', data.toString());
        }
    });

    ws.on('close', () => {
        console.log('Disconnected');
        process.exit(0);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        process.exit(1);
    });
}

runTest();
