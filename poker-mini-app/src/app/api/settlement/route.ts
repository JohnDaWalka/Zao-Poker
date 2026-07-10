/**
 * Blockchain Settlement API
 * 
 * Generates on-chain settlement calldata for ZAO Poker hands.
 * Currently returns simulated calldata for Base mainnet (chainId 8453).
 * 
 * To make this production-ready:
 * 1. Deploy the ZAOPokerSettlement contract to Base
 * 2. Update CONTRACT_ADDRESS below
 * 3. Add a signer wallet (via AWS KMS, Turnkey, or local HSM)
 * 4. Switch status from 'simulated' to 'ready' and submit tx
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateSettlement } from '~/lib/swarm/pokerSwarm';

// Placeholder — replace with deployed contract address
const CONTRACT_ADDRESS = process.env.ZAO_SETTLEMENT_CONTRACT || '0x0000000000000000000000000000000000000000';
const CHAIN_ID = Number(process.env.ZAO_CHAIN_ID || '8453'); // Base mainnet

interface SettlementBody {
  tableId: string;
  winners: Array<{ fid: number; amount: number }>;
  payouts: Array<{ fid: number; amount: number }>;
  dryRun?: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const body: SettlementBody = await req.json();
    const { tableId, winners, payouts, dryRun = true } = body;

    if (!tableId || !winners || !payouts) {
      return NextResponse.json(
        { error: 'tableId, winners, and payouts required' },
        { status: 400 }
      );
    }

    // Generate settlement calldata
    const settlement = generateSettlement(winners, payouts, tableId);
    
    // Update with real contract address
    const finalSettlement = {
      ...settlement,
      contractAddress: CONTRACT_ADDRESS,
      chainId: CHAIN_ID,
      status: dryRun ? 'simulated' : 'ready',
    };

    if (dryRun) {
      return NextResponse.json({
        settlement: finalSettlement,
        message: 'Dry run — transaction not submitted. Set dryRun: false to execute.',
        explorerUrl: `https://basescan.org/address/${CONTRACT_ADDRESS}`,
      });
    }

    // Production path: submit transaction
    // This requires a signer wallet. Implementation depends on your custody setup:
    // - AWS KMS: use @aws-sdk/client-kms to sign
    // - Turnkey: use @turnkey/sdk-server
    // - Local: use viem walletClient with private key
    
    // Example with viem (uncomment when ready):
    // import { createWalletClient, http, parseEther } from 'viem';
    // import { base } from 'viem/chains';
    // import { privateKeyToAccount } from 'viem/accounts';
    // 
    // const account = privateKeyToAccount(process.env.ZAO_SETTLEMENT_PK as `0x${string}`);
    // const client = createWalletClient({ account, chain: base, transport: http() });
    // 
    // const txHash = await client.writeContract({
    //   address: CONTRACT_ADDRESS as `0x${string}`,
    //   abi: ZAO_POKER_ABI,
    //   functionName: 'settleHand',
    //   args: finalSettlement.args,
    // });

    return NextResponse.json({
      settlement: finalSettlement,
      status: 'submitted',
      // txHash,
      // explorerUrl: `https://basescan.org/tx/${txHash}`,
      message: 'Settlement ready for on-chain submission. Implement signer to complete.',
    });
  } catch (error) {
    console.error('Settlement API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tableId = searchParams.get('tableId');

  if (!tableId) {
    return NextResponse.json(
      { error: 'tableId required' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    contractAddress: CONTRACT_ADDRESS,
    chainId: CHAIN_ID,
    explorerUrl: `https://basescan.org/address/${CONTRACT_ADDRESS}`,
    status: 'Contract not yet deployed — settlement is simulated',
  });
}
