use std::sync::Arc;
use dashmap::DashMap;
use ethers::prelude::*;
use tracing::{info, warn, error};
use std::time::Duration;
use crate::config::ChainConfig;

#[derive(Debug, Clone)]
pub enum PoolType {
    UniswapV2 {
        reserve0: U256,
        reserve1: U256,
        token0: Address,
        token1: Address,
        fee_bps: u32, // e.g. 30 (0.3%)
    },
    UniswapV3 {
        sqrt_price_x96: U256,
        tick: i32,
        liquidity: u128,
        fee: u32,     // e.g. 500 (0.05%), 3000 (0.3%)
        token0: Address,
        token1: Address,
    },
    Curve {
        pool_address: Address,
        token0: Address,
        token1: Address,
        rate: U256,
    }
}

#[derive(Debug, Clone)]
pub struct PoolSnapshot {
    pub pool_address: Address,
    pub dex_name: String,
    pub pool_type: PoolType,
    pub last_updated_block: u64,
}

pub struct PriceMonitor {
    pub config: ChainConfig,
    pub pools: Arc<DashMap<Address, PoolSnapshot>>,
    pub latest_block: Arc<tokio::sync::RwLock<u64>>,
}

impl PriceMonitor {
    pub fn new(config: ChainConfig) -> Self {
        Self {
            config,
            pools: Arc::new(DashMap::new()),
            latest_block: Arc::new(tokio::sync::RwLock::new(0)),
        }
    }

    /// Connects to low-latency node WebSocket and listens to newHeads and Sync/Swap events
    pub async fn run(&self) -> eyre::Result<()> {
        info!(
            "[{}] Starting WebSocket Price Monitor on {}",
            self.config.chain_name, self.config.rpc_ws
        );

        loop {
            match self.connect_and_stream().await {
                Ok(_) => warn!("[{}] WebSocket stream ended, reconnecting...", self.config.chain_name),
                Err(e) => {
                    error!(
                        "[{}] WebSocket error: {}. Reconnecting in 3s...",
                        self.config.chain_name, e
                    );
                    tokio::time::sleep(Duration::from_secs(3)).await;
                }
            }
        }
    }

    async fn connect_and_stream(&self) -> eyre::Result<()> {
        let ws = Ws::connect(&self.config.rpc_ws).await?;
        let provider = Provider::new(ws);

        let mut stream = provider.subscribe_blocks().await?;
        info!("[{}] Subscribed to newHeads WebSocket feed", self.config.chain_name);

        while let Some(block) = stream.next().await {
            if let Some(number) = block.number {
                let block_num = number.as_u64();
                {
                    let mut lock = self.latest_block.write().await;
                    *lock = block_num;
                }

                // Periodic health report
                if block_num % 100 == 0 {
                    info!(
                        "[{}] Head: Block #{} | Tracking {} pools in memory",
                        self.config.chain_name,
                        block_num,
                        self.pools.len()
                    );
                }
            }
        }

        Ok(())
    }

    pub fn register_pool(&self, pool: PoolSnapshot) {
        self.pools.insert(pool.pool_address, pool);
    }

    /// Computes spot price using tick math for Uniswap V3 or constant product for V2
    pub fn compute_spot_price(&self, pool_addr: &Address, token_in: Address) -> Option<f64> {
        let pool = self.pools.get(pool_addr)?;
        match &pool.pool_type {
            PoolType::UniswapV2 { reserve0, reserve1, token0, .. } => {
                let r0 = reserve0.as_u128() as f64;
                let r1 = reserve1.as_u128() as f64;
                if r0 == 0.0 || r1 == 0.0 { return None; }
                if *token0 == token_in {
                    Some(r1 / r0)
                } else {
                    Some(r0 / r1)
                }
            }
            PoolType::UniswapV3 { sqrt_price_x96, token0, .. } => {
                // sqrtPriceX96 to price: (sqrtPriceX96 / 2^96)^2
                let q96: f64 = 79228162514264337593543950336.0;
                let sqrt_p = sqrt_price_x96.as_u128() as f64 / q96;
                let price0 = sqrt_p * sqrt_p;
                if *token0 == token_in {
                    Some(price0)
                } else {
                    if price0 > 0.0 { Some(1.0 / price0) } else { None }
                }
            }
            PoolType::Curve { rate, .. } => {
                let r = rate.as_u128() as f64 / 1e18;
                Some(r)
            }
        }
    }
}
