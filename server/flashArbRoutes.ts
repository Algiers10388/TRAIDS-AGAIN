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

    const balHex = balData.result;
    if (!balData?.result || !gasData?.result) throw new Error('RPC returned no balance/gas data');
    const gasHex = gasData.result;

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

    // Operator-supplied planning figure (override with FLASH_ARB_ASSUMED_GAS); not a measured value.
    const avgGasPerTx = BigInt(Math.max(1, parseInt(process.env.FLASH_ARB_ASSUMED_GAS || '350000', 10) || 350000));
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
      gasPriceGwei: 0,
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

    // Live ETH/USD for the USD column; null when unavailable (never a made-up number)
    let ethUsdPrice: number | null = null;
    try {
      const pr = await fetch('https://api.exchange.coinbase.com/products/ETH-USD/ticker', {
        headers: { 'User-Agent': 'CryptoAgent/1.0' },
        signal: AbortSignal.timeout(4000),
      });
      if (pr.ok) {
        const px = parseFloat((await pr.json()).price);
        if (px > 0) ethUsdPrice = px;
      }
    } catch {
      /* leave null */
    }
    const usd = (eth: number) => (ethUsdPrice ? Number((eth * ethUsdPrice).toFixed(2)) : null);

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
      ethUsdPrice,
      chains: {
        arbitrum: {
          ...RPC_ENDPOINTS.arbitrum,
          ...arbStatus,
          balanceUsd: usd(arbStatus.balanceEth),
          fundedForTrading: arbStatus.balanceEth >= 0.002,
        },
        base: {
          ...RPC_ENDPOINTS.base,
          ...baseStatus,
          balanceUsd: usd(baseStatus.balanceEth),
          fundedForTrading: baseStatus.balanceEth >= 0.002,
        },
        optimism: {
          ...RPC_ENDPOINTS.optimism,
          ...opStatus,
          balanceUsd: usd(opStatus.balanceEth),
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
  const keyPreview = isKeyConfigured ? 'configured (hidden)' : null;

  res.json({
    success: true,
    gasWallet: process.env.FLASH_ARB_GAS_WALLET || DEFAULT_GAS_WALLET,
    profitWallet: process.env.FLASH_ARB_PROFIT_WALLET || DEFAULT_PROFIT_WALLET,
    isKeyConfigured,
    keyPreview,
    architecture: {
      gasFunderRole: 'Signs executeFlashArb transactions and pays L2 gas. Must be the FlashArb contract owner.',
      profitVaultRole: 'Receives realized profit (after Aave premium) via the contract profitRecipient parameter.',
      nonCustodialGuarantee: 'The FlashArb contract is designed to hold no tokens between executions; verify on-chain.',
    },
  });
});

/**
 * The signer key can no longer be set or cleared over HTTP. Put FLASH_ARB_SIGNER_KEY in the server
 * environment (secret manager) and restart. Accepting private keys over an API is not safe.
 */
const keyViaEnvOnly = (_req: Request, res: Response) =>
  res.status(405).json({
    success: false,
    error: 'The signer key is configured via the FLASH_ARB_SIGNER_KEY environment variable only.',
  });
flashArbRouter.post('/signer-config', keyViaEnvOnly);
flashArbRouter.delete('/signer-config', keyViaEnvOnly);
