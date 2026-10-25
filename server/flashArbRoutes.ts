import { Router, Request, Response } from 'express';

export const flashArbRouter = Router();

// Default addresses specified by user
const DEFAULT_GAS_WALLET = '0xF1d765d693f9e6fAb0c4a2FCa942d9D54233C966';
const DEFAULT_PROFIT_WALLET = '0xc102BB3848DD0397dEB6C655721F756Aa9F9f15d';

// Initialize defaults if not set in process.env
if (!process.env.FLASH_ARB_GAS_WALLET) {
  process.env.FLASH_ARB_GAS_WALLET = DEFAULT_GAS_WALLET;
}
if (!process.env.FLASH_ARB_PROFIT_WALLET) {
  process.env.FLASH_ARB_PROFIT_WALLET = DEFAULT_PROFIT_WALLET;
}

const RPC_ENDPOINTS: Record<string, { name: string; rpc: string; explorer: string; chainId: number }> = {
  arbitrum: {
    name: 'Arbitrum One',
    rpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io',
    chainId: 42161,
  },
  base: {
    name: 'Base L2',
    rpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    chainId: 8453,
  },
  optimism: {
    name: 'Optimism Mainnet',
    rpc: 'https://mainnet.optimism.io',
    explorer: 'https://optimistic.etherscan.io',
    chainId: 10,
  },
};

/**
 * Fetch raw on-chain balance and gas price via JSON-RPC
 */
async function queryChainGas(rpcUrl: string, address: string) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const [balRes, gasRes] = await Promise.all([
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getBalance',
          params: [address, 'latest'],
          id: 1,
        }),
        signal: controller.signal,
      }),
      fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_gasPrice',
          params: [],
          id: 2,
        }),
        signal: controller.signal,
      }),
    ]);

    clearTimeout(timeoutId);

    const balData = await balRes.json();
    const gasData = await gasRes.json();

    const balHex = balData?.result || '0x0';
    const gasHex = gasData?.result || '0x3b9aca00'; // fallback 1 gwei

    const balanceWei = BigInt(balHex);
    const gasPriceWei = BigInt(gasHex);

    // Convert balance from Wei to ETH with 6 decimal precision
    const weiPerEth = 10n ** 18n;
    const wholeEth = balanceWei / weiPerEth;
    const remainderWei = balanceWei % weiPerEth;
    const fractionalPart = (remainderWei * 1000000n) / weiPerEth;
    const ethStr = `${wholeEth}.${fractionalPart.toString().padStart(6, '0')}`;
    const ethNum = parseFloat(ethStr);

    const gasPriceGwei = Number(gasPriceWei) / 1e9;

    // FlashArbOptimized consumes ~148,000 gas per trade
    const avgGasPerTx = 148000n;
    const costPerTxWei = avgGasPerTx * (gasPriceWei > 0n ? gasPriceWei : 100000000n);
    const estimatedTxs = costPerTxWei > 0n ? Number(balanceWei / costPerTxWei) : 0;

    return {
      success: true,
      balanceEth: ethNum,
      balanceEthFormatted: `${ethNum.toFixed(4)} ETH`,
      gasPriceGwei: Number(gasPriceGwei.toFixed(3)),
      estimatedTxsRemaining: Math.max(0, estimatedTxs),
      rawHex: balHex,
    };
  } catch (err: any) {
    return {
      success: false,
      balanceEth: 0,
      balanceEthFormatted: '0.0000 ETH',
      gasPriceGwei: 0.1,
      estimatedTxsRemaining: 0,
      error: err.message || 'RPC Query Timeout',
    };
  }
}

/**
 * GET /api/flash-arb/gas-status
 * Queries real-time on-chain ETH gas balance of the Gas Holder Wallet across Arbitrum, Base, and Optimism
 */
flashArbRouter.get('/gas-status', async (req: Request, res: Response) => {
  try {
    const address = String(req.query.address || process.env.FLASH_ARB_GAS_WALLET || DEFAULT_GAS_WALLET);

    // Approximate ETH USD price for USD balance computation
    const ethUsdPrice = 2850;

    const [arbStatus, baseStatus, opStatus] = await Promise.all([
      queryChainGas(RPC_ENDPOINTS.arbitrum.rpc, address),
      queryChainGas(RPC_ENDPOINTS.base.rpc, address),
      queryChainGas(RPC_ENDPOINTS.optimism.rpc, address),
    ]);

    const isSignerConfigured = Boolean(process.env.FLASH_ARB_SIGNER_KEY);

    res.json({
      success: true,
      gasWallet: address,
      profitWallet: process.env.FLASH_ARB_PROFIT_WALLET || DEFAULT_PROFIT_WALLET,
      isSignerConfigured,
      chains: {
        arbitrum: {
          ...RPC_ENDPOINTS.arbitrum,
          ...arbStatus,
          balanceUsd: Number((arbStatus.balanceEth * ethUsdPrice).toFixed(2)),
          fundedForTrading: arbStatus.balanceEth >= 0.002,
        },
        base: {
          ...RPC_ENDPOINTS.base,
          ...baseStatus,
          balanceUsd: Number((baseStatus.balanceEth * ethUsdPrice).toFixed(2)),
          fundedForTrading: baseStatus.balanceEth >= 0.002,
        },
        optimism: {
          ...RPC_ENDPOINTS.optimism,
          ...opStatus,
          balanceUsd: Number((opStatus.balanceEth * ethUsdPrice).toFixed(2)),
          fundedForTrading: opStatus.balanceEth >= 0.002,
        },
      },
      timestamp: Date.now(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/flash-arb/signer-config
 * Checks whether the Gas Execution Private Key is registered in server memory
 */
flashArbRouter.get('/signer-config', (_req: Request, res: Response) => {
  const isKeyConfigured = Boolean(process.env.FLASH_ARB_SIGNER_KEY);
  const keyStr = process.env.FLASH_ARB_SIGNER_KEY || '';
  const keyPreview = isKeyConfigured
    ? `••••••••••••••••••••••••••••••••••••••••••••${keyStr.slice(-4)}`
    : null;

  res.json({
    success: true,
    gasWallet: process.env.FLASH_ARB_GAS_WALLET || DEFAULT_GAS_WALLET,
    profitWallet: process.env.FLASH_ARB_PROFIT_WALLET || DEFAULT_PROFIT_WALLET,
    isKeyConfigured,
    keyPreview,
    architecture: {
      gasFunderRole: 'Executes trades and pays L2 gas & sequencer tips on Arbitrum & Base',
      profitVaultRole: 'Receives 100% of realized net flash loan profits via asset.transfer(recipient, netProfit)',
      nonCustodialGuarantee: 'Smart contract FlashArbOptimized holds 0 residual tokens before and after every execution',
    },
  });
});

/**
 * POST /api/flash-arb/signer-config
 * Registers the execution signer key for the gas holder wallet in secure server runtime memory
 */
flashArbRouter.post('/signer-config', (req: Request, res: Response) => {
  try {
    const { privateKey, gasWallet, profitWallet } = req.body;

    if (!privateKey || typeof privateKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Private key is required',
      });
    }

    const cleanKey = privateKey.trim();
    // Validate standard EVM private key format (64 hex characters or 66 if starting with 0x)
    const hexPattern = /^(0x)?[a-fA-F0-9]{64}$/;
    if (!hexPattern.test(cleanKey)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid EVM private key format. Must be a 64-character hexadecimal string (with or without 0x prefix).',
      });
    }

    // Securely register into server memory
    process.env.FLASH_ARB_SIGNER_KEY = cleanKey.startsWith('0x') ? cleanKey : `0x${cleanKey}`;

    if (gasWallet && typeof gasWallet === 'string' && /^0x[a-fA-F0-9]{40}$/i.test(gasWallet.trim())) {
      process.env.FLASH_ARB_GAS_WALLET = gasWallet.trim();
    }

    if (profitWallet && typeof profitWallet === 'string' && /^0x[a-fA-F0-9]{40}$/i.test(profitWallet.trim())) {
      process.env.FLASH_ARB_PROFIT_WALLET = profitWallet.trim();
    }

    const keyLast4 = process.env.FLASH_ARB_SIGNER_KEY.slice(-4);

    return res.json({
      success: true,
      message: 'Signer key successfully configured in server memory for live Arbitrum and Base execution',
      isKeyConfigured: true,
      gasWallet: process.env.FLASH_ARB_GAS_WALLET,
      profitWallet: process.env.FLASH_ARB_PROFIT_WALLET,
      keyPreview: `••••••••••••••••••••••••••••••••••••••••••••${keyLast4}`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * DELETE /api/flash-arb/signer-config
 * Clears signer key from server memory
 */
flashArbRouter.delete('/signer-config', (_req: Request, res: Response) => {
  delete process.env.FLASH_ARB_SIGNER_KEY;
  res.json({
    success: true,
    message: 'Signer key cleared from server memory',
    isKeyConfigured: false,
  });
});
