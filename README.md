# Gemini Web to API

An OpenAI-compatible web-to-api proxy that exposes the Gemini Web interface as an API.

---

## Usage

### How to Run Locally

#### Step 1: Clone the Repository
Clone the project and navigate into the directory:
```bash
git clone https://github.com/VijayShankar22/gemini-web-to-api.git
cd gemini-web-to-api
```

#### Step 2: Configure Local Credentials (Optional)
This proxy can run anonymously without any account cookies. If you wish to use your Google account session, create a `.dev.vars` file in the root of the project to store your credentials:
```env
GEMINI_COOKIE="your_gemini_cookie_here"
```
*Note: The cookie string can be obtained from gemini.google.com (specifically containing `__Secure-1PSID` and other session parameters).*

#### Step 3: Run the Development Server
Start the local server using Wrangler:
```bash
npx wrangler dev
```
The server will start running locally at `http://127.0.0.1:8787`.

#### Step 4: Verify Local Server is Working
Depending on your terminal, use one of the following commands to test the local proxy:

**For Command Prompt (CMD):**
```cmd
curl -X POST http://127.0.0.1:8787/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"gemini-web\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}"
```

**For Windows PowerShell:**
```powershell
curl.exe -X POST http://127.0.0.1:8787/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"gemini-web\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}"
```

---

### How to Deploy Online

#### Step 1: Log in
Authenticate wrangler CLI with your account:
```bash
npx wrangler login
```

#### Step 2: Set Production Secrets (Optional)
If you are using account credentials instead of running anonymously, upload your Gemini cookie securely:
```bash
# Upload Gemini Cookie
npx wrangler secret put GEMINI_COOKIE
```

#### Step 3: Deploy the Worker
Deploy the worker:
```bash
npx wrangler deploy
```
This will provide you with your public worker URL (e.g., `https://gemini-proxy.yourname.workers.dev`).

#### Step 4: Verify Online Deployment
Replace `YOUR_WORKER_URL` with your actual worker domain:

**For Command Prompt (CMD):**
```cmd
curl -X POST https://YOUR_WORKER_URL/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"gemini-web\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}"
```

**For Windows PowerShell:**
```powershell
curl.exe -X POST https://YOUR_WORKER_URL/v1/chat/completions -H "Content-Type: application/json" -d "{\"model\":\"gemini-web\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}"
```

---

### Session Configuration
You can customize session limits and settings in `wrangler.toml` under the `[vars]` block:

```toml
[vars]
# Maximum messages per chat session before rotating
GEMINI_SESSION_MAX_MSGS = "20"

# Time-to-live for a session in milliseconds (defaults to 3 hours)
GEMINI_SESSION_TTL_MS = "10800000"

# Language hint (defaults to en-US)
GEMINI_HL = "en-US"
```

### Multi-User Isolation
To isolate sessions per client, send client identifier headers in your API requests. The proxy routes requests based on:
1. `X-Client-Id`
2. `X-User-Id`
3. Fallback to `CF-Connecting-IP` (client IP)

Example isolation request:
```bash
curl.exe -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Client-Id: user_123" \
  -d "{\"model\":\"gemini-web\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}"
```
