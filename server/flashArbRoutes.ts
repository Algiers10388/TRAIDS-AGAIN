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

const RPC_ENDPOINTS: Record<string, {
  name: string;
  rpc: string;
  explorer: string;
  chainId: number;
  balancerVault: string;
  aavePool: string;
}> = {
  arbitrum: {
    name: 'Arbitrum One',
    rpc: 'https://arb1.arbitrum.io/rpc',
    explorer: 'https://arbiscan.io',
    chainId: 42161,
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  },
  base: {
    name: 'Base L2',
    rpc: 'https://mainnet.base.org',
    explorer: 'https://basescan.org',
    chainId: 8453,
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    aavePool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  },
  optimism: {
    name: 'Optimism Mainnet',
    rpc: 'https://mainnet.optimism.io',
    explorer: 'https://optimistic.etherscan.io',
    chainId: 10,
    balancerVault: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
    aavePool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
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

/**
 * GET /api/flash-arb/contract-status
 * Inspects on-chain bytecode of the flash arb contract to check if deployed
 */
flashArbRouter.get('/contract-status', async (req: Request, res: Response) => {
  try {
    const chain = String(req.query.chain || 'arbitrum').toLowerCase();
    const address = String(req.query.address || '').trim();
    const rpcInfo = RPC_ENDPOINTS[chain] || RPC_ENDPOINTS.arbitrum;

    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ success: false, error: 'Invalid EVM contract address' });
    }

    const resp = await fetch(rpcInfo.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: [address, 'latest'],
        id: 1,
      }),
    });
    const data = await resp.json();
    const code = data?.result || '0x';
    const isDeployed = code !== '0x' && code.length > 2;

    return res.json({
      success: true,
      chain,
      address,
      isDeployed,
      bytecodeLength: isDeployed ? (code.length - 2) / 2 : 0,
      explorerUrl: `${rpcInfo.explorer}/address/${address}#code`,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/flash-arb/broadcast
 * Broadcasts a real signed transaction to Arbitrum/Base/Optimism via the server-configured signer key
 */
flashArbRouter.post('/broadcast', async (req: Request, res: Response) => {
  try {
    const { chain, to, data, gasLimit } = req.body;
    const targetChain = String(chain || 'arbitrum').toLowerCase();
    const rpcInfo = RPC_ENDPOINTS[targetChain] || RPC_ENDPOINTS.arbitrum;

    if (!process.env.FLASH_ARB_SIGNER_KEY) {
      return res.status(400).json({
        success: false,
        error: 'No server-side signer private key configured. Enter private key in Signer Key Config or connect your Web3 wallet.',
      });
    }

    // Verify target contract code
    const codeCheck = await fetch(rpcInfo.rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: [to, 'latest'],
        id: 1,
      }),
    });
    const codeData = await codeCheck.json();
    const code = codeData?.result || '0x';
    if (code === '0x' || code.length <= 2) {
      return res.status(400).json({
        success: false,
        error: `Contract ${to} has no deployed bytecode on ${rpcInfo.name}. You must deploy FlashArbOptimized.sol first before executing flash loans.`,
        isContractUndeployed: true,
      });
    }

    const { ethers } = await import('ethers');
    const provider = new ethers.JsonRpcProvider(rpcInfo.rpc);
    const wallet = new ethers.Wallet(process.env.FLASH_ARB_SIGNER_KEY, provider);

    const balanceWei = await provider.getBalance(wallet.address);
    if (balanceWei < 100000000000000n) { // 0.0001 ETH
      return res.status(400).json({
        success: false,
        error: `Insufficient gas balance: ${wallet.address} holds ${ethers.formatEther(balanceWei)} ETH on ${rpcInfo.name}, which is below required gas threshold.`,
      });
    }

    const tx = await wallet.sendTransaction({
      to,
      data: data || '0x',
      gasLimit: gasLimit ? BigInt(gasLimit) : 300000n,
    });

    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) {
      return res.status(500).json({
        success: false,
        txHash: tx.hash,
        error: 'Transaction reverted on-chain.',
      });
    }

    return res.json({
      success: true,
      txHash: tx.hash,
      chain: rpcInfo.name,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      explorerUrl: `${rpcInfo.explorer}/tx/${tx.hash}`,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'On-chain broadcast failed',
    });
  }
});

/**
 * GET /api/flash-arb/deploy-payload
 * Returns compiled bytecode, ABI, and encoded constructor payload for deploying FlashArbOptimized
 */
flashArbRouter.get('/deploy-payload', async (req: Request, res: Response) => {
  try {
    const chain = String(req.query.chain || 'arbitrum').toLowerCase();
    const rpcInfo = RPC_ENDPOINTS[chain] || RPC_ENDPOINTS.arbitrum;

    const fs = await import('fs');
    const path = await import('path');
    const artifactPath = path.join(process.cwd(), 'flash-arb/contracts/out/FlashArbOptimized.json');
    if (!fs.existsSync(artifactPath)) {
      return res.status(500).json({ success: false, error: 'FlashArbOptimized artifact not found' });
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    const { ethers } = await import('ethers');
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const constructorArgs = [rpcInfo.balancerVault, rpcInfo.aavePool];
    const encodedArgs = abiCoder.encode(['address', 'address'], constructorArgs);
    const deployData = artifact.bytecode + encodedArgs.slice(2);

    return res.json({
      success: true,
      chain,
      chainName: rpcInfo.name,
      chainId: rpcInfo.chainId,
      constructorArgs: {
        balancerVault: rpcInfo.balancerVault,
        aavePool: rpcInfo.aavePool,
        profitVault: process.env.FLASH_ARB_PROFIT_WALLET || DEFAULT_PROFIT_WALLET,
      },
      bytecodeLength: artifact.bytecode.length,
      deployData,
      abi: artifact.abi,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// In-memory registry of active FlashArb contract addresses per chain
const DEPLOYED_CONTRACTS: Record<string, string> = {
  arbitrum: '0x38F23f99052672B1089d1369796035D5B8D8D105',
  base: '0x29B35C83955146bA8fD754B4B96956D245A5661e',
  optimism: '0x738c8Eb31316b23d9b8A68b0c2658b456C932598',
};

/**
 * GET /api/flash-arb/deployed-contracts
 * Returns the currently active FlashArb contract addresses across all supported chains
 */
flashArbRouter.get('/deployed-contracts', (_req: Request, res: Response) => {
  res.json({
    success: true,
    contracts: DEPLOYED_CONTRACTS,
  });
});

/**
 * POST /api/flash-arb/deployed-contracts
 * Updates the active contract address for a specific chain
 */
flashArbRouter.post('/deployed-contracts', (req: Request, res: Response) => {
  const { chain, address } = req.body;
  const targetChain = String(chain || 'arbitrum').toLowerCase();
  if (!address || !/^0x[a-fA-F0-9]{40}$/i.test(String(address).trim())) {
    return res.status(400).json({ success: false, error: 'Invalid EVM contract address format (must be 0x followed by 40 hex chars)' });
  }
  DEPLOYED_CONTRACTS[targetChain] = address.trim();
  return res.json({
    success: true,
    chain: targetChain,
    contractAddress: DEPLOYED_CONTRACTS[targetChain],
    contracts: DEPLOYED_CONTRACTS,
  });
});

/**
 * POST /api/flash-arb/deploy-contract
 * Autonomous Deployment Agent: Signs & broadcasts contract creation on the selected chain
 */
flashArbRouter.post('/deploy-contract', async (req: Request, res: Response) => {
  try {
    const { chain, privateKey: reqPrivateKey } = req.body;
    const targetChain = String(chain || 'arbitrum').toLowerCase();
    const rpcInfo = RPC_ENDPOINTS[targetChain] || RPC_ENDPOINTS.arbitrum;

    const fs = await import('fs');
    const path = await import('path');
    const artifactPath = path.join(process.cwd(), 'flash-arb/contracts/out/FlashArbOptimized.json');
    if (!fs.existsSync(artifactPath)) {
      return res.status(500).json({ success: false, error: 'FlashArbOptimized artifact not found on disk' });
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    const { ethers } = await import('ethers');

    const signerKey = reqPrivateKey || process.env.FLASH_ARB_SIGNER_KEY;

    if (!signerKey) {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const encodedArgs = abiCoder.encode(['address', 'address'], [rpcInfo.balancerVault, rpcInfo.aavePool]);
      const deployData = artifact.bytecode + encodedArgs.slice(2);

      return res.json({
        success: false,
        requiresWallet: true,
        message: 'No server signer key configured. Deploy via connected Web3 wallet (MetaMask / OKX).',
        deployData,
        chain: targetChain,
        chainName: rpcInfo.name,
        chainId: rpcInfo.chainId,
        rpcUrl: rpcInfo.rpc,
        explorer: rpcInfo.explorer,
        constructorArgs: [rpcInfo.balancerVault, rpcInfo.aavePool],
      });
    }

    const provider = new ethers.JsonRpcProvider(rpcInfo.rpc);
    const cleanKey = signerKey.startsWith('0x') ? signerKey : `0x${signerKey}`;
    const wallet = new ethers.Wallet(cleanKey, provider);

    const balanceWei = await provider.getBalance(wallet.address);
    const minRequiredWei = 100000000000000n; // 0.0001 ETH
    if (balanceWei < minRequiredWei) {
      return res.status(400).json({
        success: false,
        error: `Deployer wallet ${wallet.address} has ${ethers.formatEther(balanceWei)} ETH on ${rpcInfo.name}. Contract deployment requires ~0.0003 ETH for L2 gas. Please fund ${wallet.address} or deploy with your connected wallet.`,
        deployerAddress: wallet.address,
        balanceEth: ethers.formatEther(balanceWei),
      });
    }

    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const contract = await factory.deploy(rpcInfo.balancerVault, rpcInfo.aavePool);

    const deployTx = contract.deploymentTransaction();
    const txHash = deployTx ? deployTx.hash : '';

    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();

    // Register into active deployed contracts store
    DEPLOYED_CONTRACTS[targetChain] = contractAddress;

    return res.json({
      success: true,
      contractAddress,
      txHash,
      chain: targetChain,
      chainName: rpcInfo.name,
      deployer: wallet.address,
      balancerVault: rpcInfo.balancerVault,
      aavePool: rpcInfo.aavePool,
      profitVault: process.env.FLASH_ARB_PROFIT_WALLET || DEFAULT_PROFIT_WALLET,
      explorerUrl: `${rpcInfo.explorer}/address/${contractAddress}`,
      txExplorerUrl: `${rpcInfo.explorer}/tx/${txHash}`,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Contract deployment failed',
    });
  }
});
