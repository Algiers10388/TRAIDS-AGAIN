//! Transaction signing and broadcast. Only reachable when the process was started with `--live`
//! AND `risk.dry_run = false`.

use std::str::FromStr;
use std::time::Duration;

use ethers::prelude::*;
use ethers::signers::{LocalWallet, Signer};
use ethers::types::transaction::eip2718::TypedTransaction;
use tracing::info;

use crate::abi;
use crate::config::{parse_addr, ChainConfig};

pub struct Executor {
    wallet: LocalWallet,
    send_provider: Provider<Http>,
    chain_id: u64,
    priority_fee_bidding: bool,
    tip_share_percent: u64,
}

pub struct Outcome {
    pub hash: H256,
    pub success: bool,
    pub gas_used: U256,
    pub effective_gas_price: U256,
}

impl Executor {
    /// Loads the key from the env var named in the config and verifies everything that must be true
    /// before a single transaction is allowed: chain id, key <-> configured address, contract ownership
    /// and the contract's Aave pool.
    pub async fn new(cfg: &ChainConfig, provider: &Provider<Http>) -> eyre::Result<Self> {
        let key = std::env::var(&cfg.signer.private_key_env)
            .map_err(|_| eyre::eyre!("env var {} is not set (needed for live trading)", cfg.signer.private_key_env))?;
        let wallet = LocalWallet::from_str(key.trim().trim_start_matches("0x"))
            .map_err(|e| eyre::eyre!("invalid private key in {}: {}", cfg.signer.private_key_env, e))?
            .with_chain_id(cfg.chain_id);

        if wallet.address() != cfg.signer_address()? {
            eyre::bail!(
                "[{}] key in {} controls {:?} but signer.gas_wallet_address is {:?}",
                cfg.chain_name, cfg.signer.private_key_env, wallet.address(), cfg.signer_address()?
            );
        }
        let remote_chain = provider.get_chainid().await?.as_u64();
        if remote_chain != cfg.chain_id {
            eyre::bail!("[{}] RPC reports chain id {} but config says {}", cfg.chain_name, remote_chain, cfg.chain_id);
        }
        let contract = cfg.flash_arb_address()?;
        if contract.is_zero() {
            eyre::bail!("[{}] flash_arb_contract is not set; deploy FlashArb and put its address in the config", cfg.chain_name);
        }
        let owner = abi::contract_owner(provider, contract).await?;
        if owner != wallet.address() {
            eyre::bail!("[{}] FlashArb owner is {:?}, not the signer {:?}", cfg.chain_name, owner, wallet.address());
        }
        let pool = abi::contract_pool(provider, contract).await?;
        if pool != parse_addr(&cfg.aave_v3_pool)? {
            eyre::bail!("[{}] FlashArb POOL() is {:?} but config aave_v3_pool is {}", cfg.chain_name, pool, cfg.aave_v3_pool);
        }

        let send_provider = if cfg.relay_endpoint.trim().is_empty() {
            provider.clone()
        } else {
            Provider::<Http>::try_from(cfg.relay_endpoint.as_str())?
        };
        info!("[{}] executor ready: signer {:?}, contract {:?}", cfg.chain_name, wallet.address(), contract);
        Ok(Self {
            wallet,
            send_provider,
            chain_id: cfg.chain_id,
            priority_fee_bidding: cfg.priority_fee_bidding,
            tip_share_percent: cfg.tip_share_percent,
        })
    }

    pub async fn send(
        &self,
        provider: &Provider<Http>,
        contract: Address,
        calldata: Bytes,
        gas_estimate: u64,
        expected_net_usd: f64,
        eth_usd: f64,
    ) -> eyre::Result<Outcome> {
        let (mut max_fee, mut priority) = provider.estimate_eip1559_fees(None).await?;
        if self.priority_fee_bidding && expected_net_usd > 0.0 && eth_usd > 0.0 {
            let tip_wei_total = expected_net_usd * (self.tip_share_percent as f64 / 100.0) / eth_usd * 1e18;
            let per_gas = U256::from((tip_wei_total / gas_estimate.max(1) as f64) as u128);
            if per_gas > priority {
                max_fee += per_gas - priority;
                priority = per_gas;
            }
        }
        let gas_limit = gas_estimate + gas_estimate / 5; // 20% headroom
        let nonce = provider
            .get_transaction_count(self.wallet.address(), Some(BlockNumber::Pending.into()))
            .await?;

        let tx: TypedTransaction = Eip1559TransactionRequest::new()
            .from(self.wallet.address())
            .to(contract)
            .data(calldata)
            .gas(gas_limit)
            .nonce(nonce)
            .max_fee_per_gas(max_fee)
            .max_priority_fee_per_gas(priority)
            .chain_id(self.chain_id)
            .into();
        let sig = self.wallet.sign_transaction(&tx).await?;
        let raw = tx.rlp_signed(&sig);
        let pending = self.send_provider.send_raw_transaction(raw).await?;
        let hash = pending.tx_hash();
        info!("broadcast {:?}", hash);

        for _ in 0..90 {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if let Some(r) = provider.get_transaction_receipt(hash).await? {
                return Ok(Outcome {
                    hash,
                    success: r.status == Some(U64::from(1)),
                    gas_used: r.gas_used.unwrap_or_default(),
                    effective_gas_price: r.effective_gas_price.unwrap_or(max_fee),
                });
            }
        }
        eyre::bail!("transaction {:?} not mined within 90s (nonce {}); check it manually before restarting", hash, nonce)
    }
}
