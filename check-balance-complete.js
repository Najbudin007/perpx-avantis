#!/usr/bin/env node

/**
 * Complete balance check - Wallet + Avantis Vault
 * Checks if funds are stuck in contract
 */

const { ethers } = require('ethers');

// Configuration
const PRIVATE_KEY = '0xab9c15526fc4e452fb4daf4a11b3a705734461781d6e5fb9a1de1961aceec29e';
const RPC_URL = 'https://mainnet.base.org';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // Base mainnet USDC
const AVANTIS_API_URL = process.env.NEXT_PUBLIC_AVANTIS_API_URL || process.env.AVANTIS_API_URL || 'http://localhost:8000';

// USDC ABI
const USDC_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    type: 'function'
  }
];

async function checkBalances() {
  try {
    console.log('🔍 Complete Balance Check\n');
    console.log('='.repeat(70));
    
    // Create provider and wallet
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const walletAddress = wallet.address;
    
    console.log(`📝 Wallet Address: ${walletAddress}`);
    console.log(`🔑 Private Key: ${PRIVATE_KEY.slice(0, 10)}...${PRIVATE_KEY.slice(-4)}`);
    console.log('');
    
    // Verify address matches transaction recipient
    const expectedRecipient = '0x1f4Ef1eD23E38dAA2BD1451D4CEF219C93B2016F';
    if (walletAddress.toLowerCase() === expectedRecipient.toLowerCase()) {
      console.log('✅ Wallet address matches transaction recipient');
    } else {
      console.log(`⚠️  Wallet address does NOT match transaction recipient!`);
      console.log(`   Expected: ${expectedRecipient}`);
      console.log(`   Actual: ${walletAddress}`);
    }
    console.log('');
    
    // Check ETH balance
    const ethBalance = await provider.getBalance(walletAddress);
    const ethBalanceFormatted = ethers.formatEther(ethBalance);
    console.log(`💰 ETH Balance: ${ethBalanceFormatted} ETH`);
    console.log(`   ($${(parseFloat(ethBalanceFormatted) * 2500).toFixed(2)} @ $2500/ETH)`);
    console.log('');
    
    // Check USDC balance in wallet
    const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
    const usdcBalanceRaw = await usdcContract.balanceOf(walletAddress);
    const usdcBalance = parseFloat(ethers.formatUnits(usdcBalanceRaw, 6)); // USDC has 6 decimals
    console.log(`💵 USDC Balance (Wallet): ${usdcBalance.toFixed(6)} USDC`);
    console.log(`   ($${usdcBalance.toFixed(2)})`);
    console.log('');
    
    // Check Avantis balance via API
    console.log('📊 Checking Avantis Vault Balance via API...');
    try {
      const avantisResponse = await fetch(`${AVANTIS_API_URL}/api/balance?private_key=${encodeURIComponent(PRIVATE_KEY)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (avantisResponse.ok) {
        const avantisData = await avantisResponse.json();
        const vaultBalance = avantisData.usdc_balance || 0;
        const allowance = avantisData.usdc_allowance || 0;
        const totalCollateral = avantisData.total_collateral || 0;
        
        console.log(`🏦 Avantis Vault Balance: $${vaultBalance.toFixed(2)} USDC`);
        console.log(`   Allowance: $${allowance.toFixed(2)} USDC`);
        console.log(`   Total Collateral: $${totalCollateral.toFixed(2)} USDC`);
        console.log('');
        
        // Check positions
        console.log('📈 Checking Positions...');
        try {
          const positionsResponse = await fetch(`${AVANTIS_API_URL}/api/positions?private_key=${encodeURIComponent(PRIVATE_KEY)}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          });
          
          if (positionsResponse.ok) {
            const positionsData = await positionsResponse.json();
            const positions = positionsData.positions || positionsData || [];
            
            if (positions && positions.length > 0) {
              console.log(`⚠️  Found ${positions.length} open position(s):`);
              positions.forEach((pos, i) => {
                console.log(`   Position ${i + 1}:`);
                console.log(`     Symbol: ${pos.symbol || 'N/A'}`);
                console.log(`     Size: ${pos.size || 0}`);
                console.log(`     PnL: $${(pos.pnl || 0).toFixed(2)}`);
                console.log(`     Leverage: ${pos.leverage || 0}x`);
              });
            } else {
              console.log('✅ No open positions found');
            }
          } else {
            console.log('⚠️  Could not fetch positions');
          }
        } catch (posError) {
          console.log('⚠️  Error checking positions:', posError.message);
        }
        console.log('');
        
        // Summary
        console.log('='.repeat(70));
        console.log('📊 SUMMARY:');
        console.log(`   Wallet Address: ${walletAddress}`);
        console.log(`   ETH: ${ethBalanceFormatted} ETH`);
        console.log(`   USDC (Wallet): $${usdcBalance.toFixed(2)}`);
        console.log(`   USDC (Avantis Vault): $${vaultBalance.toFixed(2)}`);
        
        const totalUSDC = usdcBalance + vaultBalance;
        console.log(`   Total USDC: $${totalUSDC.toFixed(2)}`);
        console.log('');
        
        // Analysis
        if (totalUSDC < 10) {
          console.log('⚠️  WARNING: Total USDC is less than expected!');
          console.log('   Expected: ~$11 USDC');
          console.log('   Found: $' + totalUSDC.toFixed(2));
          console.log('');
          console.log('   Possible causes:');
          console.log('   1. Funds are stuck in contract approval');
          console.log('   2. Funds were used in a failed position attempt');
          console.log('   3. Funds are in a different wallet');
          console.log('   4. Transaction fee deducted');
        } else if (vaultBalance > 0 && usdcBalance < 0.01) {
          console.log('✅ Funds are in Avantis vault (ready for trading)');
          console.log('   No positions found - funds are available but not used');
        } else if (usdcBalance > 0 && vaultBalance < 0.01) {
          console.log('⚠️  Funds are in wallet but NOT in vault');
          console.log('   They need to be deposited to vault for trading');
          console.log('   This is why Avantis UI shows "Insufficient balance"');
        } else if (usdcBalance > 0 && vaultBalance > 0) {
          console.log('✅ Funds are split between wallet and vault');
        }
        
      } else {
        const errorText = await avantisResponse.text();
        console.log(`⚠️  Avantis API error: ${avantisResponse.status} ${errorText}`);
        console.log('');
        console.log('📊 SUMMARY (Wallet Only):');
        console.log(`   Wallet Address: ${walletAddress}`);
        console.log(`   ETH: ${ethBalanceFormatted} ETH`);
        console.log(`   USDC (Wallet): $${usdcBalance.toFixed(2)}`);
        console.log('');
        console.log('⚠️  Could not check Avantis vault balance');
        console.log('   Make sure Avantis service is running at:', AVANTIS_API_URL);
      }
    } catch (apiError) {
      console.log(`⚠️  Error calling Avantis API: ${apiError.message}`);
      console.log('');
      console.log('📊 SUMMARY (Wallet Only):');
      console.log(`   Wallet Address: ${walletAddress}`);
      console.log(`   ETH: ${ethBalanceFormatted} ETH`);
      console.log(`   USDC (Wallet): $${usdcBalance.toFixed(2)}`);
      console.log('');
      console.log('⚠️  Could not check Avantis vault balance');
      console.log('   Make sure Avantis service is running at:', AVANTIS_API_URL);
    }
    
    console.log('');
    console.log('💡 Next Steps:');
    console.log('   1. If funds are in vault: They are available for trading');
    console.log('   2. If funds are in wallet only: Deposit to vault via Avantis UI');
    console.log('   3. If funds are missing: Check transaction history on BaseScan');
    console.log('   4. Check the transaction: https://basescan.org/tx/0x0c281560193b5b8c9555bc06f21b3d1e9ef8f2ccb93dd2c9dc82522449e3a857');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the check
checkBalances().catch(console.error);

