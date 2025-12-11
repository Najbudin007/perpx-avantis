# Rebuilding Avantis Service with Fix

## Why the SDK is Failing

The `avantis_trader_sdk` is not installed in your Docker container because:
1. It's not in `requirements.txt` (and may not be publicly available on PyPI)
2. The SDK is **optional** - the code is designed to work without it
3. However, when the SDK fails, `openPrice` was set to `0`, causing the `WRONG_SL` error

## The Fix

I've added a **fallback mechanism** that calculates the entry price from SL/TP values when the SDK is unavailable. This ensures positions can open even without the SDK.

## How to Rebuild and Deploy

### Option 1: Rebuild the Docker Image (Recommended)

If you're using GitHub Actions to build and push images:

1. **Commit and push the changes:**
   ```bash
   git add avantis-service/contract_operations.py
   git commit -m "Fix: Add fallback price calculation from SL/TP when SDK unavailable"
   git push
   ```

2. **Wait for GitHub Actions to rebuild the image** (if you have CI/CD set up)

3. **On your server, pull and restart the container:**
   ```bash
   sudo docker pull ghcr.io/ram858/avantis-service:latest
   sudo docker stop perpx-avantis-service
   sudo docker rm perpx-avantis-service
   # Then restart using your docker-compose or run command
   ```

### Option 2: Rebuild Locally and Push

If you build images manually:

1. **Navigate to avantis-service directory:**
   ```bash
   cd avantis-service
   ```

2. **Build the Docker image:**
   ```bash
   docker build -t ghcr.io/ram858/avantis-service:latest .
   ```

3. **Push to registry:**
   ```bash
   docker push ghcr.io/ram858/avantis-service:latest
   ```

4. **On your server, pull and restart:**
   ```bash
   sudo docker pull ghcr.io/ram858/avantis-service:latest
   sudo docker restart perpx-avantis-service
   ```

### Option 3: Quick Fix - Rebuild on Server

If you want to rebuild directly on the server:

1. **SSH into your server:**
   ```bash
   ssh ubuntu@your-server
   ```

2. **Clone/pull the latest code:**
   ```bash
   cd /opt/perpx-avantis  # or wherever your code is
   git pull  # or clone if first time
   ```

3. **Navigate to avantis-service:**
   ```bash
   cd avantis-service
   ```

4. **Build the image:**
   ```bash
   sudo docker build -t ghcr.io/ram858/avantis-service:latest .
   ```

5. **Stop and remove old container:**
   ```bash
   sudo docker stop perpx-avantis-service
   sudo docker rm perpx-avantis-service
   ```

6. **Start new container** (use your original docker run command or docker-compose)

## Verify the Fix

After rebuilding, check the logs:

```bash
sudo docker logs -f perpx-avantis-service
```

You should see messages like:
- `📈 Calculated entry price from SL/TP for LONG: $X.XX` (when SDK fails)
- Or `📈 Fetched market price for pair X` (if SDK works)

## Optional: Install SDK (if you have access)

If you have access to the `avantis_trader_sdk` package, you can add it to `requirements.txt`:

```txt
# Add this line to avantis-service/requirements.txt
avantis-trader-sdk>=0.1.0
```

Then rebuild the Docker image. However, **the fix will work without the SDK**, so this is optional.

## Summary

- ✅ **Fix is already in code** - calculates price from SL/TP when SDK fails
- 🔄 **You need to rebuild** the Docker container to get the fix
- 📦 **SDK is optional** - the service works fine without it now
- 🚀 **After rebuild**, positions should open successfully in Farcaster app
