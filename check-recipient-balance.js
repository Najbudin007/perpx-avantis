#!/usr/bin/env node

/**
 * Check balance of the actual transaction recipient address
 */

const { ethers } = require('ethers');

// Configuration
const RECIPIENT_ADDRESS = '0x1f4Ef1eD23E38dAA2BD1451D4CEF219C93B2016F'; // Actual recipient from transaction
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

async function checkRecipientBalance() {
  try {
    console.log('🔍 Checking Balance of Transaction Recipient\n');
    console.log('='.repeat(70));
    console.log(`📝 Recipient Address: ${RECIPIENT_ADDRESS}`);
    console.log(`   (From transaction: 0x0c281560193b5b8c9555bc06f21b3d1e9ef8f2ccb93dd2c9dc82522449e3a857)`);
    console.log('');
    
    // Create provider
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // Check ETH balance
    const ethBalance = await provider.getBalance(RECIPIENT_ADDRESS);
    const ethBalanceFormatted = ethers.formatEther(ethBalance);
    console.log(`💰 ETH Balance: ${ethBalanceFormatted} ETH`);
    console.log(`   ($${(parseFloat(ethBalanceFormatted) * 2500).toFixed(2)} @ $2500/ETH)`);
    console.log('');
    
    // Check USDC balance
    const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
    const usdcBalanceRaw = await usdcContract.balanceOf(RECIPIENT_ADDRESS);
    const usdcBalance = parseFloat(ethers.formatUnits(usdcBalanceRaw, 6)); // USDC has 6 decimals
    console.log(`💵 USDC Balance: ${usdcBalance.toFixed(6)} USDC`);
    console.log(`   ($${usdcBalance.toFixed(2)})`);
    console.log('');
    
    // Check Avantis balance via API (by address)
    console.log('📊 Checking Avantis Vault Balance via API...');
    try {
      const avantisResponse = await fetch(`${AVANTIS_API_URL}/api/balance?address=${RECIPIENT_ADDRESS}`, {
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
          const positionsResponse = await fetch(`${AVANTIS_API_URL}/api/positions?address=${RECIPIENT_ADDRESS}`, {
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
        console.log(`   Recipient Address: ${RECIPIENT_ADDRESS}`);
        console.log(`   ETH: ${ethBalanceFormatted} ETH`);
        console.log(`   USDC (Wallet): $${usdcBalance.toFixed(2)}`);
        console.log(`   USDC (Avantis Vault): $${vaultBalance.toFixed(2)}`);
        
        const totalUSDC = usdcBalance + vaultBalance;
        console.log(`   Total USDC: $${totalUSDC.toFixed(2)}`);
        console.log('');
        
        // Analysis
        if (totalUSDC >= 10 && totalUSDC <= 11.5) {
          console.log('✅ Funds found!');
          if (vaultBalance > 0) {
            console.log('   Funds are in Avantis vault (ready for trading)');
            console.log('   No positions found - funds are available but not used');
            console.log('');
            console.log('💡 Why Avantis UI shows "Insufficient balance":');
            console.log('   The UI might be checking a different address or');
            console.log('   the funds need to be "activated" by connecting the wallet');
          } else if (usdcBalance > 0) {
            console.log('   Funds are in wallet but NOT in vault');
            console.log('   They need to be deposited to vault for trading');
            console.log('   This is why Avantis UI shows "Insufficient balance"');
          }
        } else if (totalUSDC < 0.01) {
          console.log('⚠️  WARNING: No USDC found in this address!');
          console.log('   Expected: ~$11 USDC');
          console.log('   Found: $' + totalUSDC.toFixed(2));
          console.log('');
          console.log('   Possible causes:');
          console.log('   1. Funds were transferred to a different address');
          console.log('   2. Funds are stuck in contract approval');
          console.log('   3. Funds were used in a failed position attempt');
        }
        
      } else {
        const errorText = await avantisResponse.text();
        console.log(`⚠️  Avantis API error: ${avantisResponse.status} ${errorText}`);
        console.log('');
        console.log('📊 SUMMARY (Wallet Only):');
        console.log(`   Recipient Address: ${RECIPIENT_ADDRESS}`);
        console.log(`   ETH: ${ethBalanceFormatted} ETH`);
        console.log(`   USDC (Wallet): $${usdcBalance.toFixed(2)}`);
        console.log('');
        
        if (usdcBalance >= 10 && usdcBalance <= 11.5) {
          console.log('✅ Funds found in wallet!');
          console.log('   Funds are in wallet but NOT in Avantis vault');
          console.log('   They need to be deposited to vault for trading');
          console.log('   This is why Avantis UI shows "Insufficient balance"');
        }
      }
    } catch (apiError) {
      console.log(`⚠️  Error calling Avantis API: ${apiError.message}`);
      console.log('');
      console.log('📊 SUMMARY (Wallet Only):');
      console.log(`   Recipient Address: ${RECIPIENT_ADDRESS}`);
      console.log(`   ETH: ${ethBalanceFormatted} ETH`);
      console.log(`   USDC (Wallet): $${usdcBalance.toFixed(2)}`);
      console.log('');
      
      if (usdcBalance >= 10 && usdcBalance <= 11.5) {
        console.log('✅ Funds found in wallet!');
        console.log('   Funds are in wallet but NOT in Avantis vault');
        console.log('   They need to be deposited to vault for trading');
      }
    }
    
    console.log('');
    console.log('💡 Important Notes:');
    console.log('   1. The private key you provided is for a DIFFERENT wallet');
    console.log('   2. Funds were sent to: ' + RECIPIENT_ADDRESS);
    console.log('   3. Private key wallet: 0x1412C18d693bb2ab22aa7F18e6eCb0CFC7049ef4');
    console.log('   4. You need the private key for the recipient address to access funds');
    console.log('');
    console.log('💡 Next Steps:');
    console.log('   1. Find the private key for address: ' + RECIPIENT_ADDRESS);
    console.log('   2. Or check if this is your trading wallet in the database');
    console.log('   3. If funds are in wallet: Deposit to Avantis vault via UI');
    console.log('   4. Check transaction: https://basescan.org/tx/0x0c281560193b5b8c9555bc06f21b3d1e9ef8f2ccb93dd2c9dc82522449e3a857');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

// Run the check
checkRecipientBalance().catch(console.error);

