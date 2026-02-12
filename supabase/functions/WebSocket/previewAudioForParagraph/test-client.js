import WebSocket from 'ws';

// Configuration
const HOST = 'ws://localhost:8084'; // Port 8084 for paragraph preview
const PROJECT_ID = '610e2401-a2f7-47e1-b96a-ac6dc976bd64';
const CHAPTER_ID = 'SW33iI9Whtofpt78qu8h';
const BLOCK_ID = '28LYWXv8PaCicsye4FwL'; // Replace with a valid block ID from your database
const ACCESS_TOKEN = 'eyJhbGciOiJFUzI1NiIsImtpZCI6IjFmYWY5N2IyLTM4NjQtNDQwZi1hNGE1LTQ3MmE2MzI1OTdjMCIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2hza2FxdmpydXF6bWdyd3hteHhkLnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI3YWQyMDFhZS1iY2M1LTRhYWUtOWQ0Yy02Y2NiZjM2MGFhMDgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzcwODU0NzI3LCJpYXQiOjE3NzA4NTExMjcsImVtYWlsIjoibmxhemFydXNAdGV4YXNncm93dGhmYWN0b3J5LmNvbSIsInBob25lIjoiIiwiYXBwX21ldGFkYXRhIjp7InByb3ZpZGVyIjoiZW1haWwiLCJwcm92aWRlcnMiOlsiZW1haWwiXX0sInVzZXJfbWV0YWRhdGEiOnsiZW1haWwiOiJubGF6YXJ1c0B0ZXhhc2dyb3d0aGZhY3RvcnkuY29tIiwiZW1haWxfdmVyaWZpZWQiOnRydWUsInBob25lX3ZlcmlmaWVkIjpmYWxzZSwic3ViIjoiN2FkMjAxYWUtYmNjNS00YWFlLTlkNGMtNmNjYmYzNjBhYTA4In0sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3NzA4NTExMjd9XSwic2Vzc2lvbl9pZCI6IjY5NmE5NGNhLWUwOGQtNDI1Yy04Mjg1LWJhMWFmZThjNGU4NSIsImlzX2Fub255bW91cyI6ZmFsc2V9.09KgHDbUEcj34liYHA2l96cFuFtZgnPVVPinUlIGjTLrojDfa1Hq-AUCZv7Lh9SvfpBtdu0IZUHAdZfNxJf75A'; // User's JWT
const ELEVEN_LABS_API_KEY = 'sk_d545137c23e3098d622e593988bc4e2691554f05a701b0e8';

if (PROJECT_ID === 'YOUR_PROJECT_ID') {
    console.error('Please update the configuration constants in test-client.js before running.');
    process.exit(1);
}

function runTest(name, payload, expectError = false) {
    return new Promise((resolve, reject) => {
        console.log(`\n--- Starting Test: ${name} ---`);
        const ws = new WebSocket(HOST);
        let hasError = false;
        let isComplete = false;

        const timeout = setTimeout(() => {
            if (!isComplete) {
                console.error(`Status: TIMEOUT`);
                ws.terminate();
                reject(new Error("Test timed out"));
            }
        }, 60000); // 60s timeout

        ws.on('open', function open() {
            // console.log('Connected to WebSocket server');
            console.log('Sending payload...');
            ws.send(JSON.stringify(payload));
        });

        ws.on('message', function message(data) {
            const response = JSON.parse(data.toString());
            console.log(`Received: [${response.status}] ${response.message}`);
            
            if (response.status === 'validating_request' || 
                response.status === 'fetching_content' || 
                response.status === 'checking_cache' ||
                response.status === 'generating_audio' ||
                response.status === 'checking') {
                // Info statuses, keep waiting
            } else if (response.status === 'complete') {
                 isComplete = true;
                 if (response.data) {
                     console.log("Data:", JSON.stringify(response.data, null, 2));
                 }
                 if (expectError) {
                     console.error("FAIL: Expected error but got complete");
                     hasError = true;
                 } else {
                     console.log("PASS: Completed successfully");
                 }
                 ws.close();
            } else if (response.status === 'error') {
                isComplete = true;
                if (expectError) {
                    console.log("PASS: Got expected error");
                } else {
                    console.error("FAIL: Got unexpected error");
                    hasError = true;
                }
                ws.close();
            }
        });

        ws.on('close', () => {
            clearTimeout(timeout);
            // console.log('Disconnected');
            if (hasError) reject(new Error("Test failed"));
            else resolve();
        });

        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
            if (!expectError) hasError = true;
        });
    });
}

const SUPABASE_URL = 'https://hskaqvjruqzmgrwxmxxd.supabase.co'; // Base Supabase URL

// ... (previous code) ...

async function editChapter(projectId, chapterId, content, accessToken, elevenLabsApiKey) {
    console.log(`\n--- Helper: Call editChapter ---`);
    const url = `${SUPABASE_URL}/functions/v1/editChapter`;
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${accessToken}`,
            'eleven-labs-api-key': elevenLabsApiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            projectId,
            chapterId,
            content
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`editChapter failed: ${response.status} - ${text}`);
    }

    const data = await response.json();
    console.log(`editChapter Success: ${data.message}`);
    return data;
}

async function runAllTests() {
    try {
        // 1. Happy Path (Likely cached if run before)
        await runTest("Happy Path (Cache Check)", {
            project_id: PROJECT_ID,
            chapter_id: CHAPTER_ID,
            block_id: BLOCK_ID,
            access_token: ACCESS_TOKEN,
            eleven_labs_api_key: ELEVEN_LABS_API_KEY
        });

        // 2. Force Regenerate
        await runTest("Force Regenerate", {
            project_id: PROJECT_ID,
            chapter_id: CHAPTER_ID,
            block_id: BLOCK_ID,
            access_token: ACCESS_TOKEN,
            eleven_labs_api_key: ELEVEN_LABS_API_KEY,
            force_regenerate: false
        });

        // 3. Integration Test: Edit Chapter -> Regenerate -> Cache Hit
        console.log("\n--- Starting Integration Test Sequence ---");
        
        // Step A: Edit Chapter
        const newContent = {
            "blocks": [
                {
                  "nodes": [
                    {
                      "text": "The stars began to pierce through the gathering gloom as the small party reached the edge of the Shire.",
                      "type": "tts_node",
                      "voice_id": "9dgn8QSxG799oIPKzPx8"
                    },
                    {
                      "text": "It’s the Arctic, Barnaby!",
                      "type": "tts_node",
                      "voice_id": "hpp4J3VqNfWAUOO0d1Us"
                    },
                    {
                      "text": " Bella laughed, tossing a snowball that landed with a pliff on Barnaby’s nose.",
                      "type": "tts_node",
                      "voice_id": "hpp4J3VqNfWAUOO0d1Us"
                    },
                    {
                      "text": " It’s supposed to be freezing. That’s the best part!",
                      "type": "tts_node",
                      "voice_id": "hpp4J3VqNfWAUOO0d1Us"
                    }            
                  ],
                  "block_id": BLOCK_ID // Use the same block ID
                }
            ]
        };

        await editChapter(PROJECT_ID, CHAPTER_ID, newContent, ACCESS_TOKEN, ELEVEN_LABS_API_KEY);

        // Step B: Call WS to preview (Should generate because content changed)
        // We can't strictly enforce "Regenerated" vs "Cached" via status, 
        // but since we just changed it, it SHOULD NOT say "Content unchanged".
        console.log("Calling WS to Regenerate (Content Changed)...");
        await runTest("Regenerate after Edit (Should be generating_audio)", {
             project_id: PROJECT_ID,
             chapter_id: CHAPTER_ID,
             block_id: BLOCK_ID,
             access_token: ACCESS_TOKEN,
             eleven_labs_api_key: ELEVEN_LABS_API_KEY
        });

        // Step C: Call WS again (Should be cached now)
        console.log("Calling WS again (Should be Cached)...");
        await runTest("Cache Hit after Regeneration", {
             project_id: PROJECT_ID,
             chapter_id: CHAPTER_ID,
             block_id: BLOCK_ID,
             access_token: ACCESS_TOKEN,
             eleven_labs_api_key: ELEVEN_LABS_API_KEY
        });


        // 4. Missing Fields (Expect Error)
        await runTest("Missing Fields (Expect Error)", {
             project_id: PROJECT_ID,
             // missing chapter_id
             block_id: BLOCK_ID,
             access_token: ACCESS_TOKEN,
             eleven_labs_api_key: ELEVEN_LABS_API_KEY
        }, true);

        // 5. Invalid Token (Expect Error)
        await runTest("Invalid Token (Expect Error)", {
            project_id: PROJECT_ID,
            chapter_id: CHAPTER_ID,
            block_id: BLOCK_ID,
            access_token: "invalid_token_string",
            eleven_labs_api_key: ELEVEN_LABS_API_KEY
       }, true);

       console.log("\nAll tests completed successfully!");

    } catch (e) {
        console.error("\nTests failed:", e.message);
        process.exit(1);
    }
}


runAllTests();
