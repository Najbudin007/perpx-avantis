# Installing Avantis SDK on Server

## What Changed

I've added `avantis-trader-sdk==0.8.11` to `requirements.txt`. This is the same SDK version you have installed locally in your venv.

## SDK Details

- **Package**: `avantis-trader-sdk`
- **Version**: `0.8.11`
- **Dependencies**: Automatically installed (web3, pydantic, websockets, boto3, eth_account, toolz, eth_utils, pyasn1)

## Installation Steps

### Option 1: Rebuild Docker Container (Recommended)

The SDK will be automatically installed when you rebuild the Docker image:

1. **Commit and push the changes:**
   ```bash
   git add avantis-service/requirements.txt
   git commit -m "Add avantis-trader-sdk to requirements for server deployment"
   git push
   ```

2. **Rebuild the Docker image:**

   **If using GitHub Actions/CI:**
   - The image will rebuild automatically when you push
   - Wait for the build to complete

   **If building manually:**
   ```bash
   cd avantis-service
   docker build -t ghcr.io/ram858/avantis-service:latest .
   docker push ghcr.io/ram858/avantis-service:latest
   ```

3. **On your server, pull and restart:**
   ```bash
   sudo docker pull ghcr.io/ram858/avantis-service:latest
   sudo docker stop perpx-avantis-service
   sudo docker rm perpx-avantis-service
   # Then restart using your docker run command or docker-compose
   ```

### Option 2: Install SDK in Running Container (Quick Test)

If you want to test without rebuilding:

```bash
# SSH into your server
ssh ubuntu@your-server

# Enter the running container
sudo docker exec -it perpx-avantis-service bash

# Install the SDK
pip install avantis-trader-sdk==0.8.11

# Exit container
exit

# Restart the container to apply changes
sudo docker restart perpx-avantis-service
```

**Note**: This is temporary - changes will be lost if the container is recreated. Use Option 1 for permanent installation.

### Option 3: Install SDK in Existing Container (Persistent)

If you want to install without rebuilding but make it persistent:

1. **Create a custom Dockerfile or modify the existing one** (already done - SDK is in requirements.txt)
2. **Rebuild** (follow Option 1)

## Verification

After installation, check the logs to verify SDK is working:

```bash
sudo docker logs perpx-avantis-service | grep -i "sdk\|avantis symbol registry"
```

You should see:
```
✅ Avantis symbol registry initialized from SDK: 81 pairs loaded.
```

Or when opening a position:
```
📈 Fetched market price for pair 0 (BTC): $90283.66
```

Instead of:
```
⚠️ SDK price fetch error: No module named 'avantis_trader_sdk'
📈 Calculated entry price from SL/TP for LONG: $89778.33
```

## Benefits

With SDK installed:
- ✅ **More accurate prices**: Direct from Avantis on-chain oracle
- ✅ **Better reliability**: No need for fallback calculation
- ✅ **Faster**: SDK price fetch is optimized
- ✅ **Consistent**: Same behavior as local environment

## Fallback Still Works

Even with SDK installed, the fallback mechanism remains as a safety net:
- If SDK fails for any reason, it will automatically calculate from SL/TP
- This ensures positions can always open (as long as SL/TP are provided)

## Troubleshooting

### If SDK installation fails:

1. **Check PyPI access:**
   ```bash
   docker exec -it perpx-avantis-service pip install avantis-trader-sdk==0.8.11
   ```

2. **Check dependencies:**
   The SDK requires:
   - Python 3.6+
   - web3>=6.15.1
   - pydantic>=2.8.2
   - websockets>=12.0
   - boto3>=1.35.44
   - eth_account>=0.10.0

3. **Check network:**
   Ensure the Docker container has internet access to download from PyPI

### If SDK works but price fetch fails:

- Check network connectivity from container
- Verify RPC URL is correct
- Check Avantis service status

## Summary

✅ **SDK added to requirements.txt**  
✅ **Will be installed automatically on next Docker build**  
✅ **Fallback still works if SDK fails**  
✅ **Same version as local (0.8.11)**  

After rebuilding, your server will have the same SDK setup as your local environment!
