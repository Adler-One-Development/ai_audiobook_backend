import WebSocket from 'ws';

// Configuration (Update these values before running)
const HOST = 'ws://localhost:8084';
const PROJECT_ID = '';
const CHAPTER_ID = '';
const BLOCK_ID = '';

// Retrieve valid tokens from environment or input manually
// Note: Tokens expire, so you may need to refresh them.
const ACCESS_TOKEN='';
const ELEVEN_LABS_API_KEY = '';

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
