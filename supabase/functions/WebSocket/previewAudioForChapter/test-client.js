import WebSocket from 'ws';

// Configuration (Update these values before running)
const HOST = 'ws://localhost:8083';
const PROJECT_ID = ''; // Enter your project ID
const CHAPTER_ID = ''; // Enter your chapter ID

// Login Credentials
const LOGIN_URL = 'https://hskaqvjruqzmgrwxmxxd.supabase.co/functions/v1/login';
const EMAIL = 'nlazarus@texasgrowthfactory.com';
const PASSWORD = 'abcDEF@1234';

const ELEVEN_LABS_API_KEY = ''; // Enter your ElevenLabs API Key

if (!PROJECT_ID || !CHAPTER_ID || !ELEVEN_LABS_API_KEY) {
    console.error('Please update the configuration constants in test-client.js before running.');
    // process.exit(1);
}

async function getAccessToken() {
    console.log(`Logging in as ${EMAIL}...`);
    try {
        const response = await fetch(LOGIN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: EMAIL, password: PASSWORD })
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Login failed: ${response.status} ${response.statusText} - ${text}`);
        }

        const data = await response.json();
        // Check for token in data.token (as verified in login function)
        if (data.token) {
             console.log("Login successful. Token received.");
             return data.token;
        } else {
             throw new Error("Login successful but no token found in response.");
        }
    } catch (error) {
        console.error('Login error:', error);
        process.exit(1);
    }
}

async function runTest() {
    const accessToken = await getAccessToken();

    console.log(`Connecting to ${HOST}...`);
    const ws = new WebSocket(HOST);

    ws.on('open', () => {
        console.log('Connected!');
        
        const payload = {
            project_id: PROJECT_ID,
            chapter_id: CHAPTER_ID,
            access_token: accessToken,
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
